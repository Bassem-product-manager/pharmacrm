import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  createCustomerSchema,
  cursorQuerySchema,
  customersQuerySchema,
  pointsAdjustSchema,
  updateCustomerSchema,
  type CursorQuery,
  type CustomersQuery,
} from "@pharmacrm/shared";
import type { AuthedRequest } from "../../common/guards/jwt.guard";
import { Roles } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { CustomersService } from "./customers.service";

/**
 * docs/05 §3 Customers. No pharmacyId anywhere — tenant extension + RLS
 * scope everything from the verified JWT (Session 3). OWNER-only actions
 * (delete, points-adjust) are enforced by the global RolesGuard.
 */
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(customersQuerySchema)) q: CustomersQuery) {
    return this.customers.list(q);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createCustomerSchema))
    body: ReturnType<typeof createCustomerSchema.parse>,
  ) {
    return this.customers.create(body);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.customers.getById(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema))
    body: ReturnType<typeof updateCustomerSchema.parse>,
  ) {
    return this.customers.update(id, body);
  }

  @Roles("OWNER")
  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: AuthedRequest) {
    return this.customers.softDelete(id, req.user.sub);
  }

  @Get(":id/sales")
  sales(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery,
  ) {
    return this.customers.sales(id, q);
  }

  @Get(":id/messages")
  messages(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery,
  ) {
    return this.customers.messages(id, q);
  }

  @Roles("OWNER")
  @Post(":id/points-adjust")
  pointsAdjust(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(pointsAdjustSchema))
    body: ReturnType<typeof pointsAdjustSchema.parse>,
    @Req() req: AuthedRequest,
  ) {
    return this.customers.pointsAdjust(id, body, req.user.sub);
  }
}
