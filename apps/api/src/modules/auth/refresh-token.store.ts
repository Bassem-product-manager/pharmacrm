import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { REDIS } from "../../common/redis.module";

const REFRESH_TTL_SEC = 7 * 24 * 60 * 60; // 7d

const familyKey = (userId: string, familyId: string) => `refresh:${userId}:${familyId}`;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Rotating refresh-token family store (docs/05 §2).
 * Key: refresh:{userId}:{familyId} → sha256 of the CURRENT token in the family.
 * - rotate: replaces the hash. Presenting a token whose hash != current
 *   (but family still exists) = reuse → whole family revoked.
 */
@Injectable()
export class RefreshTokenStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  newFamilyId(): string {
    return randomUUID();
  }

  async saveCurrent(userId: string, familyId: string, token: string): Promise<void> {
    await this.redis.set(familyKey(userId, familyId), sha256(token), "EX", REFRESH_TTL_SEC);
  }

  /**
   * @returns "ok" if token is the family's current token,
   *          "reused" if family exists but token is stale (rotation reuse attack),
   *          "unknown" if family missing/expired/revoked.
   */
  async check(userId: string, familyId: string, token: string): Promise<"ok" | "reused" | "unknown"> {
    const current = await this.redis.get(familyKey(userId, familyId));
    if (!current) return "unknown";
    return current === sha256(token) ? "ok" : "reused";
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    await this.redis.del(familyKey(userId, familyId));
  }

  async revokeAll(userId: string): Promise<void> {
    const keys = await this.redis.keys(`refresh:${userId}:*`);
    if (keys.length) await this.redis.del(...keys);
  }
}
