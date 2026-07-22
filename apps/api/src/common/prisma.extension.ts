/**
 * Tenant-scope Prisma client extension (R6 — defense in depth, layer 1).
 * Layer 2 is Postgres RLS (see prisma/migrations/*_rls).
 *
 * - Injects pharmacyId into every query on tenant-bound models.
 * - Throws TenantContextMissingError when no tenant context is set.
 * - Exempt: Pharmacy (the tenant itself), AdminUser (outside tenant model).
 * - Models without a direct pharmacyId column are scoped through their
 *   parent relation (SaleItem→sale, RefillRule→customer, Reminder→refillRule.customer).
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { getPharmacyId, TenantContextMissingError } from "./tenant-context";

const EXEMPT_MODELS = new Set(["Pharmacy", "AdminUser"]);

/** Models with a direct pharmacyId column. */
const DIRECT_MODELS = new Set([
  "User",
  "Customer",
  "ProductRef",
  "Sale",
  "PointsTransaction",
  "Campaign",
  "Message",
  "AuditLog",
]);

/** Models scoped via a parent relation: model → relation filter builder. */
const RELATION_FILTERS: Record<string, (pharmacyId: string) => object> = {
  SaleItem: (pharmacyId) => ({ sale: { pharmacyId } }),
  RefillRule: (pharmacyId) => ({ customer: { pharmacyId } }),
  Reminder: (pharmacyId) => ({ refillRule: { customer: { pharmacyId } } }),
};

const READ_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const WHERE_WRITE_OPS = new Set(["updateMany", "deleteMany", "update", "delete", "upsert"]);
const CREATE_OPS = new Set(["create", "createMany"]);
/**
 * Unique-where ops require the unique field at the TOP level of `where`
 * (Prisma rejects {AND:[{id}]}), so the tenant filter is merged in via AND
 * alongside the unique key (extendedWhereUnique, GA in Prisma 5).
 */
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

function tenantFilter(model: string, pharmacyId: string): object {
  return DIRECT_MODELS.has(model) ? { pharmacyId } : RELATION_FILTERS[model]!(pharmacyId);
}

function scopedWhere(model: string, operation: string, where: object | undefined, pharmacyId: string): object {
  const filter = tenantFilter(model, pharmacyId);
  if (UNIQUE_WHERE_OPS.has(operation)) {
    const existing = (where ?? {}) as Record<string, unknown>;
    const priorAnd = existing.AND;
    const and = priorAnd ? (Array.isArray(priorAnd) ? [...priorAnd, filter] : [priorAnd, filter]) : [filter];
    return { ...existing, AND: and };
  }
  return { AND: [filter, where ?? {}] };
}

export function createTenantExtension() {
  return Prisma.defineExtension({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || EXEMPT_MODELS.has(model)) return query(args);
          if (!DIRECT_MODELS.has(model) && !RELATION_FILTERS[model]) return query(args);

          const pharmacyId = getPharmacyId();
          if (!pharmacyId) throw new TenantContextMissingError(model, operation);

          const a = args as Record<string, unknown>;

          if (READ_OPS.has(operation) || WHERE_WRITE_OPS.has(operation)) {
            a.where = scopedWhere(model, operation, a.where as object | undefined, pharmacyId);
          }

          if (CREATE_OPS.has(operation) && DIRECT_MODELS.has(model)) {
            if (operation === "create") {
              const data = (a.data ?? {}) as Record<string, unknown>;
              // Respect nested relation syntax if present; otherwise force scalar
              if (!data.pharmacy) data.pharmacyId = pharmacyId;
              a.data = data;
            } else {
              const rows = (Array.isArray(a.data) ? a.data : [a.data]) as Record<string, unknown>[];
              for (const row of rows) row.pharmacyId = pharmacyId;
            }
          }

          if (operation === "upsert" && DIRECT_MODELS.has(model)) {
            const create = (a.create ?? {}) as Record<string, unknown>;
            if (!create.pharmacy) create.pharmacyId = pharmacyId;
            a.create = create;
          }

          return query(args);
        },
      },
    },
  });
}

/** Convenience factory: extended client type. */
export function createTenantScopedClient(base: PrismaClient) {
  return base.$extends(createTenantExtension());
}

export type TenantScopedClient = ReturnType<typeof createTenantScopedClient>;
