import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createProductSchema,
  productsQuerySchema,
  productSuggestQuerySchema,
  updateProductSchema,
  type CreateProduct,
  type ProductsQuery,
  type ProductSuggestQuery,
  type UpdateProductInput,
} from "@pharmacrm/shared";
import { Roles } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { ProductsService } from "./products.service";

/**
 * Medicine formulary (دليل الأدوية). Both OWNER and STAFF manage the catalog;
 * only OWNER may delete (soft), mirroring the customers module. pharmacyId is
 * never in the path — tenancy comes from the JWT.
 */
@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Autocomplete for the Quick Sale picker (rich fields). */
  @Get("suggest")
  suggest(@Query(new ZodValidationPipe(productSuggestQuerySchema)) q: ProductSuggestQuery) {
    return this.products.suggest(q.q);
  }

  @Get("categories")
  categories() {
    return this.products.categories();
  }

  @Get()
  list(@Query(new ZodValidationPipe(productsQuerySchema)) q: ProductsQuery) {
    return this.products.list(q);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.products.getById(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createProductSchema)) body: CreateProduct) {
    return this.products.create(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.products.update(id, body);
  }

  @Roles("OWNER")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.products.remove(id);
  }
}
