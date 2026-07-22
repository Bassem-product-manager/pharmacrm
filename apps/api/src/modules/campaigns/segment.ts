import { Prisma } from "@prisma/client";
import type { SegmentInput } from "@pharmacrm/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Segment JSON → Customer where-clause. Opted-out customers are excluded at
 * COUNT time (they must never inflate recipients/cost), but the batch walk
 * passes includeOptedOut so the send gate records a SKIPPED_OPTOUT message
 * for anyone opted out — audit trail for late opt-outs (R3), and the provider
 * is still never called.
 */
export function buildSegmentWhere(
  segment: SegmentInput,
  opts: { includeOptedOut?: boolean } = {},
): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (!opts.includeOptedOut) where.optedOutAt = null;
  if (segment.tags && segment.tags.length > 0) where.tags = { hasSome: segment.tags };
  if (segment.inactiveDays) {
    where.lastVisitAt = { lt: new Date(Date.now() - segment.inactiveDays * DAY_MS) };
  }
  if (segment.minPoints !== undefined) where.pointsBalance = { gte: segment.minPoints };
  return where;
}
