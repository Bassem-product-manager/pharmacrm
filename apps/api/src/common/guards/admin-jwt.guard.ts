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

export const IS_ADMIN_PUBLIC = "isAdminPublic";
export const AdminPublic = () => SetMetadata(IS_ADMIN_PUBLIC, true);

export interface AdminJwtPayload {
  sub: string; // adminUserId
  aud: string;
}

/**
 * Guards /admin/* — accepts ONLY tokens with audience "admin".
 * Tenant tokens (audience "tenant") are rejected here, and admin tokens are
 * rejected by JwtGuard on tenant routes: audiences are mutually exclusive.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminJwtPayload }>();
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: process.env.JWT_SECRET,
        audience: JWT_AUDIENCE.ADMIN,
      });
      req.admin = payload;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
