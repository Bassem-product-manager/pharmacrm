/**
 * Session 5 — Quick Sale (docs/04 Flow 1 + docs/05 §3 contract).
 * Requires postgres + redis (docker compose up -d), migrations + RLS applied.
 * Run: npm run test:e2e -w @pharmacrm/api
 *
 * Defaults from schema.prisma: loyaltyRatio 0.1 (earn = floor(net*0.1)),
 * redeemRate 0.25 (1 point = 0.25 EGP).
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

const OWNER_PHONE = "+201094000001";
const PASSWORD = "Sup3rSecret!";

describe("Session 5 — quick sale", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let token: string;
  let pharmacyId: string;

  const post = (url: string) => request(http).post(url).set("Authorization", `Bearer ${token}`);
  const get = (url: string) => request(http).get(url).set("Authorization", `Bearer ${token}`);

  const bypass = <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return fn(tx);
    });

  const newCustomer = async (name: string, phone: string): Promise<string> => {
    const res = await post("/api/v1/customers").send({ name, phone });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const sale = (over: Record<string, unknown>) => ({
    clientRef: randomUUID(),
    items: [{ nameText: "بنادول", qty: 1 }],
    totalEgp: 100,
    ...over,
  });

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
      pharmacyName: "صيدلية اختبار المبيعات",
      ownerName: "مالك المبيعات",
      phone: OWNER_PHONE,
      password: PASSWORD,
    });
    expect(signup.status).toBe(201);
    pharmacyId = signup.body.pharmacyId;
    token = signup.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function cleanup() {
    await bypass(async (tx) => {
      const ids = `IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`;
      await tx.$executeRawUnsafe(`DELETE FROM "Message" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Reminder" WHERE "refillRuleId" IN (SELECT r.id FROM "RefillRule" r JOIN "Customer" c ON c.id=r."customerId" WHERE c."pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "RefillRule" WHERE "customerId" IN (SELECT id FROM "Customer" WHERE "pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "PointsTransaction" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "SaleItem" WHERE "saleId" IN (SELECT id FROM "Sale" WHERE "pharmacyId" ${ids})`);
      await tx.$executeRawUnsafe(`DELETE FROM "Sale" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "ProductRef" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Customer" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE "pharmacyId" ${ids}`);
      await tx.$executeRawUnsafe(`DELETE FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}'`);
    });
  }

  // ---- Mandated test 1: existing customer + existing product → points + conversion ----
  it("1. existing customer + existing product: correct points and refill conversion", async () => {
    const customerId = await newCustomer("عميل تحويل", "01094110001");
    const { productId, reminderId, ruleId, dueAt } = await bypass(async (tx) => {
      const product = await tx.productRef.create({
        data: { pharmacyId, nameText: "جلوكوفاج 850", aliases: [] },
      });
      const rule = await tx.refillRule.create({
        data: {
          customerId,
          productRefId: product.id,
          cycleDays: 30,
          nextDueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        },
      });
      const reminder = await tx.reminder.create({
        data: { refillRuleId: rule.id, dueAt: rule.nextDueAt, status: "PENDING" },
      });
      return { productId: product.id, reminderId: reminder.id, ruleId: rule.id, dueAt: rule.nextDueAt };
    });

    const res = await post("/api/v1/sales").send(
      sale({
        customerId,
        items: [{ nameText: "جلوكوفاج 850", qty: 1, productRefId: productId }],
        totalEgp: 200,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.totalEgp).toBe(200);
    expect(res.body.discountEgp).toBe(0);
    expect(res.body.earnedPoints).toBe(20); // floor(200 * 0.1)
    expect(res.body.pointsBalance).toBe(20);
    expect(res.body.convertedReminderIds).toContain(reminderId);

    const profile = await get(`/api/v1/customers/${customerId}`);
    expect(profile.body.pointsBalance).toBe(20);
    expect(profile.body.lastVisitAt).toBeTruthy();

    const { reminder, rule, earnCount } = await bypass(async (tx) => ({
      reminder: await tx.reminder.findUnique({ where: { id: reminderId } }),
      rule: await tx.refillRule.findUnique({ where: { id: ruleId } }),
      earnCount: await tx.pointsTransaction.count({ where: { saleId: res.body.id, type: "EARN" } }),
    }));
    expect(reminder.status).toBe("CONVERTED");
    expect(reminder.convertedSaleId).toBe(res.body.id);
    // rule advanced one cycle beyond the original due date
    expect(new Date(rule.nextDueAt).getTime()).toBeGreaterThan(new Date(dueAt).getTime());
    expect(earnCount).toBe(1);
  });

  // ---- Mandated test 2: newCustomer inline create ----
  it("2. newCustomer inline create: Customer row with consentAt + normalized phone; ProductRef upserted", async () => {
    const res = await post("/api/v1/sales").send(
      sale({
        newCustomer: { name: "عميل جديد", phone: "0109 411 0002" },
        items: [{ nameText: "  فيتامين   سي " }],
        totalEgp: 150,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.earnedPoints).toBe(15);

    const customer = await bypass((tx) =>
      tx.customer.findFirst({ where: { pharmacyId, phone: "+201094110002" } }),
    );
    expect(customer).toBeTruthy();
    expect(customer.consentAt).toBeTruthy();
    expect(customer.pointsBalance).toBe(15);

    // item without productRefId → ProductRef upserted by normalized nameText and linked
    expect(res.body.items[0].productRefId).toBeTruthy();
    const ref = await bypass((tx) =>
      tx.productRef.findUnique({
        where: { pharmacyId_nameText: { pharmacyId, nameText: "فيتامين سي" } },
      }),
    );
    expect(ref).toBeTruthy();
    expect(res.body.items[0].productRefId).toBe(ref.id);

    // same normalized name again → reused, not duplicated
    const res2 = await post("/api/v1/sales").send(
      sale({ customerId: customer.id, items: [{ nameText: "فيتامين سي" }], totalEgp: 50 }),
    );
    expect(res2.body.items[0].productRefId).toBe(ref.id);

    // newCustomer with an already-registered phone → reuses the SAME customer
    // (offline-queued sales always arrive as newCustomer; a 409 would lose them)
    const dup = await post("/api/v1/sales").send(
      sale({ newCustomer: { name: "مكرر", phone: "01094110002" } }),
    );
    expect(dup.status).toBe(201);
    expect(dup.body.customerId).toBe(customer.id);
    const custCount = await bypass((tx) =>
      tx.customer.count({ where: { pharmacyId, phone: "+201094110002" } }),
    );
    expect(custCount).toBe(1);
  });

  // ---- Mandated test 3: clientRef idempotency → 200 with the SAME sale ----
  it("3. duplicate clientRef → 200 with the original sale, never double-charges", async () => {
    const customerId = await newCustomer("عميل تكرار", "01094110003");
    const clientRef = randomUUID();
    const body = sale({ customerId, items: [{ nameText: "كونكور" }], totalEgp: 300, clientRef });

    const first = await post("/api/v1/sales").send(body);
    expect(first.status).toBe(201);
    expect(first.body.earnedPoints).toBe(30);

    const retry = await post("/api/v1/sales").send(body);
    expect(retry.status).toBe(200); // docs/05: replay → 200 existing
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.idempotentReplay).toBe(true);

    const profile = await get(`/api/v1/customers/${customerId}`);
    expect(profile.body.pointsBalance).toBe(30); // ONE sale, not two
    const saleCount = await bypass((tx) => tx.sale.count({ where: { clientRef } }));
    expect(saleCount).toBe(1);
  });

  // ---- Mandated test 4: concurrent redeem never goes negative ----
  it("4. two concurrent redeems of 80 from a 100-point balance → one succeeds, one 409, balance ≥ 0", async () => {
    const customerId = await newCustomer("عميل سباق", "01094110004");
    // earn 100 points (1000 * 0.1)
    const earn = await post("/api/v1/sales").send(sale({ customerId, totalEgp: 1000 }));
    expect(earn.body.pointsBalance).toBe(100);

    const redeemBody = () =>
      sale({ customerId, totalEgp: 100, redeemPoints: 80 }); // fresh clientRef each call
    const [a, b] = await Promise.all([
      post("/api/v1/sales").send(redeemBody()),
      post("/api/v1/sales").send(redeemBody()),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); // FOR UPDATE serializes; second sees 20 < 80

    const winner = a.status === 201 ? a : b;
    // redeem 80 → 20 EGP off (0.25/pt); earn floor(80 * 0.1) = 8 → 100 − 80 + 8 = 28
    expect(winner.body.discountEgp).toBe(20);
    expect(winner.body.earnedPoints).toBe(8);
    expect(winner.body.pointsBalance).toBe(28);

    const { customer, redeemRows } = await bypass(async (tx) => ({
      customer: await tx.customer.findUnique({ where: { id: customerId } }),
      redeemRows: await tx.pointsTransaction.count({ where: { customerId, type: "REDEEM" } }),
    }));
    expect(customer.pointsBalance).toBe(28);
    expect(customer.pointsBalance).toBeGreaterThanOrEqual(0);
    expect(redeemRows).toBe(1); // loser wrote nothing
  });

  // ---- redeem math + guards ----
  it("5. redeem discounts the sale and earns on net; over-redeem 409; discount > total 400", async () => {
    const customerId = await newCustomer("عميل نقاط", "01094110005");
    await post("/api/v1/sales").send(sale({ customerId, totalEgp: 1000 })); // +100 pts

    const redeem = await post("/api/v1/sales").send(
      sale({ customerId, totalEgp: 100, redeemPoints: 10 }),
    );
    expect(redeem.status).toBe(201);
    expect(redeem.body.discountEgp).toBe(2.5); // 10 × 0.25
    expect(redeem.body.totalEgp).toBe(100); // gross stored as entered
    expect(redeem.body.earnedPoints).toBe(9); // floor((100 − 2.5) × 0.1)
    expect(redeem.body.pointsBalance).toBe(99); // 100 − 10 + 9

    const over = await post("/api/v1/sales").send(
      sale({ customerId, totalEgp: 500, redeemPoints: 100000 }),
    );
    expect(over.status).toBe(409);

    // 99 points ≈ 24.75 EGP > 20 EGP sale → 400, not a negative total
    const tooBig = await post("/api/v1/sales").send(
      sale({ customerId, totalEgp: 20, redeemPoints: 99 }),
    );
    expect(tooBig.status).toBe(400);
  });

  // ---- input guards ----
  it("6. unknown customer → 404; missing clientRef or both/neither customer fields → 400", async () => {
    const missing = await post("/api/v1/sales").send(
      sale({ customerId: "clnonexistentcustid0000000" }),
    );
    expect(missing.status).toBe(404);

    const noRef = await post("/api/v1/sales").send({
      customerId: "clnonexistentcustid0000000",
      items: [{ nameText: "x" }],
      totalEgp: 50,
    });
    expect(noRef.status).toBe(400); // clientRef required (docs/05 §1)

    const neither = await post("/api/v1/sales").send(sale({}));
    expect(neither.status).toBe(400);
  });

  // ---- GET /sales?date= + GET /products/suggest ----
  it("7. daily log filters by Cairo date; product suggest returns this pharmacy's products", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
    const list = await get(`/api/v1/sales?date=${today}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data[0].customer.name).toBeTruthy();

    const empty = await get(`/api/v1/sales?date=2000-01-01`);
    expect(empty.body.data).toHaveLength(0);

    const suggest = await get(`/api/v1/products/suggest?q=جلوكو`);
    expect(suggest.status).toBe(200);
    expect(suggest.body.some((p: { nameText: string }) => p.nameText === "جلوكوفاج 850")).toBe(true);

    const recent = await get(`/api/v1/products/suggest`);
    expect(recent.status).toBe(200);
    expect(recent.body.length).toBeGreaterThan(0);
  });
});
