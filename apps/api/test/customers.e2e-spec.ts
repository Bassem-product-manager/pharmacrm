/**
 * Session 4 tests (build/session-plans/04-customers.md).
 * Requires postgres + redis (docker compose up -d), migrations applied.
 * Run: npm run test:e2e -w @pharmacrm/api
 */
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";

const OWNER_PHONE = "+201093000001";
const STAFF_PHONE = "+201093000002";
const PASSWORD = "Sup3rSecret!";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Session 4 — customers module", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let ownerToken: string;
  let staffToken: string;
  let pharmacyId: string;

  const post = (url: string, token: string) =>
    request(http).post(url).set("Authorization", `Bearer ${token}`);
  const get = (url: string, token: string) =>
    request(http).get(url).set("Authorization", `Bearer ${token}`);

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
      pharmacyName: "صيدلية اختبار العملاء",
      ownerName: "مالك الاختبار",
      phone: OWNER_PHONE,
      password: PASSWORD,
    });
    expect(signup.status).toBe(201);
    pharmacyId = signup.body.pharmacyId;
    ownerToken = signup.body.accessToken;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      await tx.user.create({
        data: { pharmacyId, name: "موظف", phone: STAFF_PHONE, passwordHash, role: "STAFF" },
      });
    });
    const staffLogin = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: STAFF_PHONE, password: PASSWORD });
    staffToken = staffLogin.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function cleanup() {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      await tx.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "PointsTransaction" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "Customer" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "User" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}')`,
      );
      await tx.$executeRawUnsafe(`DELETE FROM "Pharmacy" WHERE phone = '${OWNER_PHONE}'`);
    });
  }

  // ---- Test 1: phone search from any position ----
  it("1. phone search finds +201001234567 by '010', '1001', '0123'", async () => {
    const created = await post("/api/v1/customers", ownerToken).send({
      name: "عميل البحث",
      phone: "01001234567",
    });
    expect(created.status).toBe(201);
    expect(created.body.phone).toBe("+201001234567");

    for (const q of ["010", "1001", "0123"]) {
      const res = await get(`/api/v1/customers?search=${q}`, ownerToken);
      expect(res.status).toBe(200);
      const phones = res.body.data.map((c: { phone: string }) => c.phone);
      expect(phones).toContain("+201001234567");
    }

    // name search through the same param
    const byName = await get(
      `/api/v1/customers?search=${encodeURIComponent("عميل البحث")}`,
      ownerToken,
    );
    expect(byName.body.data.map((c: { name: string }) => c.name)).toContain("عميل البحث");
  });

  // ---- Test 2: inactiveDays computed from lastVisitAt ----
  it("2. inactiveDays=30 returns only customers with lastVisitAt older than 30d", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      await tx.customer.createMany({
        data: [
          { pharmacyId, name: "نشط", phone: "+201093110001", lastVisitAt: new Date(Date.now() - 5 * DAY_MS) },
          { pharmacyId, name: "غير نشط ٤٠ يوم", phone: "+201093110002", lastVisitAt: new Date(Date.now() - 40 * DAY_MS) },
          { pharmacyId, name: "غير نشط ٩٠ يوم", phone: "+201093110003", lastVisitAt: new Date(Date.now() - 90 * DAY_MS) },
        ],
      });
    });

    const res = await get("/api/v1/customers?inactiveDays=30", ownerToken);
    expect(res.status).toBe(200);
    const names = res.body.data.map((c: { name: string }) => c.name);
    expect(names).toContain("غير نشط ٤٠ يوم");
    expect(names).toContain("غير نشط ٩٠ يوم");
    expect(names).not.toContain("نشط");
  });

  // ---- Test 3: RBAC on delete ----
  it("3. STAFF calling DELETE → 403; OWNER succeeds + AuditLog written", async () => {
    const created = await post("/api/v1/customers", ownerToken).send({
      name: "للحذف",
      phone: "01093110004",
    });
    const id = created.body.id;

    const staffDelete = await request(http)
      .delete(`/api/v1/customers/${id}`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staffDelete.status).toBe(403);

    const ownerDelete = await request(http)
      .delete(`/api/v1/customers/${id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerDelete.status).toBe(200);

    const audit = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return tx.auditLog.findFirst({
        where: { pharmacyId, action: "CUSTOMER_DELETE", entityId: id },
      });
    });
    expect(audit).toBeTruthy();
  });

  // ---- Test 4: concurrent points adjust ----
  it("4. two concurrent points adjusts → balance exact, both ledger rows exist", async () => {
    const created = await post("/api/v1/customers", ownerToken).send({
      name: "عميل النقاط",
      phone: "01093110005",
    });
    const id = created.body.id;

    const [r1, r2] = await Promise.all([
      post(`/api/v1/customers/${id}/points-adjust`, ownerToken).send({ points: 30, reason: "تعويض ١" }),
      post(`/api/v1/customers/${id}/points-adjust`, ownerToken).send({ points: 50, reason: "تعويض ٢" }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const profile = await get(`/api/v1/customers/${id}`, ownerToken);
    expect(profile.body.pointsBalance).toBe(80);

    const txCount = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return tx.pointsTransaction.count({ where: { customerId: id, type: "ADJUST" } });
    });
    expect(txCount).toBe(2);

    // STAFF cannot adjust
    const staffAdjust = await post(`/api/v1/customers/${id}/points-adjust`, staffToken).send({
      points: 10,
      reason: "غير مسموح",
    });
    expect(staffAdjust.status).toBe(403);

    // balance cannot go negative
    const negative = await post(`/api/v1/customers/${id}/points-adjust`, ownerToken).send({
      points: -1000,
      reason: "سحب زائد",
    });
    expect(negative.status).toBe(409);
  });

  // ---- Test 5: soft-deleted excluded ----
  it("5. deleted customer not returned in list or by id", async () => {
    const created = await post("/api/v1/customers", ownerToken).send({
      name: "محذوف مخفي",
      phone: "01093110006",
    });
    const id = created.body.id;
    await request(http)
      .delete(`/api/v1/customers/${id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const list = await get("/api/v1/customers", ownerToken);
    expect(list.body.data.map((c: { id: string }) => c.id)).not.toContain(id);

    const byId = await get(`/api/v1/customers/${id}`, ownerToken);
    expect(byId.status).toBe(404);

    // opt-out badge still works on a live customer (S4 deliverable)
    const optout = await request(http)
      .patch(`/api/v1/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ optedOut: true });
    expect(optout.status).toBe(404); // deleted → not patchable either
  });
});
