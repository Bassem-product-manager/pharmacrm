import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/guards/jwt.guard";

/**
 * Liveness probe (Render healthCheckPath + keep-awake cron). MUST be @Public()
 * or the global JwtGuard returns 401 and Render marks every deploy unhealthy.
 * Kept dependency-free (no DB call) so a DB blip can't take the service down.
 */
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  health(): { status: string } {
    return { status: "ok" };
  }
}
