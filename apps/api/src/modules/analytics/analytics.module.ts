import { Global, Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";

/** Global: any module may emit product events without wiring imports. */
@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
