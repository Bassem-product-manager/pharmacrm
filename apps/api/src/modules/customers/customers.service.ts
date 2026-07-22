import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  type CreateCustomerInput,
  type CursorQuery,
  type CustomersQuery,
  type PointsAdjustInput,
  type UpdateCustomerInput,
} from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /customers — search matches partial phone from ANY position AND name
   * substring with one param; inactiveDays computed from lastVisitAt (R8).
   * Soft-deleted rows always excluded (docs/05 §1).
   */
  async list(q: CustomersQuery) {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (q.search) {
      const digits = q.search.replace(/[\s\-()]/g, "");
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        ...(digits.length > 0 ? [{ phone: { contains: digits } }] : []),
      ];
    }
    if (q.tag) where.tags = { has: q.tag };
    if (q.inactiveDays) {
      where.lastVisitAt = { lt: new Date(Date.now() - q.inactiveDays * DAY_MS) };
    }

    const rows = await this.prisma.tenant.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id tiebreak = stable cursor
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
  }

  /** POST /customers — sets consentAt (Law 151/2020). */
  async create(input: CreateCustomerInput & { phone: string }) {
    try {
      return await this.prisma.tenant.customer.create({
        data: {
          name: input.name,
          phone: input.phone,
          gender: input.gender,
          birthYear: input.birthYear,
          tags: input.tags ?? [],
          notes: input.notes,
          consentAt: new Date(),
        } as Prisma.CustomerUncheckedCreateInput, // pharmacyId injected by tenant extension
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Phone already exists for this pharmacy" },
        });
      }
      throw e;
    }
  }

  /** GET /customers/:id — profile + refill rules + opt-out badge + visit forecast. */
  async getById(id: string) {
    const customer = await this.prisma.tenant.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        refillRules: {
          where: { deletedAt: null },
          include: { productRef: { select: { id: true, nameText: true } } },
        },
      },
    });
    if (!customer) this.notFound();

    // payment-cycle prediction: avg interval between purchases → expected next visit
    const agg = await this.prisma.tenant.sale.aggregate({
      where: { customerId: id },
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    let expectedNextVisit: { expectedAt: string; avgIntervalDays: number } | null = null;
    if (agg._count._all >= 2 && agg._min.createdAt && agg._max.createdAt) {
      const avgMs =
        (agg._max.createdAt.getTime() - agg._min.createdAt.getTime()) / (agg._count._all - 1);
      if (avgMs >= DAY_MS) {
        expectedNextVisit = {
          expectedAt: new Date(agg._max.createdAt.getTime() + avgMs).toISOString(),
          avgIntervalDays: Math.round((avgMs / DAY_MS) * 10) / 10,
        };
      }
    }
    return { ...customer, optedOut: customer!.optedOutAt != null, expectedNextVisit };
  }

  async update(id: string, input: UpdateCustomerInput & { phone?: string }) {
    await this.ensureExists(id);
    const { optedOut, ...fields } = input;
    try {
      return await this.prisma.tenant.customer.update({
        where: { id },
        data: {
          ...fields,
          ...(optedOut === true ? { optedOutAt: new Date() } : {}),
          ...(optedOut === false ? { optedOutAt: null } : {}),
        } as Prisma.CustomerUncheckedUpdateInput,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Phone already exists for this pharmacy" },
        });
      }
      throw e;
    }
  }

  /** DELETE /customers/:id — OWNER only (guard in controller). Soft delete + AuditLog in one RLS TX. */
  async softDelete(id: string, actorUserId: string) {
    return this.prisma.withTenantRls(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id, deletedAt: null } });
      if (!customer) this.notFound();
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          pharmacyId: customer!.pharmacyId,
          userId: actorUserId,
          action: "CUSTOMER_DELETE",
          entity: "Customer",
          entityId: id,
          diff: { name: customer!.name, phone: customer!.phone },
        },
      });
      return { deleted: true };
    });
  }

  /** GET /customers/:id/sales — paginated tab. */
  async sales(id: string, q: CursorQuery) {
    await this.ensureExists(id);
    const rows = await this.prisma.tenant.sale.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      include: { items: true },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
  }

  /** GET /customers/:id/messages — paginated tab. */
  async messages(id: string, q: CursorQuery) {
    await this.ensureExists(id);
    const rows = await this.prisma.tenant.message.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
  }

  /**
   * POST /customers/:id/points-adjust — OWNER only.
   * SELECT … FOR UPDATE on the customer row (D9) → ledger row + atomic
   * increment + AuditLog, all inside one RLS transaction.
   */
  async pointsAdjust(id: string, input: PointsAdjustInput, actorUserId: string) {
    return this.prisma.withTenantRls(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; pharmacyId: string; pointsBalance: number }[]
      >`SELECT id, "pharmacyId", "pointsBalance" FROM "Customer"
        WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`;
      if (locked.length === 0) this.notFound();
      const customer = locked[0]!;

      if (customer.pointsBalance + input.points < 0) {
        throw new ConflictException({
          error: { code: ERROR_CODES.POINTS_INSUFFICIENT, message: "Balance cannot go negative" },
        });
      }

      await tx.pointsTransaction.create({
        data: {
          pharmacyId: customer.pharmacyId,
          customerId: id,
          type: "ADJUST",
          points: input.points,
          createdById: actorUserId, // R13
        },
      });
      const updated = await tx.customer.update({
        where: { id },
        data: { pointsBalance: { increment: input.points } },
      });
      await tx.auditLog.create({
        data: {
          pharmacyId: customer.pharmacyId,
          userId: actorUserId,
          action: "POINTS_ADJUST",
          entity: "Customer",
          entityId: id,
          diff: { points: input.points, reason: input.reason },
        },
      });
      return { pointsBalance: updated.pointsBalance };
    });
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.tenant.customer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!found) this.notFound();
  }

  private notFound(): never {
    throw new NotFoundException({
      error: { code: ERROR_CODES.NOT_FOUND, message: "Customer not found" },
    });
  }
}
