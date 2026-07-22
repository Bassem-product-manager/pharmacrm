/**
 * Session 7 — medicine formulary + stock + dashboard analytics.
 * Requires postgres + redis (docker compose up -d), migrations + RLS applied.
 * Run: npm run test:e2e -w @pharmacrm/api
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";

const OWNER_PHONE = "+201095000001";
const STAFF_PHONE = "+201095000002";
const PASSWORD = "Sup3rSecret!";

describe("Session 7 — formulary + stock + dashboard", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let ownerToken: string;
  let staffToken: string;
  let pharmacyId: string;

  const owner = (m: "get" | "post" | "patch" | "delete", url: string) =>
    request(http)[m](url).set("Authorization", `Bearer ${ownerToken}`);
  const staff = (m: "get" | "post" | "patch" | "delete", url: string) =>
    request(http)[m](url).set("Authorization", `Bearer ${staffToken}`);

  const bypass = <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return fn(tx);
    });

  async function cleanup() {
    await bypass(async (tx) => {
      const ids = `IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`;
      await tx.$executeRawUnsafe(`DELETE FROM "Message" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Reminder" WHERE "refillRuleId" IN (SELECT r.id FROM "RefillRule" r JOIN "Customer" c ON c.id=r."customerId" WHERE c."pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "RefillRule" WHERE "customerId" IN (SELECT id FROM "Customer" WHERE "pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "SaleItem" WHERE "saleId" IN (SELECT id FROM "Sale" WHERE "pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "PointsTransaction" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Sale" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "ProductRef" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Customer" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}'`);
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    await cleanup();

    const signup = await request(http).post("/api/v1/auth/signup").send({
      pharmacyName: "صيدلية المخزون",
      ownerName: "مالك",
      phone: OWNER_PHONE,
      password: PASSWORD,
    });
    expect(signup.status).toBe(201);
    pharmacyId = signup.body.pharmacyId;
    ownerToken = signup.body.accessToken;

    // create a STAFF user directly, then log in
    const bcrypt = await import("bcryptjs");
    await bypass((tx) =>
      tx.user.create({
        data: {
          pharmacyId,
          name: "موظف",
          phone: STAFF_PHONE,
          passwordHash: bcrypt.hashSync(PASSWORD, 10),
          role: "STAFF",
        },
      }),
    );
    const login = await request(http).post("/api/v1/auth/login").send({ phone: STAFF_PHONE, password: PASSWORD });
    staffToken = login.body.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  // ---- 1: catalog CRUD ----
  it("1. create → list → update a medicine with full fields", async () => {
    const create = await owner("post", "/api/v1/products").send({
      nameText: "كونكور 5 مجم",
      company: "ميرك",
      category: "أدوية الضغط",
      priceEgp: 120,
      stock: 30,
      description: "بيسوبرولول",
    });
    expect(create.status).toBe(201);
    expect(create.body.nameText).toBe("كونكور 5 مجم");
    expect(Number(create.body.priceEgp)).toBe(120);
    expect(create.body.stock).toBe(30);
    const id = create.body.id;

    const list = await owner("get", "/api/v1/products?search=كونكور");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].company).toBe("ميرك");

    const cats = await owner("get", "/api/v1/products/categories");
    expect(cats.body).toContain("أدوية الضغط");

    const patch = await owner("patch", `/api/v1/products/${id}`).send({ priceEgp: 135, stock: 50 });
    expect(patch.status).toBe(200);
    expect(Number(patch.body.priceEgp)).toBe(135);
    expect(patch.body.stock).toBe(50);
  });

  // ---- 2: suggest returns rich fields; soft-delete hides it ----
  it("2. suggest returns price/stock; STAFF cannot delete; OWNER soft-deletes", async () => {
    const create = await owner("post", "/api/v1/products").send({ nameText: "بنادول اكسترا", priceEgp: 30, stock: 100 });
    const id = create.body.id;

    const suggest = await owner("get", "/api/v1/products/suggest?q=بنادول");
    const hit = suggest.body.find((s: any) => s.id === id);
    expect(hit).toBeTruthy();
    expect(Number(hit.priceEgp)).toBe(30);
    expect(hit.stock).toBe(100);

    // STAFF forbidden from delete
    const staffDel = await staff("delete", `/api/v1/products/${id}`);
    expect(staffDel.status).toBe(403);

    // OWNER soft-deletes → gone from list + suggest
    const del = await owner("delete", `/api/v1/products/${id}`);
    expect(del.status).toBe(200);
    const list = await owner("get", "/api/v1/products?search=بنادول");
    expect(list.body.data.find((p: any) => p.id === id)).toBeUndefined();
    const suggest2 = await owner("get", "/api/v1/products/suggest?q=بنادول");
    expect(suggest2.body.find((s: any) => s.id === id)).toBeUndefined();
  });

  // ---- 3: sale auto-sums total from item prices, decrements stock, warns ----
  it("3. sale auto-sums total + decrements stock + low-stock warning", async () => {
    const prod = await owner("post", "/api/v1/products").send({ nameText: "أموريل 2 مجم", priceEgp: 55, stock: 6 });
    const productRefId = prod.body.id;

    const cust = await owner("post", "/api/v1/customers").send({ name: "عميل", phone: "+201097000010" });
    const customerId = cust.body.id;

    // no totalEgp → server sums 55*2 = 110; stock 6 → 4 (low, <=5) → warning
    const sale = await owner("post", "/api/v1/sales").send({
      clientRef: randomUUID(),
      customerId,
      items: [{ nameText: "أموريل 2 مجم", productRefId, qty: 2, unitPriceEgp: 55, notes: "مرتين يوميًا" }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.totalEgp).toBe(110);
    expect(sale.body.earnedPoints).toBe(11); // floor(110 * 0.1)
    expect(sale.body.items[0].unitPriceEgp).toBe(55);
    expect(sale.body.items[0].notes).toBe("مرتين يوميًا");
    expect(sale.body.stockWarnings).toHaveLength(1);
    expect(sale.body.stockWarnings[0].stock).toBe(4);

    const after = await owner("get", `/api/v1/products/${productRefId}`);
    expect(after.body.stock).toBe(4);
  });

  // ---- 4: explicit totalEgp overrides the auto-sum ----
  it("4. explicit totalEgp overrides the line-sum", async () => {
    const cust = await owner("post", "/api/v1/customers").send({ name: "عميل٢", phone: "+201097000011" });
    const sale = await owner("post", "/api/v1/sales").send({
      clientRef: randomUUID(),
      customerId: cust.body.id,
      items: [{ nameText: "صنف يدوي", qty: 1, unitPriceEgp: 100 }],
      totalEgp: 90, // override (e.g. rounding/discount)
    });
    expect(sale.status).toBe(201);
    expect(sale.body.totalEgp).toBe(90);
    expect(sale.body.earnedPoints).toBe(9);
  });

  // ---- 5: dashboard summary reflects reality ----
  it("5. dashboard summary returns trend + low stock + today's sales", async () => {
    const res = await owner("get", "/api/v1/dashboard/summary?days=14");
    expect(res.status).toBe(200);
    expect(res.body.trend).toHaveLength(14);
    // both sales above happened "today" (Cairo) → count >= 2, egp >= 200
    expect(res.body.todaySalesCount).toBeGreaterThanOrEqual(2);
    expect(res.body.todaySalesEgp).toBeGreaterThanOrEqual(200);
    // أموريل dropped to stock 4 → counted as low
    expect(res.body.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(res.body.lowStockItems.some((i: any) => i.nameText === "أموريل 2 مجم")).toBe(true);
    // last trend point is today and non-zero
    const last = res.body.trend[res.body.trend.length - 1];
    expect(last.salesCount).toBeGreaterThanOrEqual(2);
  });
});
