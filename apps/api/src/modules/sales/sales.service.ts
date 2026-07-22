import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ERROR_CODES, LOW_STOCK_THRESHOLD, type CreateSale, type SalesQuery } from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { getPharmacyId } from "../../common/tenant-context";
import { AnalyticsService } from "../analytics/analytics.service";

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** P2002 on a specific column (meta.target is the violated unique's columns). */
const isUniqueViolation = (e: unknown, column: string): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === "P2002" &&
  String((e.meta as { target?: unknown } | undefined)?.target ?? "").includes(column);

/** Canonical ProductRef key: trim + collapse inner whitespace (docs/04 Flow 1 step 3). */
const normalizeProductName = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * "YYYY-MM-DD" as a calendar day in Africa/Cairo → UTC [start, end) range.
 * Egypt observes DST again since 2023, so the offset is computed per-date via
 * Intl instead of hardcoding +02:00.
 */
export function cairoDayRange(date: string): { start: Date; end: Date } {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(utcMidnight).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!, +p.second!);
  const offsetMs = asUtc - utcMidnight.getTime();
  const start = new Date(utcMidnight.getTime() - offsetMs);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** The Africa/Cairo calendar day ("YYYY-MM-DD") that a given instant falls in. */
export function cairoDayKey(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/** Today's calendar day in Africa/Cairo. */
export const cairoTodayKey = (): string => cairoDayKey(new Date());

export interface QuickSaleResult {
  id: string;
  customerId: string;
  customerName: string;
  totalEgp: number;
  discountEgp: number;
  clientRef: string | null;
  createdAt: Date;
  items: {
    id: string;
    nameText: string;
    qty: number;
    productRefId: string | null;
    unitPriceEgp: number;
    notes: string | null;
  }[];
  earnedPoints: number;
  redeemedPoints: number;
  pointsBalance: number;
  convertedReminderIds: string[];
  /** Items whose stock is now low or negative after this sale (warn, not block). */
  stockWarnings: { productRefId: string; nameText: string; stock: number }[];
  idempotentReplay: boolean;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** GET /sales?date=&cursor= — daily log (docs/05 §3). */
  async list(q: SalesQuery) {
    const where: Prisma.SaleWhereInput = {};
    if (q.date) {
      const { start, end } = cairoDayRange(q.date);
      where.createdAt = { gte: start, lt: end };
    }
    const rows = await this.prisma.tenant.sale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id tiebreak = stable cursor
      include: {
        items: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const data = hasMore ? rows.slice(0, q.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
  }

  /** GET /sales/:id — tenant-scoped read (extension auto-injects pharmacyId). */
  async getById(id: string) {
    const sale = await this.prisma.tenant.sale.findFirst({
      where: { id },
      include: { items: true, pointsTx: true },
    });
    if (!sale) {
      throw new NotFoundException({
        error: { code: ERROR_CODES.NOT_FOUND, message: "Sale not found" },
      });
    }
    return sale;
  }

  /**
   * POST /sales — the core transaction, docs/04 Flow 1 steps 1–8 inside ONE
   * RLS TX:
   *  1. clientRef replay → return original (controller sends 200)
   *  2. newCustomer → INSERT with consentAt=now (Law 151/2020)
   *  3. items without productRefId → upsert ProductRef by (pharmacyId,
   *     normalized nameText); provided productRefIds are verified tenant-local
   *  4. redeemPoints: SELECT customer FOR UPDATE (D9) → validate balance →
   *     PointsTransaction(REDEEM, −N); discountEgp = N × redeemRate
   *  5. INSERT Sale + SaleItems
   *  6. earned = floor((totalEgp − discountEgp) × loyaltyRatio) → EARN row
   *  7. atomic balance increment(earned − redeemed), lastVisitAt = now
   *  8. active RefillRules matching sale productRefIds: PENDING/SENT Reminder
   *     → CONVERTED + convertedSaleId; rule.nextDueAt = now + cycleDays
   * COMMIT → emit purchase_logged (+ reminder_converted per conversion).
   */
  async create(input: CreateSale, actorUserId: string): Promise<QuickSaleResult> {
    // Step 1 fast path: known replay of an already-processed clientRef.
    const replayed = await this.findReplay(input.clientRef);
    if (replayed) return replayed;

    let result: QuickSaleResult;
    try {
      result = await this.runSaleTx(input, actorUserId);
    } catch (e) {
      if (isUniqueViolation(e, "clientRef")) {
        // Race: a concurrent request with the same clientRef won the unique
        // constraint. The whole TX rolled back (no points applied) — return theirs.
        const replay = await this.findReplay(input.clientRef);
        if (replay) return replay;
        // clientRef taken but not visible in this tenant — reject, don't 500
        throw new ConflictException({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: "clientRef already used" },
        });
      }
      if (isUniqueViolation(e, "phone")) {
        // Two first-time sales for the same new phone raced. The customer row
        // exists after the winner's commit, so one retry takes the reuse path.
        result = await this.runSaleTx(input, actorUserId);
      } else {
        throw e;
      }
    }

    // Post-COMMIT product analytics (fire-and-forget, never blocks the sale).
    const pharmacyId = getPharmacyId()!;
    this.analytics.capture("purchase_logged", pharmacyId, {
      saleId: result.id,
      totalEgp: result.totalEgp,
      discountEgp: result.discountEgp,
      earnedPoints: result.earnedPoints,
      redeemedPoints: result.redeemedPoints,
      itemCount: result.items.length,
    });
    for (const reminderId of result.convertedReminderIds) {
      this.analytics.capture("reminder_converted", pharmacyId, {
        reminderId,
        saleId: result.id,
      });
    }
    return result;
  }

  /** Flow 1 steps 2–8 inside ONE RLS transaction. */
  private runSaleTx(input: CreateSale, actorUserId: string): Promise<QuickSaleResult> {
    return this.prisma.withTenantRls(async (tx) => {
        const pharmacyId = getPharmacyId()!; // interceptor guarantees context on tenant routes

        // ---- step 2: resolve customer (lock existing / create inline) ----
        // newCustomer with an already-registered phone REUSES that customer:
        // offline-queued sales always arrive as newCustomer (the client can't
        // match customers offline), and a 409 here would lose the queued sale.
        let customerId: string;
        let customerName: string;
        let pointsBalance: number;
        if (input.newCustomer) {
          const existing = await tx.$queryRaw<
            { id: string; name: string; pointsBalance: number }[]
          >`SELECT id, name, "pointsBalance" FROM "Customer"
            WHERE "pharmacyId" = ${pharmacyId} AND phone = ${input.newCustomer.phone}
              AND "deletedAt" IS NULL FOR UPDATE`;
          if (existing.length > 0) {
            customerId = existing[0]!.id;
            customerName = existing[0]!.name;
            pointsBalance = existing[0]!.pointsBalance;
          } else {
            const created = await tx.customer.create({
              data: {
                pharmacyId,
                name: input.newCustomer.name,
                phone: input.newCustomer.phone,
                tags: input.newCustomer.tags,
                consentAt: new Date(),
              },
            });
            customerId = created.id;
            customerName = created.name;
            pointsBalance = created.pointsBalance; // 0 — row is invisible to others until COMMIT, no lock needed
          }
        } else {
          // D9: FOR UPDATE serializes all points math on this customer row.
          const locked = await tx.$queryRaw<
            { id: string; name: string; pointsBalance: number }[]
          >`SELECT id, name, "pointsBalance" FROM "Customer"
            WHERE id = ${input.customerId} AND "deletedAt" IS NULL FOR UPDATE`;
          if (locked.length === 0) {
            throw new NotFoundException({
              error: { code: ERROR_CODES.NOT_FOUND, message: "Customer not found" },
            });
          }
          customerId = locked[0]!.id;
          customerName = locked[0]!.name;
          pointsBalance = locked[0]!.pointsBalance;
        }

        // ---- step 3: ProductRef resolution ----
        const providedIds = [...new Set(input.items.map((i) => i.productRefId).filter((x): x is string => !!x))];
        if (providedIds.length > 0) {
          // RLS scopes this read — a foreign pharmacy's id simply won't be found.
          const found = await tx.productRef.findMany({
            where: { id: { in: providedIds } },
            select: { id: true },
          });
          if (found.length !== providedIds.length) {
            throw new NotFoundException({
              error: { code: ERROR_CODES.NOT_FOUND, message: "Unknown productRefId" },
            });
          }
        }
        const resolvedItems: {
          nameText: string;
          qty: number;
          productRefId: string;
          unitPriceEgp: number;
          notes: string | null;
        }[] = [];
        const upsertedByName = new Map<string, string>(); // dedupe repeated names within one sale
        for (const item of input.items) {
          let productRefId = item.productRefId;
          if (!productRefId) {
            const nameText = normalizeProductName(item.nameText);
            let id = upsertedByName.get(nameText);
            if (!id) {
              // Auto-stub a formulary row. Seed its price from this sale's unit
              // price so the catalog is pre-filled; details editable later.
              const ref = await tx.productRef.upsert({
                where: { pharmacyId_nameText: { pharmacyId, nameText } },
                update: {},
                create: {
                  pharmacyId,
                  nameText,
                  aliases: [],
                  priceEgp: item.unitPriceEgp > 0 ? new Prisma.Decimal(round2(item.unitPriceEgp)) : null,
                },
              });
              id = ref.id;
              upsertedByName.set(nameText, id);
            }
            productRefId = id;
          }
          resolvedItems.push({
            nameText: item.nameText,
            qty: item.qty,
            productRefId,
            unitPriceEgp: round2(item.unitPriceEgp),
            notes: item.notes ?? null,
          });
        }

        // ---- step 4: redeem validation + pricing ----
        const pharmacy = await tx.pharmacy.findUnique({
          where: { id: pharmacyId },
          select: { loyaltyRatio: true, redeemRate: true },
        });
        const loyaltyRatio = Number(pharmacy!.loyaltyRatio);
        const redeemRate = Number(pharmacy!.redeemRate);

        const redeemPoints = input.redeemPoints;
        if (redeemPoints > pointsBalance) {
          throw new ConflictException({
            error: { code: ERROR_CODES.POINTS_INSUFFICIENT, message: "Not enough points to redeem" },
          });
        }
        // Auto-sum Σ(unitPrice × qty); an explicit totalEgp overrides it.
        const lineSum = round2(
          resolvedItems.reduce((s, it) => s + it.unitPriceEgp * it.qty, 0),
        );
        const totalEgp = input.totalEgp != null ? round2(input.totalEgp) : lineSum;
        const discountEgp = round2(redeemPoints * redeemRate);
        if (discountEgp > totalEgp) {
          throw new BadRequestException({
            error: {
              code: ERROR_CODES.VALIDATION_FAILED,
              message: "Redeemed points value exceeds the sale total",
            },
          });
        }

        // ---- step 5: Sale + SaleItems ----
        const sale = await tx.sale.create({
          data: {
            pharmacyId,
            customerId,
            loggedById: actorUserId,
            totalEgp: new Prisma.Decimal(totalEgp),
            discountEgp: new Prisma.Decimal(discountEgp),
            notes: input.notes ?? null,
            clientRef: input.clientRef,
            items: {
              create: resolvedItems.map((it) => ({
                nameText: it.nameText,
                qty: it.qty,
                productRefId: it.productRefId,
                unitPriceEgp: new Prisma.Decimal(it.unitPriceEgp),
                notes: it.notes,
              })),
            },
          },
          include: { items: true },
        });

        // ---- step 5b: decrement stock (auto), collect low/negative warnings ----
        // Sum qty per product across items so repeats decrement once, correctly.
        const qtyByProduct = new Map<string, number>();
        for (const it of resolvedItems) {
          qtyByProduct.set(it.productRefId, (qtyByProduct.get(it.productRefId) ?? 0) + it.qty);
        }
        const stockWarnings: { productRefId: string; nameText: string; stock: number }[] = [];
        for (const [productRefId, qty] of qtyByProduct) {
          const ref = await tx.productRef.update({
            where: { id: productRefId },
            data: { stock: { decrement: qty } },
            select: { stock: true, nameText: true },
          });
          // Warn (never block): offline sales can't see live stock, so a sale is
          // always honored even if it drives stock low or below zero.
          if (ref.stock <= LOW_STOCK_THRESHOLD) {
            stockWarnings.push({ productRefId, nameText: ref.nameText, stock: ref.stock });
          }
        }

        // ---- steps 4b + 6: ledger rows ----
        if (redeemPoints > 0) {
          await tx.pointsTransaction.create({
            data: { pharmacyId, customerId, saleId: sale.id, type: "REDEEM", points: -redeemPoints },
          });
        }
        const earnedPoints = Math.floor((totalEgp - discountEgp) * loyaltyRatio);
        if (earnedPoints > 0) {
          await tx.pointsTransaction.create({
            data: { pharmacyId, customerId, saleId: sale.id, type: "EARN", points: earnedPoints },
          });
        }

        // ---- step 7: denormalized balance + lastVisit ----
        const updated = await tx.customer.update({
          where: { id: customerId },
          data: {
            pointsBalance: { increment: earnedPoints - redeemPoints },
            lastVisitAt: sale.createdAt,
          },
          select: { pointsBalance: true },
        });

        // ---- step 8: refill conversion detection (active rules only) ----
        const saleProductIds = [...new Set(resolvedItems.map((i) => i.productRefId))];
        const convertedReminderIds: string[] = [];
        const reminders = await tx.$queryRaw<
          { id: string; refillRuleId: string; cycleDays: number }[]
        >`SELECT rem.id, rem."refillRuleId", rr."cycleDays"
          FROM "Reminder" rem
          JOIN "RefillRule" rr ON rr.id = rem."refillRuleId"
          WHERE rr."customerId" = ${customerId}
            AND rr."isActive" = true
            AND rr."deletedAt" IS NULL
            AND rr."productRefId" IN (${Prisma.join(saleProductIds)})
            AND rem.status IN ('PENDING', 'SENT')`;
        for (const rem of reminders) {
          await tx.reminder.update({
            where: { id: rem.id },
            data: { status: "CONVERTED", convertedSaleId: sale.id },
          });
          await tx.refillRule.update({
            where: { id: rem.refillRuleId },
            data: { nextDueAt: new Date(sale.createdAt.getTime() + rem.cycleDays * DAY_MS) },
          });
          convertedReminderIds.push(rem.id);
        }

        return {
          id: sale.id,
          customerId,
          customerName,
          totalEgp,
          discountEgp,
          clientRef: sale.clientRef,
          createdAt: sale.createdAt,
          items: sale.items.map((it) => ({
            id: it.id,
            nameText: it.nameText,
            qty: it.qty,
            productRefId: it.productRefId,
            unitPriceEgp: Number(it.unitPriceEgp),
            notes: it.notes,
          })),
          earnedPoints,
          redeemedPoints: redeemPoints,
          pointsBalance: updated.pointsBalance,
          convertedReminderIds,
          stockWarnings,
          idempotentReplay: false,
        };
    });
  }

  private async findReplay(clientRef: string): Promise<QuickSaleResult | null> {
    const sale = await this.prisma.tenant.sale.findFirst({
      where: { clientRef },
      include: { items: true, customer: { select: { name: true, pointsBalance: true } } },
    });
    if (!sale) return null;
    // Idempotent replay applies nothing new; report the customer's CURRENT
    // balance so the client stays consistent without a second round-trip.
    return {
      id: sale.id,
      customerId: sale.customerId,
      customerName: sale.customer.name,
      totalEgp: Number(sale.totalEgp),
      discountEgp: Number(sale.discountEgp),
      clientRef: sale.clientRef,
      createdAt: sale.createdAt,
      items: sale.items.map((it) => ({
        id: it.id,
        nameText: it.nameText,
        qty: it.qty,
        productRefId: it.productRefId,
        unitPriceEgp: Number(it.unitPriceEgp),
        notes: it.notes,
      })),
      earnedPoints: 0,
      redeemedPoints: 0,
      pointsBalance: sale.customer.pointsBalance,
      convertedReminderIds: [],
      stockWarnings: [],
      idempotentReplay: true,
    };
  }

  /**
   * GET /sales/:id/invoice — الفاتورة الضريبية. Sequential numbers are
   * assigned AT ISSUANCE (accounting practice: only issued invoices consume
   * numbers): first call locks the Pharmacy row (FOR UPDATE), bumps
   * invoiceSeq, stamps the sale; later calls replay the same number.
   * Prices are VAT-inclusive: base = net/(1+r), vat = net − base.
   */
  async getInvoice(id: string) {
    return this.prisma.withTenantRls(async (tx) => {
      // explicit pharmacyId — raw tx doesn't get the tenant extension's scoping,
      // and RLS is a backstop, not something we rely on (see decisions R6)
      const sale = await tx.sale.findFirst({
        where: { id, pharmacyId: getPharmacyId()! },
        include: { items: true, customer: { select: { id: true, name: true, phone: true } } },
      });
      if (!sale) {
        throw new NotFoundException({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Sale not found" },
        });
      }

      let invoiceNo = sale.invoiceNo;
      if (invoiceNo == null) {
        const locked = await tx.$queryRaw<{ invoiceSeq: number }[]>`
          SELECT "invoiceSeq" FROM "Pharmacy" WHERE id = ${sale.pharmacyId} FOR UPDATE`;
        invoiceNo = (locked[0]?.invoiceSeq ?? 0) + 1;
        await tx.pharmacy.update({
          where: { id: sale.pharmacyId },
          data: { invoiceSeq: invoiceNo },
        });
        await tx.sale.update({ where: { id }, data: { invoiceNo } });
      }

      const pharmacy = await tx.pharmacy.findUniqueOrThrow({
        where: { id: sale.pharmacyId },
        select: { name: true, phone: true, city: true, address: true, taxId: true, vatRate: true },
      });

      const gross = Number(sale.totalEgp);
      const discount = Number(sale.discountEgp);
      const net = round2(gross - discount);
      const vatRate = Number(pharmacy.vatRate);
      const base = round2(net / (1 + vatRate / 100));
      return {
        invoiceNo,
        saleId: sale.id,
        issuedAt: sale.createdAt,
        pharmacy,
        customer: sale.customer,
        items: sale.items.map((it) => ({
          nameText: it.nameText,
          qty: it.qty,
          unitPriceEgp: Number(it.unitPriceEgp),
          lineTotalEgp: round2(Number(it.unitPriceEgp) * it.qty),
        })),
        totals: {
          grossEgp: gross,
          discountEgp: discount,
          netEgp: net,
          vatRate,
          vatBaseEgp: base,
          vatAmountEgp: round2(net - base),
        },
      };
    });
  }
}
