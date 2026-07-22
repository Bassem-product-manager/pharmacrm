import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./common/prisma.module";
import { RedisModule } from "./common/redis.module";
import { JwtGuard } from "./common/guards/jwt.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { LoginThrottlerGuard } from "./common/guards/login-throttler.guard";
import { TenantScopeInterceptor } from "./common/interceptors/tenant-scope.interceptor";
import { HealthController } from "./health.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { AdminModule } from "./modules/admin/admin.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { SalesModule } from "./modules/sales/sales.module";
import { ProductsModule } from "./modules/products/products.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { MessagingModule } from "./modules/messaging/messaging.module";
import { RefillsModule } from "./modules/refills/refills.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { JobsModule } from "./jobs/jobs.module";

/**
 * Global wiring (docs/05 §2).
 * Guard order: LoginThrottlerGuard → JwtGuard → RolesGuard; then
 * TenantScopeInterceptor runs the handler inside AsyncLocalStorage carrying
 * the verified pharmacyId. JwtModule is global so the app-level JwtGuard can
 * inject JwtService. Login is tightened to 5/min per-ip and per-phone via the
 * @Throttle decorator on the route; every other route keeps the loose default.
 */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    JwtModule.register({ global: true }),
    ThrottlerModule.forRoot([
      { name: "login-ip", ttl: 60_000, limit: 10_000 },
      { name: "login-phone", ttl: 60_000, limit: 10_000 },
    ]),
    AuthModule,
    AdminModule,
    CustomersModule,
    CampaignsModule,
    SalesModule,
    ProductsModule,
    AnalyticsModule,
    MessagingModule,
    RefillsModule,
    DashboardModule,
    SettingsModule,
    ReportsModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: LoginThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
})
export class AppModule {}
