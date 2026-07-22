import { z } from "zod";
import { phoneSchema } from "./phone";
import { tagSchema } from "./customers";

/**
 * Session 5 — Quick Sale (docs/04 Flow 1 + docs/05 §3).
 *
 * Money model (docs/04 Flow 1, authoritative):
 *  - totalEgp     = gross amount as entered by staff (stored on Sale.totalEgp)
 *  - redeemPoints = loyalty points spent on THIS sale;
 *                   discountEgp = round2(redeemPoints × pharmacy.redeemRate)
 *                   (points are the ONLY discount source — no manual discount)
 *  - earnedPoints = floor((totalEgp − discountEgp) × pharmacy.loyaltyRatio)
 *  - clientRef    = REQUIRED offline-idempotency uuid (docs/05 §1). Replaying
 *                   the same clientRef returns the original sale with HTTP 200.
 */
export const saleItemInputSchema = z.object({
  nameText: z.string().trim().min(1).max(200),
  qty: z.coerce.number().int().min(1).max(10_000).default(1),
  productRefId: z.string().cuid().optional(), // set when autocomplete matched a ProductRef
  unitPriceEgp: z.coerce.number().nonnegative().max(1_000_000).default(0), // price per unit
  notes: z.string().trim().max(500).optional(), // e.g. dosage, substitution
});
export type SaleItemInput = z.input<typeof saleItemInputSchema>;

/** Inline customer creation inside POST /sales (Flow 1 step 2). */
export const newSaleCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  tags: z.array(tagSchema).default([]),
});
export type NewSaleCustomerInput = z.input<typeof newSaleCustomerSchema>;

export const createSaleSchema = z
  .object({
    clientRef: z.string().uuid(),
    customerId: z.string().cuid().optional(),
    newCustomer: newSaleCustomerSchema.optional(),
    items: z.array(saleItemInputSchema).min(1).max(100),
    // Optional: when omitted the server auto-sums Σ(unitPrice × qty). When
    // present it is an explicit override (rounding / ad-hoc discount).
    totalEgp: z.coerce.number().positive().max(1_000_000).optional(),
    notes: z.string().trim().max(1000).optional(), // order-level note
    redeemPoints: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  })
  .superRefine((val, ctx) => {
    if (!!val.customerId === !!val.newCustomer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Provide exactly one of customerId or newCustomer",
      });
    }
  });
export type CreateSaleInput = z.input<typeof createSaleSchema>;
export type CreateSale = z.infer<typeof createSaleSchema>;

/** GET /sales?date=&cursor= — date is a calendar day in Africa/Cairo. */
export const salesQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SalesQuery = z.infer<typeof salesQuerySchema>;

/** GET /products/suggest?q= — empty q returns most recent products. */
export const productSuggestQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
});
export type ProductSuggestQuery = z.infer<typeof productSuggestQuerySchema>;
