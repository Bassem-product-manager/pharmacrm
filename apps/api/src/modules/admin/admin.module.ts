import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AdminController } from "./admin.controller";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminController],
  providers: [AdminAnalyticsService],
})
export class AdminModule {}
