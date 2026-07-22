import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createRefillRuleSchema,
  refillsQueueQuerySchema,
  snoozeSchema,
  updateRefillRuleSchema,
  type RefillsQueueQuery,
} from "@pharmacrm/shared";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { RefillsService } from "./refills.service";

/** docs/05 §3 Refills — all tenant-scoped via JWT (no pharmacyId anywhere). */
@Controller()
export class RefillsController {
  constructor(private readonly refills: RefillsService) {}

  @Post("customers/:id/refill-rules")
  createRule(
    @Param("id") customerId: string,
    @Body(new ZodValidationPipe(createRefillRuleSchema))
    body: ReturnType<typeof createRefillRuleSchema.parse>,
  ) {
    return this.refills.createRule(customerId, body);
  }

  @Patch("refill-rules/:id")
  updateRule(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRefillRuleSchema))
    body: ReturnType<typeof updateRefillRuleSchema.parse>,
  ) {
    return this.refills.updateRule(id, body);
  }

  @Get("refills/queue")
  queue(@Query(new ZodValidationPipe(refillsQueueQuerySchema)) q: RefillsQueueQuery) {
    return this.refills.queue(q);
  }

  @Post("reminders/:id/send-now")
  sendNow(@Param("id") id: string) {
    return this.refills.sendNow(id);
  }

  @Post("reminders/:id/mark-purchased")
  markPurchased(@Param("id") id: string) {
    return this.refills.markPurchased(id);
  }

  @Post("reminders/:id/snooze")
  snooze(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(snoozeSchema)) body: ReturnType<typeof snoozeSchema.parse>,
  ) {
    return this.refills.snooze(id, body);
  }
}
