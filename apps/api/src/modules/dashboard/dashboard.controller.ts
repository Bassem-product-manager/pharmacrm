import { Controller, Get, Query } from "@nestjs/common";
import { dashboardQuerySchema, type DashboardQuery } from "@pharmacrm/shared";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { DashboardService } from "./dashboard.service";

/** GET /dashboard/summary — all stat cards + trend in one tenant-scoped call. */
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  summary(@Query(new ZodValidationPipe(dashboardQuerySchema)) q: DashboardQuery) {
    return this.dashboard.summary(q);
  }
}
