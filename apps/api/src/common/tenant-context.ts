import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  pharmacyId: string;
}

/**
 * AsyncLocalStorage carrying the current request's pharmacyId.
 * Set from the JWT by TenantScope middleware/guard (Session 3) —
 * NEVER from client-supplied body/query values.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getPharmacyId(): string | undefined {
  return tenantStorage.getStore()?.pharmacyId;
}

export function runWithTenant<T>(pharmacyId: string, fn: () => T): T {
  return tenantStorage.run({ pharmacyId }, fn);
}

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Tenant context (pharmacyId) not set for ${model}.${operation}. ` +
        `All tenant-bound queries must run inside runWithTenant().`,
    );
    this.name = "TenantContextMissingError";
  }
}
