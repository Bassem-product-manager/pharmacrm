import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { createSaleSchema, salesQuerySchema, type SalesQuery } from "@pharmacrm/shared";
import type { AuthedRequest } from "../../common/guards/jwt.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { SalesService } from "./sales.service";

/**
 * Session 5 — Quick Sale. No pharmacyId anywhere: the tenant extension + RLS
 * scope everything from the verified JWT. Both OWNER and STAFF may log sales.
 */
@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** docs/05 §1: replaying a clientRef returns the EXISTING sale with 200, not 201. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(createSaleSchema))
    body: ReturnType<typeof createSaleSchema.parse>,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sales.create(body, req.user.sub);
    res.status(result.idempotentReplay ? 200 : 201);
    return result;
  }

  @Get()
  list(@Query(new ZodValidationPipe(salesQuerySchema)) q: SalesQuery) {
    return this.sales.list(q);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.sales.getById(id);
  }

  /** الفاتورة الضريبية — assigns the sequential invoice number on first issue. */
  @Get(":id/invoice")
  invoice(@Param("id") id: string) {
    return this.sales.getInvoice(id);
  }
}
