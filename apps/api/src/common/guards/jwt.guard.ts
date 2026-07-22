import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { JWT_AUDIENCE } from "@pharmacrm/shared";

export const IS_PUBLIC = "isPublic";
/** Marks a route as public (no JWT). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface TenantJwtPayload {
  sub: string; // userId
  pharmacyId: string;
  role: "OWNER" | "STAFF";
  aud: string;
  jti?: string;
}

export interface AuthedRequest extends Request {
  user: TenantJwtPayload;
}

/**
 * Verifies tenant access tokens (audience "tenant").
 * pharmacyId is read from the verified JWT payload ONLY — never from client input.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<TenantJwtPayload>(token, {
        secret: process.env.JWT_SECRET,
        audience: JWT_AUDIENCE.TENANT,
      });
      if (!payload.pharmacyId) throw new Error("no tenant");
      req.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
