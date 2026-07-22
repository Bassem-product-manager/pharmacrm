import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import * as bcrypt from "bcryptjs";
import type { Response } from "express";
import {
  adminAnalyticsQuerySchema,
  adminBlockSchema,
  adminDistributionQuerySchema,
  adminKpisQuerySchema,
  adminLoginSchema,
  adminPharmaciesQuerySchema,
  adminPlanPatchSchema,
  adminSeriesQuerySchema,
  ERROR_CODES,
  JWT_AUDIENCE,
  type AdminAnalyticsQuery,
  type AdminBlockInput,
  type AdminDistributionQuery,
  type AdminKpisQuery,
  type AdminPharmaciesQuery,
  type AdminPlanPatchInput,
  type AdminSeriesQuery,
} from "@pharmacrm/shared";
import { AdminJwtGuard, AdminPublic } from "../../common/guards/admin-jwt.guard";
import { Public } from "../../common/guards/jwt.guard";
import { PrismaService } from "../../common/prisma.service";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { AdminAnalyticsService } from "./admin-analytics.service";

const sendCsv = (res: Response, out: { filename: string; csv: string }) => {
  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
    })
    .send(out.csv);
};

/**
 * /admin/* — separate audience "admin" (docs/06 §2, docs/05 §3).
 * @Public() exempts these routes from the global tenant JwtGuard;
 * AdminJwtGuard then enforces the admin audience.
 */
