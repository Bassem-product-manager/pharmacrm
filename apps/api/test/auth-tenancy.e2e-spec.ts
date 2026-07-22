/**
 * Session 3 hard gate — the 5 mandated tests (build/session-plans/03-auth-tenancy.md).
 * Requires: postgres + redis running (docker compose up -d), migrations applied.
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

const PHONE_A_OWNER = "+201090000001";
const PHONE_A_STAFF = "+201090000002";
const PHONE_B_OWNER = "+201090000003";
const PASSWORD = "Sup3rSecret!";
const ADMIN_EMAIL = "e2e-admin@pharmacrm.test";

const refreshCookie = (res: request.Response): string => {
  const cookies = res.get("Set-Cookie") ?? [];
  const c = cookies.find((x: string) => x.startsWith("refresh_token="));
  if (!c) throw new Error("no refresh cookie set");
  return c.split(";")[0];
};

describe("Session 3 — auth + tenancy (CRITICAL)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let pharmacyAId: string;
  let ownerAToken: string;
  let staffAToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    // ---- cleanup from previous runs (base client — RLS note: run before RLS
    // or via psql; in dev DB the test user is owner and RLS is forced, so we
    // delete via raw SQL inside a SET LOCAL transaction per pharmacy) ----
    await cleanup();

    // Pharmacy A via signup (also validates signup TX)
    const signupA = await request(http).post("/api/v1/auth/signup").send({
      pharmacyName: "صيدلية أ",
      ownerName: "مالك أ",
      phone: PHONE_A_OWNER,
      password: PASSWORD,
    });
    expect(signupA.status).toBe(201);
    pharmacyAId = signupA.body.pharmacyId;
    ownerAToken = signupA.body.accessToken;

    // Pharmacy B via signup
    const signupB = await request(http).post("/api/v1/auth/signup").send({
      pharmacyName: "صيدلية ب",
      ownerName: "مالك ب",
      phone: PHONE_B_OWNER,
      password: PASSWORD,
    });
    expect(signupB.status).toBe(201);
    const pharmacyBId = signupB.body.pharmacyId as string;

    // STAFF for A + customers for A and B + admin user (raw, tenant-set TXs)
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    await withTenant(pharmacyAId, async (tx) => {
      await tx.user.create({
        data: {
          pharmacyId: pharmacyAId,
          name: "موظف أ",
          phone: PHONE_A_STAFF,
          passwordHash,
          role: "STAFF",
        },
      });
      await tx.customer.create({
        data: { pharmacyId: pharmacyAId, name: "عميل أ ١", phone: "+201091110001", consentAt: new Date() },
      });
      await tx.customer.create({
        data: { pharmacyId: pharmacyAId, name: "عميل أ ٢", phone: "+201091110002", consentAt: new Date() },
      });
    });
    await withTenant(pharmacyBId, async (tx) => {
      await tx.customer.create({
        data: { pharmacyId: pharmacyBId, name: "عميل ب ١", phone: "+201092220001", consentAt: new Date() },
      });
    });
    await prisma.adminUser.upsert({
      where: { email: ADMIN_EMAIL },
      update: { passwordHash },
      create: { email: ADMIN_EMAIL, passwordHash },
    });

    const staffLogin = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: PHONE_A_STAFF, password: PASSWORD });
    expect(staffLogin.status).toBe(200);
    staffAToken = staffLogin.body.accessToken;

    const adminLogin = await request(http)
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function withTenant(pharmacyId: string, fn: (tx: any) => Promise<void>) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.pharmacy_id = '${pharmacyId}'`);
      await fn(tx);
    });
  }

  async function cleanup() {
    // remove leftovers from previous runs — service bypass TX (RLS is forced)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      await tx.$executeRawUnsafe(
        `DELETE FROM "Customer" WHERE "pharmacyId" IN
           (SELECT id FROM "Pharmacy" WHERE phone IN ('${PHONE_A_OWNER}', '${PHONE_B_OWNER}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "User" WHERE "pharmacyId" IN
           (SELECT id FROM "Pharmacy" WHERE phone IN ('${PHONE_A_OWNER}', '${PHONE_B_OWNER}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM "Pharmacy" WHERE phone IN ('${PHONE_A_OWNER}', '${PHONE_B_OWNER}')`,
      );
    });
  }

  // ---- Test 1: refresh rotation + reuse detection ----
  it("1. login returns tokens; refresh rotates; reuse of old refresh → 401 + family revoked", async () => {
    const login = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: PHONE_A_OWNER, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeDefined();
    const refresh1 = refreshCookie(login);

    // rotate
    const r1 = await request(http).post("/api/v1/auth/refresh").set("Cookie", refresh1);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeDefined();
    const refresh2 = refreshCookie(r1);
    expect(refresh2).not.toEqual(refresh1);

    // reuse of OLD token → 401 (reuse detected) + family revoked
    const reuse = await request(http).post("/api/v1/auth/refresh").set("Cookie", refresh1);
    expect(reuse.status).toBe(401);

    // even the NEW (otherwise valid) token is now dead — family revoked
    const afterRevoke = await request(http).post("/api/v1/auth/refresh").set("Cookie", refresh2);
    expect(afterRevoke.status).toBe(401);
  });

  // ---- Test 2: cross-tenant isolation ----
  it("2. pharmacy A token sees ONLY A's customers", async () => {
    const res = await request(http)
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    const names: string[] = res.body.data.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["عميل أ ١", "عميل أ ٢"]));
    expect(names).not.toContain("عميل ب ١");
    for (const c of res.body.data) expect(c.pharmacyId).toBe(pharmacyAId);
  });

  // ---- Test 3: RBAC ----
  it("3. STAFF token → POST /campaigns → 403", async () => {
    const res = await request(http)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "x" });
    expect(res.status).toBe(403);

    // sanity: OWNER clears the RolesGuard (the real controller then validates
    // the body → 400 here, or applies the FREE-plan gate → 403 PLAN_UPGRADE
    // with a valid body; both prove OWNER is NOT blocked for its ROLE). Full
    // campaign behaviour lives in campaigns-invoice-admin.e2e-spec.ts.
    const ownerRes = await request(http)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "x" });
    expect(ownerRes.status).toBe(400); // validation failure, not a 403 role block
    expect(ownerRes.body.error?.code).not.toBe("AUTH_FORBIDDEN_ROLE");
  });

  // ---- Test 4: admin token rejected on tenant endpoints ----
  it("4. admin token → GET /customers → 401 (wrong audience)", async () => {
    const res = await request(http)
      .get("/api/v1/customers")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
  });

  // ---- Test 5: tenant token rejected on admin endpoints ----
  it("5. tenant token → GET /admin/metrics/overview → 401", async () => {
    const res = await request(http)
      .get("/api/v1/admin/metrics/overview")
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(401);

    // sanity: admin token works
    const adminRes = await request(http)
      .get("/api/v1/admin/metrics/overview")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(200);
  });
});
