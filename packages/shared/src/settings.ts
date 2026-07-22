import { z } from "zod";

/**
 * GET/PATCH /settings — pharmacy profile + invoice/tax + messaging window.
 * GET/PATCH /loyalty/settings — the loyalty knobs only (S60).
 * PATCH is OWNER-only on both (RolesGuard in controller).
 */
export const patchSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().max(120).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    /** البطاقة الضريبية — printed on tax invoices */
    taxId: z.string().trim().max(60).nullable().optional(),
    /** % — sale prices are treated as VAT-inclusive; 0 for exempt goods */
    vatRate: z.number().min(0).max(100).optional(),
    smsSenderName: z.string().trim().max(11).nullable().optional(),
    smsFallback: z.boolean().optional(),
    quietStart: z.number().int().min(0).max(23).optional(),
    quietEnd: z.number().int().min(0).max(23).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty patch");
export type PatchSettingsInput = z.input<typeof patchSettingsSchema>;

export const patchLoyaltySchema = z
  .object({
    /** points earned per 1 EGP spent */
    loyaltyRatio: z.number().min(0).max(10).optional(),
    /** EGP value of 1 point at redemption */
    redeemRate: z.number().min(0).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "empty patch");
export type PatchLoyaltyInput = z.input<typeof patchLoyaltySchema>;