@Public()
@UseGuards(AdminJwtGuard)
@Controller("admin")
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly analytics: AdminAnalyticsService,
  ) {}

  @AdminPublic()
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(adminLoginSchema)) body: { email: string; password: string },
  ) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: body.email } });
    if (!admin || !(await bcrypt.compare(body.password, admin.passwordHash))) {
      throw new UnauthorizedException({
        error: { code: ERROR_CODES.AUTH_INVALID_CREDENTIALS, message: "Invalid credentials" },
      });
    }
    const accessToken = await this.jwt.signAsync(
      { sub: admin.id },
      { secret: process.env.JWT_SECRET, audience: JWT_AUDIENCE.ADMIN, expiresIn: "15m" },
    );
    return { accessToken };
  }

  /** Stub — real metrics in Session 8. Exists so audience tests are real. */
  @Get("metrics/overview")
  async metrics() {
    return this.prisma.withServiceBypass(async (tx) => {
      const [pharmacies, customers] = await Promise.all([
        tx.pharmacy.count(),
        tx.customer.count(),
      ]);
      return { pharmacies, customers };
    });
  }

  /** Platform business overview — revenue, subscribers, customers, 12-month trend. */
  @Get("overview")
  overview() {
    return this.analytics.overview();
  }

  /** Per-pharmacy performance: growth, tops, trend — flexible day/week/month/year. */
  @Get("pharmacies/:id/analytics")
  pharmacyAnalytics(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(adminAnalyticsQuerySchema)) q: AdminAnalyticsQuery,
  ) {
    return this.analytics.pharmacyAnalytics(id, q);
  }

  /** Blocking requires a reason (confirmation modal client-side; audited here). */
  @Post("pharmacies/:id/block")
  @HttpCode(200)
  block(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(adminBlockSchema)) body: AdminBlockInput,
    @Req() req: Request & { admin?: { sub: string } },
  ) {
    return this.analytics.setBlocked(id, true, req.admin?.sub ?? "unknown", body.reason, body.note);
  }

  @Post("pharmacies/:id/unblock")
  @HttpCode(200)
  unblock(@Param("id") id: string, @Req() req: Request & { admin?: { sub: string } }) {
    return this.analytics.setBlocked(id, false, req.admin?.sub ?? "unknown");
  }

  /** Metric layer — every dashboard widget queries these three. */
  @Get("analytics/kpis")
  kpis(@Query(new ZodValidationPipe(adminKpisQuerySchema)) q: AdminKpisQuery) {
    return this.analytics.platformKpis(q.from, q.to);
  }

  @Get("analytics/series")
  series(@Query(new ZodValidationPipe(adminSeriesQuerySchema)) q: AdminSeriesQuery) {
    return this.analytics.platformSeries(q.metric, q.from, q.to);
  }

  @Get("analytics/distribution")
  distribution(
    @Query(new ZodValidationPipe(adminDistributionQuerySchema)) q: AdminDistributionQuery,
  ) {
    return this.analytics.distribution(q);
  }

  /** Multi-sheet Excel (typed cells) honoring the dashboard's active range. */
  @Get("reports/export.xls")
  async exportXls(
    @Query(new ZodValidationPipe(adminKpisQuerySchema)) q: AdminKpisQuery,
    @Res() res: Response,
  ) {
    const out = await this.analytics.exportXls(q.from, q.to);
    res
      .status(200)
      .set({
        "Content-Type": "application/vnd.ms-excel",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
      })
      .send(out.xml);
  }

  /** Flat directory CSV — Excel / Power BI ready (English snake_case headers). */
  @Get("reports/pharmacies.csv")
  async pharmaciesCsv(@Res() res: Response) {
    sendCsv(res, await this.analytics.pharmaciesCsv());
  }

  /** Per-pharmacy time-series CSV for the chosen period. */
  @Get("reports/pharmacies/:id/analytics.csv")
  async analyticsCsv(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(adminAnalyticsQuerySchema)) q: AdminAnalyticsQuery,
    @Res() res: Response,
  ) {
    sendCsv(res, await this.analytics.analyticsCsv(id, q));
  }

  /** Platform KPIs + 12-month trend in one file — Power BI landing table. */
  @Get("reports/overview.csv")
  async overviewCsv(@Res() res: Response) {
    sendCsv(res, await this.analytics.overviewCsv());
  }

  @Get("reports/messaging.csv")
  async messagingCsv(@Res() res: Response) {
    sendCsv(res, await this.analytics.messagingCsv());
  }

  @Get("reports/audit.csv")
  async auditCsv(@Res() res: Response) {
    sendCsv(res, await this.analytics.auditCsv());
  }

  /** Super-admin tenant directory — plan management is the monetization lever. */
  @Get("pharmacies")
  async pharmacies(
    @Query(new ZodValidationPipe(adminPharmaciesQuerySchema)) q: AdminPharmaciesQuery,
  ) {
    return this.prisma.withServiceBypass(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          name: string;
          city: string | null;
          plan: string;
          createdAt: Date;
          blockedAt: Date | null;
          customers: bigint;
          users: bigint;
          sales30d: bigint;
          revenue30d: number | null;
          lastActive: Date | null;
        }[]
      >`
        SELECT p.id, p.name, p.city, p.plan::text AS plan, p."createdAt", p."blockedAt",
               (SELECT COUNT(*) FROM "Customer" c WHERE c."pharmacyId" = p.id AND c."deletedAt" IS NULL) AS customers,
               (SELECT COUNT(*) FROM "User" u WHERE u."pharmacyId" = p.id) AS users,
               (SELECT COUNT(*) FROM "Sale" s WHERE s."pharmacyId" = p.id AND s."createdAt" >= NOW() - INTERVAL '30 days') AS sales30d,
               (SELECT SUM(s."totalEgp" - s."discountEgp") FROM "Sale" s WHERE s."pharmacyId" = p.id AND s."createdAt" >= NOW() - INTERVAL '30 days') AS revenue30d,
               (SELECT MAX(s."createdAt") FROM "Sale" s WHERE s."pharmacyId" = p.id) AS "lastActive"
        FROM "Pharmacy" p`;
      const mapped = rows.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        plan: r.plan,
        createdAt: r.createdAt,
        blockedAt: r.blockedAt,
        customers: Number(r.customers),
        users: Number(r.users),
        sales30d: Number(r.sales30d),
        revenue30dEgp: Number(r.revenue30d ?? 0),
        lastActive: r.lastActive,
      }));
      const key = q.sort;
      mapped.sort((a, b) =>
        key === "name"
          ? a.name.localeCompare(b.name, "ar")
          : key === "created"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : (b.lastActive?.getTime() ?? 0) - (a.lastActive?.getTime() ?? 0),
      );
      return { data: mapped };
    });
  }

  @Get("pharmacies/:id")
  async pharmacy(@Param("id") id: string) {
    return this.prisma.withServiceBypass(async (tx) => {
      const pharmacy = await tx.pharmacy.findUnique({
        where: { id },
        select: {
          id: true, name: true, phone: true, city: true, plan: true,
          monthlyReminderCap: true, taxId: true, vatRate: true, createdAt: true,
          users: { select: { id: true, name: true, phone: true, role: true, isActive: true } },
        },
      });
      if (!pharmacy) {
        throw new NotFoundException({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Pharmacy not found" },
        });
      }
      const [customers, sales30d, messages30d] = await Promise.all([
        tx.customer.count({ where: { pharmacyId: id, deletedAt: null } }),
        tx.sale.count({ where: { pharmacyId: id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
        tx.message.count({ where: { pharmacyId: id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      ]);
      return { ...pharmacy, stats: { customers, sales30d, messages30d } };
    });
  }

  /** FREE ↔ PRO — audited (who flipped what, when). Unlocks campaigns. */
  @Patch("pharmacies/:id/plan")
  async patchPlan(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(adminPlanPatchSchema)) body: AdminPlanPatchInput,
    @Req() req: Request & { admin?: { sub: string } },
  ) {
    return this.prisma.withServiceBypass(async (tx) => {
      const pharmacy = await tx.pharmacy.findUnique({ where: { id }, select: { plan: true } });
      if (!pharmacy) {
        throw new NotFoundException({
          error: { code: ERROR_CODES.NOT_FOUND, message: "Pharmacy not found" },
        });
      }
      const updated = await tx.pharmacy.update({
        where: { id },
        data: { plan: body.plan },
        select: { id: true, name: true, plan: true },
      });
      await tx.auditLog.create({
        data: {
          pharmacyId: id,
          userId: `admin:${req.admin?.sub ?? "unknown"}`,
          action: "PLAN_CHANGE",
          entity: "Pharmacy",
          entityId: id,
          diff: { from: pharmacy.plan, to: body.plan },
        },
      });
      return updated;
    });
  }

  /** Cross-tenant audit trail (plan changes, deletes, points adjustments). */
  @Get("audit")
  async audit() {
    return this.prisma.withServiceBypass(async (tx) => {
      const rows = await tx.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { pharmacy: { select: { name: true } } },
      });
      return { data: rows };
    });
  }

  /**
   * S6 — messaging ops (docs/06): delivery rate, fallback ratio, cost per
   * pharmacy over the last 30 days. Built early for cost visibility.
   */
  @Get("messaging/stats")
  async messagingStats() {
    return this.prisma.withServiceBypass(async (tx) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const byStatus = await tx.message.groupBy({
        by: ["status", "channel"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });

      const perPharmacy = await tx.$queryRaw<
        {
          pharmacyId: string;
          name: string;
          total: bigint;
          delivered: bigint;
          failed: bigint;
          fallbacks: bigint;
          costMicro: bigint | null;
        }[]
      >`
        SELECT m."pharmacyId",
               p.name,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE m.status IN ('DELIVERED','READ')) AS delivered,
               COUNT(*) FILTER (WHERE m.status = 'FAILED') AS failed,
               COUNT(*) FILTER (WHERE m.status = 'FALLBACK_TRIGGERED') AS fallbacks,
               SUM(m."costMicro") AS "costMicro"
        FROM "Message" m
        JOIN "Pharmacy" p ON p.id = m."pharmacyId"
        WHERE m."createdAt" >= ${since}
        GROUP BY m."pharmacyId", p.name
        ORDER BY total DESC`;

      const total = perPharmacy.reduce((s, r) => s + Number(r.total), 0);
      const delivered = perPharmacy.reduce((s, r) => s + Number(r.delivered), 0);
      const fallbacks = perPharmacy.reduce((s, r) => s + Number(r.fallbacks), 0);

      return {
        windowDays: 30,
        totals: {
          messages: total,
          deliveryRate: total ? delivered / total : 0,
          fallbackRatio: total ? fallbacks / total : 0,
        },
        byStatus: byStatus.map((r) => ({
          status: r.status,
          channel: r.channel,
          count: r._count._all,
        })),
        perPharmacy: perPharmacy.map((r) => ({
          pharmacyId: r.pharmacyId,
          name: r.name,
          messages: Number(r.total),
          deliveryRate: Number(r.total) ? Number(r.delivered) / Number(r.total) : 0,
          fallbackRatio: Number(r.total) ? Number(r.fallbacks) / Number(r.total) : 0,
          failed: Number(r.failed),
          costEgp: Number(r.costMicro ?? 0) / 1_000_000,
        })),
      };
    });
  }
}
