import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";

/**
 * docs/04 Flow 4 — nightly maintenance:
 *  1. Heal pointsBalance drift from the PointsTransaction ledger (D1).
 *  2. Aggregate yesterday's Message.costMicro per pharmacy (admin billing view).
 *  3. Monthly reminder caps live in Redis keys `remcap:{pharmacyId}:{YYYY-MM}`
 *     that expire on their own — nothing to reset on month boundary.
 * (INACTIVE is computed at query time — nothing to update; R8.)
 */
@Injectable()
export class NightlyService {
  private readonly logger = new Logger(NightlyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(): Promise<{ healed: number }> {
    // ---- 1. heal balances where denormalized value drifted from the ledger ----
    const healed = await this.prisma.withServiceBypass((tx) =>
      tx.$executeRaw`
        UPDATE "Customer" c
        SET "pointsBalance" = COALESCE(l.total, 0)
        FROM (
          SELECT "customerId", SUM(points)::int AS total
          FROM "PointsTransaction"
          GROUP BY "customerId"
        ) l
        WHERE l."customerId" = c.id
          AND c."pointsBalance" IS DISTINCT FROM COALESCE(l.total, 0)`,
    );
    if (healed > 0) this.logger.warn(`Nightly: healed pointsBalance drift on ${healed} customer(s)`);

    // ---- 2. daily cost aggregate per pharmacy (logged; admin table = Session 8) ----
    const costs = await this.prisma.withServiceBypass((tx) =>
      tx.$queryRaw<{ pharmacyId: string; costMicro: bigint | null; msgs: bigint }[]>`
        SELECT "pharmacyId", SUM("costMicro") AS "costMicro", COUNT(*) AS msgs
        FROM "Message"
        WHERE "createdAt" >= now() - interval '1 day'
        GROUP BY "pharmacyId"`,
    );
    for (const row of costs) {
      this.logger.log(
        `Nightly cost: pharmacy=${row.pharmacyId} messages=${row.msgs} costMicro=${row.costMicro ?? 0}`,
      );
    }

    return { healed };
  }
}
