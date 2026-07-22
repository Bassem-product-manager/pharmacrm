import { z } from "zod";

/**
 * Session 7 — Medicine formulary (دليل الأدوية). The pharmacy's own catalog of
 * every medicine it stocks: name, description, manufacturer, category, unit
 * price, and stock on hand. Rows may also be auto-stubbed by POST /sales
 * (name only) and enriched here later.
 */

/** Shared field rules reused by create + update. */
const nameText = z.string().trim().min(1).max(200);
const description = z.string().trim().max(2000);
const company = z.string().trim().max(200);
const category = z.string().trim().max(120);
const priceEgp = z.coerce.number().nonnegative().max(1_000_000);
const stock = z.coerce.number().int().min(-1_000_000).max(1_000_000);

export const createProductSchema = z.object({
  nameText,
  description: description.optional(),
  company: company.optional(),
  category: category.optional(),
  priceEgp: priceEgp.optional(),
  stock: stock.default(0),
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
export type CreateProductInput = z.input<typeof createProductSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;

/** All fields optional; at least one must be present. */
export const updateProductSchema = z
  .object({
    nameText: nameText.optional(),
    description: description.nullable().optional(),
    company: company.nullable().optional(),
    category: category.nullable().optional(),
    priceEgp: priceEgp.nullable().optional(),
    stock: stock.optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });
export type UpdateProductInput = z.input<typeof updateProductSchema>;

/** GET /products?search=&category=&lowStock=&cursor= — catalog list. */
export const productsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  lowStock: z.coerce.boolean().optional(), // stock <= threshold
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductsQuery = z.infer<typeof productsQuerySchema>;

/** Stock at or below this is surfaced as "low" in UI + warnings. */
export const LOW_STOCK_THRESHOLD = 5;
