import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  LOW_STOCK_THRESHOLD,
  type CreateProduct,
  type ProductsQuery,
  type UpdateProductInput,
} from "@pharmacrm/shared";
import { PrismaService } from "../../common/prisma.service";

const CATALOG_SELECT = {
  id: true,
  nameText: true,
  description: true,
  company: true,
  category: true,
  priceEgp: true,
  stock: true,
  aliases: true,
  updatedAt: true,
} satisfies Prisma.ProductRefSelect;

/**
 * Medicine formulary (دليل الأدوية, R9) — the pharmacy's own catalog. Full CRUD
 * here; POST /sales also auto-stubs rows by name. All reads are tenant-scoped
 * by the Prisma extension + RLS, and exclude soft-deleted rows.
 */
@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /products/suggest?q= — autocomplete for the Quick Sale picker. Returns
   * the rich fields (price/company/stock/description) so staff see them inline.
   * Empty q → most recently updated. Prefix matches rank first.
   */
  async suggest(q: string) {
    if (!q) {
      return this.prisma.tenant.productRef.findMany({
        where: { deletedAt: null },
        select: CATALOG_SELECT,
        orderBy: { updatedAt: "desc" },
        take: 10,
      });
    }
    const rows = await this.prisma.tenant.productRef.findMany({
      where: {
        deletedAt: null,
        OR: [{ nameText: { contains: q, mode: "insensitive" } }, { aliases: { has: q } }],
      },
      select: CATALOG_SELECT,
      orderBy: { nameText: "asc" },
      take: 20,
    });
    const needle = q.toLowerCase();
    return rows
      .sort((a, b) => {
        const ap = a.nameText.toLowerCase().startsWith(needle) ? 0 : 1;
        const bp = b.nameText.toLowerCase().startsWith(needle) ? 0 : 1;
        return ap - bp || a.nameText.localeCompare(b.nameText, "ar");
      })
      .slice(0, 10);
  }

  /** GET /products — catalog list with search/category/lowStock + cursor. */
  async list(query: ProductsQuery) {
    const where: Prisma.ProductRefWhereInput = { deletedAt: null };
    if (query.search) {
      where.OR = [
        { nameText: { contains: query.search, mode: "insensitive" } },
        { company: { contains: query.search, mode: "insensitive" } },
        { aliases: { has: query.search } },
      ];
    }
    if (query.category) where.category = query.category;
    if (query.lowStock) where.stock = { lte: LOW_STOCK_THRESHOLD };

    const rows = await this.prisma.tenant.productRef.findMany({
      where,
      select: CATALOG_SELECT,
      orderBy: [{ nameText: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1]!.id : null };
  }

  /** Distinct non-null categories in use (for filter chips). */
  async categories(): Promise<string[]> {
    const rows = await this.prisma.tenant.productRef.findMany({
      where: { deletedAt: null, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    });
    return rows.map((r) => r.category!).filter(Boolean);
  }

  async getById(id: string) {
    const product = await this.prisma.tenant.productRef.findFirst({
      where: { id, deletedAt: null },
      select: CATALOG_SELECT,
    });
    if (!product) {
      throw new NotFoundException({
        error: { code: ERROR_CODES.NOT_FOUND, message: "Medicine not found" },
      });
    }
    return product;
  }

  async create(input: CreateProduct) {
    try {
      return await this.prisma.tenant.productRef.create({
        data: {
          nameText: input.nameText,
          description: input.description,
          company: input.company,
          category: input.category,
          priceEgp: input.priceEgp != null ? new Prisma.Decimal(input.priceEgp) : null,
          stock: input.stock,
          aliases: input.aliases,
        } as Prisma.ProductRefUncheckedCreateInput, // pharmacyId injected by tenant extension
        select: CATALOG_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // an auto-stubbed row with this name may already exist — surface it
        throw new ConflictException({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Medicine name already exists" },
        });
      }
      throw e;
    }
  }

  async update(id: string, input: UpdateProductInput) {
    await this.getById(id); // 404 if missing/deleted (tenant-scoped)
    const data: Prisma.ProductRefUpdateInput = {};
    if (input.nameText !== undefined) data.nameText = input.nameText;
    if (input.description !== undefined) data.description = input.description;
    if (input.company !== undefined) data.company = input.company;
    if (input.category !== undefined) data.category = input.category;
    if (input.stock !== undefined) data.stock = input.stock;
    if (input.aliases !== undefined) data.aliases = input.aliases;
    if (input.priceEgp !== undefined) {
      data.priceEgp = input.priceEgp === null ? null : new Prisma.Decimal(input.priceEgp);
    }
    try {
      return await this.prisma.tenant.productRef.update({
        where: { id },
        data,
        select: CATALOG_SELECT,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException({
          error: { code: ERROR_CODES.VALIDATION_FAILED, message: "Medicine name already exists" },
        });
      }
      throw e;
    }
  }

  /** DELETE /products/:id — soft delete (R5). */
  async remove(id: string) {
    await this.getById(id);
    await this.prisma.tenant.productRef.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deleted: true };
  }
}
