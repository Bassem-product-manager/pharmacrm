import { z } from "zod";
import { phoneSchema } from "./phone";

export const TAGS = ["CHRONIC", "VIP"] as const; // R8: INACTIVE is computed, never stored
export const tagSchema = z.enum(TAGS);

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  birthYear: z.number().int().min(1900).max(2030).optional(),
  tags: z.array(tagSchema).default([]),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  gender: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2030).nullable().optional(),
  tags: z.array(tagSchema).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** true → set optedOutAt=now; false → clear it */
  optedOut: z.boolean().optional(),
});
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

export const customersQuerySchema = z.object({
  /** partial phone (any position) OR name substring — one param covers both */
  search: z.string().trim().max(120).optional(),
  tag: tagSchema.optional(),
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomersQuery = z.infer<typeof customersQuerySchema>;

export const pointsAdjustSchema = z.object({
  points: z
    .number()
    .int()
    .refine((n) => n !== 0, "points must be non-zero"),
  reason: z.string().trim().min(2).max(500),
});
export type PointsAdjustInput = z.input<typeof pointsAdjustSchema>;

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;
