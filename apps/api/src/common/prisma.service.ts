import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createTenantExtension } from "./prisma.extension";
import { getPharmacyId, TenantContextMissingError } from "./tenant-context";

/**
 * Base Prisma client (no tenant scoping) — for auth/signup/admin flows only.
 * Everything tenant-bound must go through `tenant` or `withTenantRls`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Tenant-scoped client (layer 1 — Prisma extension). */
  readonly tenant = this.$extends(createTenantExtension());

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Layer 2 — Postgres RLS. Runs `fn` inside an interactive transaction with
   * SET LOCAL app.pharmacy_id, so RLS policies apply even to raw SQL.
   * pharmacyId comes from AsyncLocalStorage (set by TenantScopeInterceptor).
   */
  async withTenantRls<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const pharmacyId = getPharmacyId();
    if (!pharmacyId) throw new TenantContextMissingError("(rls)", "withTenantRls");
    if (!/^[A-Za-z0-9_-]+$/.test(pharmacyId)) {
      throw new Error("Invalid pharmacyId format");
    }
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.pharmacy_id = '${pharmacyId}'`);
      return fn(tx);
    });
  }

  /**
   * Service bypass for pre-tenant flows ONLY (auth login/signup, /admin/*).
   * Opens the RLS service_bypass policy via SET LOCAL — scoped to this
   * transaction, fail-closed everywhere else. Never call from tenant routes.
   */
  async withServiceBypass<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return fn(tx);
    });
  }
}
