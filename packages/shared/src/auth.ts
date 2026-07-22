import { z } from "zod";
import { phoneSchema } from "./phone";

export const passwordSchema = z
  .string()
  .min(8, "كلمة المرور 8 أحرف على الأقل — Password must be at least 8 characters");

export const signupSchema = z.object({
  pharmacyName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(120),
  phone: phoneSchema, // owner login phone, normalized E.164
  password: passwordSchema,
  city: z.string().trim().max(120).optional(),
});
export type SignupInput = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1),
});
export type LoginInput = z.input<typeof loginSchema>;

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type AdminLoginInput = z.input<typeof adminLoginSchema>;

export const ROLES = ["OWNER", "STAFF"] as const;
export type RoleName = (typeof ROLES)[number];

/** JWT audiences — tenant tokens are never valid on /admin/* and vice versa. */
export const JWT_AUDIENCE = {
  TENANT: "tenant",
  ADMIN: "admin",
} as const;

/** Stable error codes (docs/05 §1) — Arabic rendered client-side. */
export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_REFRESH_REUSED: "AUTH_REFRESH_REUSED",
  AUTH_REFRESH_INVALID: "AUTH_REFRESH_INVALID",
  AUTH_FORBIDDEN_ROLE: "AUTH_FORBIDDEN_ROLE",
  AUTH_PHONE_TAKEN: "AUTH_PHONE_TAKEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  POINTS_INSUFFICIENT: "POINTS_INSUFFICIENT",
  NOT_FOUND: "NOT_FOUND",
  /** campaigns are PRO-only (docs/05 §6) */
  PLAN_UPGRADE_REQUIRED: "PLAN_UPGRADE_REQUIRED",
  /** e.g. sending a cancelled campaign */
  CAMPAIGN_INVALID_STATE: "CAMPAIGN_INVALID_STATE",
  /** pharmacy blocked by super admin — login/refresh rejected */
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
