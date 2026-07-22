import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerRequest } from "@nestjs/throttler";

/**
 * /auth/login: 5/min per IP AND 5/min per phone (docs/05 §5).
 * Two named throttlers are declared on the route ("login-ip", "login-phone");
 * this guard picks the tracker per throttler name:
 *  - login-ip    → client IP
 *  - login-phone → body.phone (raw; normalization differences only make it stricter)
 * Any other throttler name falls back to IP (global default).
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const req = context.switchToHttp().getRequest();

    if (throttler.name === "login-phone") {
      const phone = typeof req.body?.phone === "string" ? req.body.phone : "unknown";
      requestProps.getTracker = async () => `phone:${phone}`;
    } else {
      requestProps.getTracker = async () =>
        `ip:${req.ips?.length ? req.ips[0] : req.ip ?? "unknown"}`;
    }
    return super.handleRequest(requestProps);
  }
}
