import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { ERROR_CODES, JWT_AUDIENCE, type LoginInput, type SignupInput } from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";
import { RefreshTokenStore } from "./refresh-token.store";

const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshPayload {
  sub: string;
  pharmacyId: string;
  role: "OWNER" | "STAFF";
  familyId: string;
  aud: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshStore: RefreshTokenStore,
  ) {}

  /** Pharmacy + OWNER in one TX (docs/05 §2). Uses BASE client — no tenant yet. */
  async signup(input: SignupInput & { phone: string; password: string }) {
    const existing = await this.prisma.withServiceBypass((tx) =>
      tx.user.findUnique({ where: { phone: input.phone } }),
    );
    if (existing) {
      throw new ConflictException({
        error: { code: ERROR_CODES.AUTH_PHONE_TAKEN, message: "Phone already registered" },
      });
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const { pharmacy, owner } = await this.prisma.withServiceBypass(async (tx) => {
      const pharmacy = await tx.pharmacy.create({
        data: {
          name: input.pharmacyName,
          phone: input.phone,
          city: input.city,
        },
      });
      const owner = await tx.user.create({
        data: {
          pharmacyId: pharmacy.id,
          name: input.ownerName,
          phone: input.phone,
          passwordHash,
          role: "OWNER",
        },
      });
      return { pharmacy, owner };
    });
    const tokens = await this.issueTokens(owner.id, pharmacy.id, "OWNER");
    return { pharmacyId: pharmacy.id, userId: owner.id, ...tokens };
  }

  async login(input: LoginInput & { phone: string }) {
    const user = await this.prisma.withServiceBypass((tx) =>
      tx.user.findUnique({ where: { phone: input.phone }, include: { pharmacy: { select: { blockedAt: true } } } }),
    );
    if (!user || !user.isActive || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException({
        error: { code: ERROR_CODES.AUTH_INVALID_CREDENTIALS, message: "Invalid phone or password" },
      });
    }
    this.assertNotBlocked(user.pharmacy.blockedAt);
    const tokens = await this.issueTokens(user.id, user.pharmacyId, user.role);
    return { userId: user.id, role: user.role, name: user.name, ...tokens };
  }

  /** Rotation + reuse detection. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
        audience: JWT_AUDIENCE.TENANT,
      });
    } catch {
      throw new UnauthorizedException({
        error: { code: ERROR_CODES.AUTH_REFRESH_INVALID, message: "Invalid refresh token" },
      });
    }

    const state = await this.refreshStore.check(payload.sub, payload.familyId, refreshToken);
    if (state === "reused") {
      // Reuse attack: revoke the entire family (docs/05 §2)
      await this.refreshStore.revokeFamily(payload.sub, payload.familyId);
      throw new UnauthorizedException({
        error: { code: ERROR_CODES.AUTH_REFRESH_REUSED, message: "Refresh token reuse detected" },
      });
    }
    if (state === "unknown") {
      throw new UnauthorizedException({
        error: { code: ERROR_CODES.AUTH_REFRESH_INVALID, message: "Refresh token revoked or expired" },
      });
    }

    // blocked pharmacies can't mint new sessions — existing access tokens
    // age out in <=15m, so a block takes full effect within that window
    const pharmacy = await this.prisma.withServiceBypass((tx) =>
      tx.pharmacy.findUnique({ where: { id: payload.pharmacyId }, select: { blockedAt: true } }),
    );
    this.assertNotBlocked(pharmacy?.blockedAt ?? null);

    return this.rotate(payload.sub, payload.pharmacyId, payload.role, payload.familyId);
  }

  private assertNotBlocked(blockedAt: Date | null): void {
    if (blockedAt) {
      throw new ForbiddenException({
        error: { code: ERROR_CODES.ACCOUNT_BLOCKED, message: "This pharmacy account is blocked" },
      });
    }
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
        audience: JWT_AUDIENCE.TENANT,
        ignoreExpiration: true,
      });
      await this.refreshStore.revokeFamily(payload.sub, payload.familyId);
    } catch {
      /* already invalid — nothing to revoke */
    }
  }

  private async issueTokens(userId: string, pharmacyId: string, role: "OWNER" | "STAFF") {
    const familyId = this.refreshStore.newFamilyId();
    return this.rotate(userId, pharmacyId, role, familyId);
  }

  private async rotate(
    userId: string,
    pharmacyId: string,
    role: "OWNER" | "STAFF",
    familyId: string,
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, pharmacyId, role },
      { secret: process.env.JWT_SECRET, audience: JWT_AUDIENCE.TENANT, expiresIn: ACCESS_TTL },
    );
    // jti: JWT iat is second-granular — without a unique id, two rotations in
    // the same second mint byte-identical tokens and rotation silently no-ops.
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, pharmacyId, role, familyId, jti: randomUUID() },
      { secret: process.env.JWT_REFRESH_SECRET, audience: JWT_AUDIENCE.TENANT, expiresIn: REFRESH_TTL },
    );
    await this.refreshStore.saveCurrent(userId, familyId, refreshToken);
    return { accessToken, refreshToken };
  }
}
