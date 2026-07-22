import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tenantStorage } from "../tenant-context";
import type { AuthedRequest } from "../guards/jwt.guard";

/**
 * Runs the rest of the request pipeline inside AsyncLocalStorage carrying
 * pharmacyId from the VERIFIED JWT (set by JwtGuard). This feeds:
 *  - the tenant Prisma extension (layer 1)
 *  - PrismaService.withTenantRls SET LOCAL (layer 2)
 * Order: JwtGuard → TenantScopeInterceptor → RolesGuard (docs/05 §2).
 */
@Injectable()
export class TenantScopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const pharmacyId = req.user?.pharmacyId;
    if (!pharmacyId) return next.handle(); // public/admin routes — no tenant
    // Subscribe INSIDE storage.run — Nest subscribes after intercept() returns,
    // so `tenantStorage.run(..., () => next.handle())` alone would leak context.
    return new Observable((subscriber) => {
      tenantStorage.run({ pharmacyId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
