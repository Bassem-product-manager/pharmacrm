import { z } from "zod";

/**
 * Egyptian mobile phone schema.
 *
 * Accepts: 01xxxxxxxxx / +201xxxxxxxxx / 00201xxxxxxxxx
 * (with optional spaces, dashes, or parentheses)
 * Normalizes to E.164: +201xxxxxxxxx
 * Only mobile prefixes 010 / 011 / 012 / 015 are valid.
 */
const VALID_PREFIXES = ["10", "11", "12", "15"] as const;

export const phoneSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    // strip spaces, dashes, parentheses
    const cleaned = raw.replace(/[\s\-()]/g, "");

    let subscriber: string | null = null; // "1xxxxxxxxx" (10 digits, starts with 1)

    if (/^\+20\d+$/.test(cleaned)) {
      subscriber = cleaned.slice(3);
    } else if (/^0020\d+$/.test(cleaned)) {
      subscriber = cleaned.slice(4);
    } else if (/^20\d{10}$/.test(cleaned)) {
      subscriber = cleaned.slice(2);
    } else if (/^0\d+$/.test(cleaned)) {
      subscriber = cleaned.slice(1);
    }

    if (subscriber === null || !/^\d{10}$/.test(subscriber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "رقم موبايل غير صالح — Invalid Egyptian mobile number",
      });
      return z.NEVER;
    }

    const prefix = subscriber.slice(0, 2); // "10" | "11" | "12" | "15"
    if (subscriber[0] !== "1" || !VALID_PREFIXES.includes(prefix as never)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "الرقم يجب أن يبدأ بـ 010 أو 011 أو 012 أو 015 — Must start with 010/011/012/015",
      });
      return z.NEVER;
    }

    return `+20${subscriber}`;
  });

export type NormalizedPhone = z.infer<typeof phoneSchema>;
