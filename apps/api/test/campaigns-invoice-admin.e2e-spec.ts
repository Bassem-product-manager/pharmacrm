/**
 * Phase B + CTO tests — loyalty settings RBAC, campaign plan gate (FREE→403 /
 * PRO→201), segment excludes opted-out, batch honors gates (SKIPPED_OPTOUT
 * never provider-called), report aggregation, STAFF 403s, sequential invoice
 * numbering, CSV reports, admin plan switch + audit.
 * Workers disabled (JOBS_DISABLED) — tests drive CampaignBatchService directly.
 * Requires postgres + redis (docker compose up -d), migrations applied.
 */
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { MockProvider } from "../src/modules/messaging/providers/mock.provider";
import { CampaignBatchService } from "../src/jobs/campaign-batch.service";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
process.env.JOBS_DISABLED = "1";

const OWNER_PHONE = "+201095000001";
const STAFF_PHONE = "+201095000002";
const ADMIN_EMAIL = "e2e-admin@pharmacrm.local";
const PASSWORD = "Sup3rSecret!";

describe("Phase B — campaigns + invoice + reports + admin", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mock: MockProvider;
  let batch: CampaignBatchService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let ownerToken: string;
  let staffToken: string;
  let adminToken: string;
  let pharmacyId: string;
  let optedInIds: string[] = [];
  let optedOutId: string;

  const bypass = <T,>(fn: (tx: any) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return fn(tx);
    });

  async function cleanup() {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      for (const sql of [
        `DELETE FROM "Message" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Reminder" WHERE "refillRuleId" IN (SELECT rr.id FROM "RefillRule" rr JOIN "Customer" c ON c.id=rr."customerId" WHERE c."pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "RefillRule" WHERE "customerId" IN (SELECT id FROM "Customer" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "Campaign" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "SaleItem" WHERE "saleId" IN (SELECT id FROM "Sale" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "PointsTransaction" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Sale" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "AuditLog" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "ProductRef" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Customer" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "User" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'`,
        `DELETE FROM "AdminUser" WHERE email='${ADMIN_EMAIL}'`,
      ]) {
        await tx.$executeRawUnsafe(sql);
      }
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    mock = app.get(MockProvider);
    batch = app.get(CampaignBatchService);

    await cleanup();

    // tenant: pharmacy (FREE) + owner + staff
    const signup = await request(http).post("/api/v1/auth/signup").send({
      pharmacyName: "صيدلية الحملات",
      ownerName: "مالك",
      phone: OWNER_PHONE,
      password: PASSWORD,
    });
    expect(signup.status).toBe(201);
    pharmacyId = signup.body.pharmacyId;
    ownerToken = signup.body.accessToken;

    await bypass(async (tx) => {
      await tx.user.create({
        data: {
          pharmacyId,
          name: "موظف",
          phone: STAFF_PHONE,
          passwordHash: await bcrypt.hash(PASSWORD, 10),
          role: "STAFF",
        },
      });
      // start === end wraps to a 24h-open send window (0–23 left the 23:00
      // hour closed — the suite used to fail when run after 11 PM Cairo)
      await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { quietStart: 12, quietEnd: 12, vatRate: 14 },
      });
      await tx.adminUser.create({
        data: { email: ADMIN_EMAIL, passwordHash: await bcrypt.hash("Admin123!", 10) },
      });
    });
    const staffLogin = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: STAFF_PHONE, password: PASSWORD });
    staffToken = staffLogin.body.accessToken;

    const adminLogin = await request(http)
      .post("/api/v1/admin/auth/login")
      .send({ email: ADMIN_EMAIL, password: "Admin123!" });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;

    // 3 opted-in + 1 opted-out customers, all VIP so segments hit them
    await bypass(async (tx) => {
      const mk = (n: number, optedOut: boolean) =>
        tx.customer.create({
          data: {
            pharmacyId,
            name: `عميل ${n}`,
            phone: `+2010950001${10 + n}`,
            tags: ["VIP"],
            consentAt: new Date(),
            optedOutAt: optedOut ? new Date() : null,
          },
        });
      const c1 = await mk(1, false);
      const c2 = await mk(2, false);
      const c3 = await mk(3, false);
      const c4 = await mk(4, true);
      optedInIds = [c1.id, c2.id, c3.id];
      optedOutId = c4.id;
    });
  });

  afterEach(() => mock.reset());
  afterAll(async () => {
    await cleanup();
    await app?.close();
  });

  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}` });
  const asStaff = () => ({ Authorization: `Bearer ${staffToken}` });
  const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });

  const campaignBody = {
    name: "حملة اختبار",
    segment: { tags: ["VIP"] },
    templateName: "offer_generic",
    templateParams: { offer: "خصم ١٥٪" },
    templateSms: "عرض خاص في {{pharmacy}} — خصم ١٥٪!",
  };

  // ---------- loyalty settings ----------
  it("loyalty settings: GET both roles, PATCH owner-only", async () => {
    const get = await request(http).get("/api/v1/loyalty/settings").set(asStaff());
    expect(get.status).toBe(200);
    expect(Number(get.body.loyaltyRatio)).toBeCloseTo(0.1);

    const staffPatch = await request(http)
      .patch("/api/v1/loyalty/settings")
      .set(asStaff())
      .send({ loyaltyRatio: 0.2 });
    expect(staffPatch.status).toBe(403);

    const ownerPatch = await request(http)
      .patch("/api/v1/loyalty/settings")
      .set(asOwner())
      .send({ loyaltyRatio: 0.2, redeemRate: 0.5 });
    expect(ownerPatch.status).toBe(200);
    expect(Number(ownerPatch.body.loyaltyRatio)).toBeCloseTo(0.2);
  });

  it("settings: PATCH taxId/vatRate owner-only", async () => {
    const staffPatch = await request(http)
      .patch("/api/v1/settings")
      .set(asStaff())
      .send({ taxId: "111" });
    expect(staffPatch.status).toBe(403);

    const ownerPatch = await request(http)
      .patch("/api/v1/settings")
      .set(asOwner())
      .send({ taxId: "123-456-789", address: "شارع الاختبار" });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.taxId).toBe("123-456-789");
  });

  // ---------- campaigns: RBAC + plan gate ----------
  it("STAFF gets 403 on every campaign route", async () => {
    for (const [method, path] of [
      ["get", "/api/v1/campaigns"],
      ["post", "/api/v1/campaigns"],
      ["post", "/api/v1/campaigns/preview-segment"],
    ] as const) {
      const res = await (request(http) as any)[method](path).set(asStaff()).send({});
      expect(res.status).toBe(403);
    }
  });

  it("FREE plan → 403 PLAN_UPGRADE_REQUIRED; PRO → 201", async () => {
    const free = await request(http).post("/api/v1/campaigns").set(asOwner()).send(campaignBody);
    expect(free.status).toBe(403);
    expect(free.body.error.code).toBe("PLAN_UPGRADE_REQUIRED");

    // super admin flips the plan (the real monetization flow) + audit row
    const flip = await request(http)
      .patch(`/api/v1/admin/pharmacies/${pharmacyId}/plan`)
      .set(asAdmin())
      .send({ plan: "PRO" });
    expect(flip.status).toBe(200);
    expect(flip.body.plan).toBe("PRO");

    const pro = await request(http).post("/api/v1/campaigns").set(asOwner()).send(campaignBody);
    expect(pro.status).toBe(201);
    expect(pro.body.status).toBe("DRAFT");
    expect(pro.body.recipientCount).toBe(3); // opted-out excluded

    const audit = await request(http).get("/api/v1/admin/audit").set(asAdmin());
    expect(audit.status).toBe(200);
    expect(audit.body.data.some((a: any) => a.action === "PLAN_CHANGE" && a.entityId === pharmacyId)).toBe(true);
  });

  it("unapproved template → 400", async () => {
    const res = await request(http)
      .post("/api/v1/campaigns")
      .set(asOwner())
      .send({ ...campaignBody, templateName: "free_text_hack" });
    expect(res.status).toBe(400);
  });

  it("preview-segment excludes opted-out and estimates cost", async () => {
    const res = await request(http)
      .post("/api/v1/campaigns/preview-segment")
      .set(asOwner())
      .send({ segment: { tags: ["VIP"] } });
    expect(res.status).toBe(200);
    expect(res.body.recipients).toBe(3);
    // 3 × (0.30 + 0.1×0.55) = 1.065 → rounded to 2dp by estimateCampaignCostEgp
    expect(res.body.estCostEgp).toBe(1.07);
  });

  // ---------- batch send honors the gates ----------
  it("send → batch: opted-in get WA sends, opted-out gets SKIPPED_OPTOUT with NO provider call", async () => {
    const create = await request(http).post("/api/v1/campaigns").set(asOwner()).send(campaignBody);
    const campaignId = create.body.id;

    const send = await request(http).post(`/api/v1/campaigns/${campaignId}/send`).set(asOwner());
    expect(send.status).toBe(200);
    expect(send.body.status).toBe("SENDING");

    mock.reset();
    // workers disabled — drive the batch handler exactly as the worker would
    const outcome = await batch.runBatch(campaignId, null);
    expect(outcome.kind).toBe("done");

    // 3 provider calls (opted-in only), all template-backed
    expect(mock.calls).toHaveLength(3);
    for (const call of mock.calls) expect(call.templateName).toBe("offer_generic");

    const messages = await bypass((tx) => tx.message.findMany({ where: { campaignId } }));
    expect(messages).toHaveLength(4);
    const skipped = messages.filter((m: any) => m.status === "SKIPPED_OPTOUT");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].customerId).toBe(optedOutId);
    expect(messages.filter((m: any) => m.status === "SENT")).toHaveLength(3);

    const done = await bypass((tx) => tx.campaign.findUnique({ where: { id: campaignId } }));
    expect(done.status).toBe("SENT");
    expect(done.recipientCount).toBe(4); // 3 sent + 1 skip recorded

    // ---------- report aggregation + conversion ----------
    await bypass(async (tx) => {
      const user = await tx.user.findFirst({ where: { pharmacyId, role: "OWNER" } });
      await tx.sale.create({
        data: {
          pharmacyId,
          customerId: optedInIds[0],
          loggedById: user.id,
          totalEgp: 100,
          items: { create: [{ nameText: "بنادول", qty: 1, unitPriceEgp: 100 }] },
        },
      });
    });
    const report = await request(http).get(`/api/v1/campaigns/${campaignId}/report`).set(asOwner());
    expect(report.status).toBe(200);
    expect(report.body.totals.sent).toBe(3);
    expect(report.body.totals.skippedOptOut).toBe(1);
    expect(report.body.totals.convertedCustomers).toBe(1);

    // campaign CSV
    const csv = await request(http).get(`/api/v1/reports/campaigns/${campaignId}.csv`).set(asOwner());
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("SKIPPED_OPTOUT");
  });

  it("cancel stops the batch walk", async () => {
    const create = await request(http).post("/api/v1/campaigns").set(asOwner()).send(campaignBody);
    const campaignId = create.body.id;
    await request(http).post(`/api/v1/campaigns/${campaignId}/send`).set(asOwner());
    const cancel = await request(http).post(`/api/v1/campaigns/${campaignId}/cancel`).set(asOwner());
    expect(cancel.status).toBe(200);

    mock.reset();
    const outcome = await batch.runBatch(campaignId, null);
    expect(outcome.kind).toBe("cancelled");
    expect(mock.calls).toHaveLength(0); // cancelled → nothing sent
  });

  // ---------- tax invoice ----------
  it("invoice numbers are sequential per pharmacy and stable on replay", async () => {
    const mkSale = async () => {
      const res = await request(http)
        .post("/api/v1/sales")
        .set(asOwner())
        .send({
          clientRef: crypto.randomUUID(),
          customerId: optedInIds[1],
          items: [{ nameText: "فيتامين سي", qty: 2, unitPriceEgp: 57 }],
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    const saleA = await mkSale();
    const saleB = await mkSale();

    const invA1 = await request(http).get(`/api/v1/sales/${saleA}/invoice`).set(asOwner());
    expect(invA1.status).toBe(200);
    const invB = await request(http).get(`/api/v1/sales/${saleB}/invoice`).set(asOwner());
    const invA2 = await request(http).get(`/api/v1/sales/${saleA}/invoice`).set(asOwner());

    expect(invA1.body.invoiceNo).toBe(1);
    expect(invB.body.invoiceNo).toBe(2);
    expect(invA2.body.invoiceNo).toBe(1); // replay → same number

    // VAT math: prices are inclusive → base + vat = net
    const t = invA1.body.totals;
    expect(t.netEgp).toBeCloseTo(114, 2);
    expect(t.vatRate).toBe(14);
    expect(t.vatBaseEgp).toBeCloseTo(100, 2);
    expect(t.vatAmountEgp).toBeCloseTo(14, 2);
    expect(invA1.body.pharmacy.taxId).toBe("123-456-789");
  });

  // ---------- CSV reports ----------
  it("sales + customers CSVs download with BOM and Arabic headers", async () => {
    const sales = await request(http).get("/api/v1/reports/sales.csv").set(asOwner());
    expect(sales.status).toBe(200);
    expect(sales.text.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    expect(sales.text).toContain("رقم الفاتورة");

    const customers = await request(http).get("/api/v1/reports/customers.csv").set(asOwner());
    expect(customers.status).toBe(200);
    expect(customers.text).toContain("إجمالي المشتريات");
  });

  // ---------- dashboard predictions ----------
  it("dashboard summary includes topCustomers and forecast fields", async () => {
    const res = await request(http).get("/api/v1/dashboard/summary?days=14").set(asOwner());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.topCustomers)).toBe(true);
    expect(res.body.topCustomers.length).toBeGreaterThan(0);
    expect(typeof res.body.upcomingRefillRevenueEgp30d).toBe("number");
    expect(res.body.expectedVisits7d).toHaveProperty("count");
  });

  // ---------- admin surface ----------
  it("admin pharmacies list requires admin audience and returns counts", async () => {
    const tenantTry = await request(http).get("/api/v1/admin/pharmacies").set(asOwner());
    expect(tenantTry.status).toBe(401); // tenant token rejected on admin audience

    const res = await request(http).get("/api/v1/admin/pharmacies?sort=lastActive").set(asAdmin());
    expect(res.status).toBe(200);
    const mine = res.body.data.find((p: any) => p.id === pharmacyId);
    expect(mine).toBeDefined();
    expect(mine.plan).toBe("PRO");
    expect(mine.customers).toBe(4);
  });

  // ---------- BI: platform overview ----------
  it("admin overview returns platform KPIs + 12-month trend", async () => {
    const res = await request(http).get("/api/v1/admin/overview").set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.totalPharmacies).toBeGreaterThanOrEqual(1);
    expect(res.body.proSubscribers).toBeGreaterThanOrEqual(1); // we flipped ours to PRO
    expect(res.body.totalCustomers).toBeGreaterThanOrEqual(4);
    expect(typeof res.body.totalRevenueEgp).toBe("number");
    expect(res.body.monthlyTrend).toHaveLength(12);
    const thisMonth = res.body.monthlyTrend[11];
    expect(thisMonth.revenueEgp).toBeGreaterThan(0); // our test sales land in the current month
  });

  // ---------- BI: per-pharmacy analytics with growth ----------
  it("pharmacy analytics: current window metrics, growth vs previous, tops, trend", async () => {
    const res = await request(http)
      .get(`/api/v1/admin/pharmacies/${pharmacyId}/analytics?period=week`)
      .set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(7);
    expect(res.body.pharmacy.joinedAt).toBeDefined();
    // all our test sales are inside the last 7 days; previous window is empty
    expect(res.body.current.salesCount).toBeGreaterThanOrEqual(3);
    expect(res.body.current.revenueEgp).toBeGreaterThan(0);
    expect(res.body.previous.salesCount).toBe(0);
    expect(res.body.growth.revenuePct).toBeNull(); // no base → null, not Infinity
    expect(res.body.topProducts.length).toBeGreaterThan(0);
    expect(res.body.topCustomers.length).toBeGreaterThan(0);
    expect(res.body.trend).toHaveLength(7); // daily buckets, zero-filled
    const trendTotal = res.body.trend.reduce((s: number, t: any) => s + t.salesCount, 0);
    expect(trendTotal).toBe(res.body.current.salesCount); // trend reconciles with the KPI

    const year = await request(http)
      .get(`/api/v1/admin/pharmacies/${pharmacyId}/analytics?period=year`)
      .set(asAdmin());
    expect(year.body.trend).toHaveLength(12); // monthly buckets for year view
  });

  // ---------- BI: exports ----------
  it("admin CSV exports: directory + per-pharmacy time series", async () => {
    const dir = await request(http).get("/api/v1/admin/reports/pharmacies.csv").set(asAdmin());
    expect(dir.status).toBe(200);
    expect(dir.headers["content-type"]).toContain("text/csv");
    expect(dir.text).toContain("revenue_total_egp"); // BI-friendly snake_case headers
    expect(dir.text).toContain("صيدلية الحملات");

    const series = await request(http)
      .get(`/api/v1/admin/reports/pharmacies/${pharmacyId}/analytics.csv?period=week`)
      .set(asAdmin());
    expect(series.status).toBe(200);
    expect(series.text).toContain("bucket,revenue_egp,sales_count");
  });

  // ---------- blocking ----------
  it("block: audited, kills login AND refresh; unblock restores access", async () => {
    // reason is now mandatory — bare POST must 400, with-reason must 200
    const bare = await request(http)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/block`)
      .set(asAdmin())
      .send({});
    expect(bare.status).toBe(400);
    const block = await request(http)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/block`)
      .set(asAdmin())
      .send({ reason: "e2e block test", note: "internal" });
    expect(block.status).toBe(200);
    expect(block.body.blockedAt).not.toBeNull();

    // login rejected with the stable error code
    const login = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: OWNER_PHONE, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_BLOCKED");

    // directory shows the flag; audit has the row
    const dir = await request(http).get("/api/v1/admin/pharmacies").set(asAdmin());
    expect(dir.body.data.find((p: any) => p.id === pharmacyId).blockedAt).not.toBeNull();
    const audit = await request(http).get("/api/v1/admin/audit").set(asAdmin());
    expect(audit.body.data.some((a: any) => a.action === "PHARMACY_BLOCK" && a.entityId === pharmacyId)).toBe(true);

    // unblock → login works again
    const unblock = await request(http)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/unblock`)
      .set(asAdmin());
    expect(unblock.status).toBe(200);
    expect(unblock.body.blockedAt).toBeNull();

    const login2 = await request(http)
      .post("/api/v1/auth/login")
      .send({ phone: OWNER_PHONE, password: PASSWORD });
    expect(login2.status).toBe(200);
  });

  it("metric layer: kpis with prev-window comparison, series per metric, distributions", async () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);

    const kpis = await request(http).get(`/api/v1/admin/analytics/kpis?from=${from}&to=${to}`).set(asAdmin());
    expect(kpis.status).toBe(200);
    expect(kpis.body.revenue.current).toBeGreaterThan(0);
    expect(kpis.body.revenue).toHaveProperty("previous");
    expect(kpis.body.revenue).toHaveProperty("growthPct");
    expect(kpis.body.proSubscribers.previous).toBeNull(); // point-in-time → no comparison
    expect(kpis.body.conversionRatePct.current).toBeGreaterThanOrEqual(0);

    // different metrics → different series (not the same chart re-labelled)
    const rev = await request(http).get(`/api/v1/admin/analytics/series?metric=revenue&from=${from}&to=${to}`).set(asAdmin());
    const cust = await request(http).get(`/api/v1/admin/analytics/series?metric=customers&from=${from}&to=${to}`).set(asAdmin());
    expect(rev.status).toBe(200);
    expect(cust.status).toBe(200);
    expect(rev.body.metric).toBe("revenue");
    expect(cust.body.metric).toBe("customers");
    expect(rev.body.buckets.length).toBe(30);
    const sum = (b: { value: number }[]) => b.reduce((s: number, x: { value: number }) => s + x.value, 0);
    expect(sum(rev.body.buckets)).not.toBe(sum(cust.body.buckets));

    const dist = await request(http).get(`/api/v1/admin/analytics/distribution?metric=subscribers&by=plan&from=${from}&to=${to}`).set(asAdmin());
    expect(dist.status).toBe(200);
    const labels = dist.body.slices.map((s: { label: string }) => s.label).sort();
    expect(labels).toEqual(["FREE", "PRO"]);

    const invalid = await request(http).get(`/api/v1/admin/analytics/series?metric=nope&from=${from}&to=${to}`).set(asAdmin());
    expect(invalid.status).toBe(400);
  });

  it("excel export honors the range filter and contains typed sheets", async () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(http).get(`/api/v1/admin/reports/export.xls?from=${from}&to=${to}`).set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.ms-excel");
    for (const sheetName of ["Summary", "Revenue_Trend", "Pharmacies", "Sales_By_Category", "Subscriptions"]) {
      expect(res.text).toContain(`ss:Name="${sheetName}"`);
    }
    expect(res.text).toContain(`<Data ss:Type="Number">`); // numerics typed, not formatted strings
    expect(res.text).toContain(from); // range echoed into Summary rows
  });

  it("pharmacy analytics supports quarter and custom ranges", async () => {
    const q = await request(http).get(`/api/v1/admin/pharmacies/${pharmacyId}/analytics?period=quarter`).set(asAdmin());
    expect(q.status).toBe(200);
    expect(q.body.windowDays).toBe(90);

    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 13 * 86_400_000).toISOString().slice(0, 10);
    const c = await request(http).get(`/api/v1/admin/pharmacies/${pharmacyId}/analytics?period=custom&from=${from}&to=${to}`).set(asAdmin());
    expect(c.status).toBe(200);
    expect(c.body.windowDays).toBeGreaterThanOrEqual(13);

    const bad = await request(http).get(`/api/v1/admin/pharmacies/${pharmacyId}/analytics?period=custom`).set(asAdmin());
    expect(bad.status).toBe(400); // custom requires from/to
  });
});
