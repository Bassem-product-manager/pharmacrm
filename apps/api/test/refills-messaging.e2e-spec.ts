/**
 * Session 6 tests (build/session-plans/06-refills-messaging.md) — the 6 mandated.
 * MockProvider is active (NODE_ENV=test). BullMQ workers are disabled under
 * test; the tests drive the same handler methods the workers call, so the
 * pipeline logic is covered without timer flakiness. "Fake 6h pass" =
 * invoking the +6h fallback-check handler directly, as the worker would.
 * Requires postgres + redis (docker compose up -d), migrations applied.
 */
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { createHmac } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { MessagingService } from "../src/modules/messaging/messaging.service";
import { MockProvider } from "../src/modules/messaging/providers/mock.provider";
import { ReminderScanService } from "../src/jobs/reminder-scan.service";
import { delayUntilWindowOpenMs, isWithinQuietWindow } from "../src/modules/messaging/quiet-hours";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
process.env.WA_APP_SECRET = "test-wa-app-secret";
process.env.JOBS_DISABLED = "1";

const OWNER_PHONE = "+201094000001";
const PASSWORD = "Sup3rSecret!";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Session 6 — refills + messaging pipeline", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let messaging: MessagingService;
  let mock: MockProvider;
  let scanner: ReminderScanService;
  let http: ReturnType<INestApplication["getHttpServer"]>;
  let ownerToken: string;
  let pharmacyId: string;
  let productId: string;

  const bypass = <T>(fn: (tx: any) => Promise<T>) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      return fn(tx);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    messaging = app.get(MessagingService);
    mock = app.get(MockProvider);
    scanner = app.get(ReminderScanService);

    await cleanup();
    const signup = await request(http).post("/api/v1/auth/signup").send({
      pharmacyName: "صيدلية التذكيرات",
      ownerName: "مالك",
      phone: OWNER_PHONE,
      password: PASSWORD,
    });
    expect(signup.status).toBe(201);
    pharmacyId = signup.body.pharmacyId;
    ownerToken = signup.body.accessToken;

    // start === end wraps to a truly 24h-open send window (0..23 left the
    // 23:00 hour closed → suite failed when run after 11 PM Cairo); per-test
    // cases override quietStart/quietEnd explicitly.
    await bypass((tx) =>
      tx.pharmacy.update({ where: { id: pharmacyId }, data: { quietStart: 12, quietEnd: 12 } }),
    );
    const product = await bypass((tx) =>
      tx.productRef.create({ data: { pharmacyId, nameText: "كونكور 5 مجم", aliases: [] } }),
    );
    productId = product.id;
  });

  afterEach(() => mock.reset());
  afterAll(async () => {
    await app?.close();
  });

  async function cleanup() {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_tenant = 'on'`);
      for (const sql of [
        `DELETE FROM "Message" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Reminder" WHERE "refillRuleId" IN (SELECT rr.id FROM "RefillRule" rr JOIN "Customer" c ON c.id=rr."customerId" WHERE c."pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "RefillRule" WHERE "customerId" IN (SELECT id FROM "Customer" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "SaleItem" WHERE "saleId" IN (SELECT id FROM "Sale" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'))`,
        `DELETE FROM "PointsTransaction" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Sale" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "ProductRef" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Customer" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "User" WHERE "pharmacyId" IN (SELECT id FROM "Pharmacy" WHERE phone='${OWNER_PHONE}')`,
        `DELETE FROM "Pharmacy" WHERE phone='${OWNER_PHONE}'`,
      ]) {
        await tx.$executeRawUnsafe(sql);
      }
    });
  }

  async function makeReminder(customerPhone: string, opts: { optedOut?: boolean } = {}) {
    return bypass(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          pharmacyId,
          name: `عميل ${customerPhone.slice(-4)}`,
          phone: customerPhone,
          consentAt: new Date(),
          optedOutAt: opts.optedOut ? new Date() : null,
        },
      });
      const rule = await tx.refillRule.create({
        data: {
          customerId: customer.id,
          productRefId: productId,
          cycleDays: 30,
          nextDueAt: new Date(Date.now() + DAY_MS),
        },
      });
      const reminder = await tx.reminder.create({
        data: { refillRuleId: rule.id, dueAt: rule.nextDueAt, status: "PENDING" },
      });
      return { customer, rule, reminder };
    });
  }

  // ---- Test 1: gate — opt-out ----
  it("1. optedOut customer → SKIPPED_OPTOUT, provider NEVER called", async () => {
    const { reminder } = await makeReminder("+201094111001", { optedOut: true });
    const outcome = await messaging.sendReminder(reminder.id);
    expect(outcome.kind).toBe("skipped_optout");
    expect(mock.calls.length).toBe(0);

    const msg = await bypass((tx) => tx.message.findFirst({ where: { reminderId: reminder.id } }));
    expect(msg?.status).toBe("SKIPPED_OPTOUT");
  });

  // ---- Test 2: gate — quiet hours delays to window open ----
  it("2. send outside quiet window → delayed to 09:00 next window (pure fn + service)", async () => {
    // pure function: 23:00 Cairo is outside 9–21 → delay lands inside window
    const at2300 = (() => {
      const d = new Date();
      for (let h = 0; h < 24; h++) {
        const c = new Date(d.getTime() + h * 60 * 60 * 1000);
        if (!isWithinQuietWindow(c, 9, 21)) return c;
      }
      throw new Error("unreachable");
    })();
    const delay = delayUntilWindowOpenMs(at2300, 9, 21);
    expect(delay).toBeGreaterThan(0);
    expect(isWithinQuietWindow(new Date(at2300.getTime() + delay), 9, 21)).toBe(true);

    // service path: 1h window that provably does NOT contain the current hour
    const nowCairoHour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour12: false, hour: "2-digit" }).format(new Date()),
    ) % 24;
    await bypass((tx) =>
      tx.pharmacy.update({
        where: { id: pharmacyId },
        data: { quietStart: (nowCairoHour + 2) % 24, quietEnd: (nowCairoHour + 3) % 24 },
      }),
    );
    const { reminder } = await makeReminder("+201094111002");
    const outcome = await messaging.sendReminder(reminder.id);
    expect(outcome.kind).toBe("delayed");
    expect(mock.calls.length).toBe(0);
    // bypassQuietHours (أرسل الآن) still goes through
    const manual = await messaging.sendReminder(reminder.id, { bypassQuietHours: true });
    expect(manual.kind).toBe("sent");
    expect(mock.calls.length).toBe(1);
    await bypass((tx) =>
      // restore the ALWAYS-open window (start === end wraps 24h)
      tx.pharmacy.update({ where: { id: pharmacyId }, data: { quietStart: 12, quietEnd: 12 } }),
    );
  });

  // ---- Test 3: gate — monthly cap ----
  it("3. cap reached → skipped_cap, no provider call", async () => {
    await bypass((tx) =>
      tx.pharmacy.update({ where: { id: pharmacyId }, data: { monthlyReminderCap: 0 } }),
    );
    const { reminder } = await makeReminder("+201094111003");
    const outcome = await messaging.sendReminder(reminder.id);
    expect(outcome.kind).toBe("skipped_cap");
    expect(mock.calls.length).toBe(0);
    await bypass((tx) =>
      tx.pharmacy.update({ where: { id: pharmacyId }, data: { monthlyReminderCap: 100 } }),
    );
  });

  // ---- Test 4: fallback WA→SMS ----
  it("4. WA sent, 6h pass without delivery → SMS fallback sent", async () => {
    const { reminder } = await makeReminder("+201094111004");
    const sendOutcome = await messaging.sendReminder(reminder.id);
    expect(sendOutcome.kind).toBe("sent");
    expect(mock.calls.length).toBe(1);
    expect(mock.calls[0]!.templateName).toBe("refill_reminder"); // R4

    // fake 6h pass — run the +6h check exactly as the worker would
    const waMessageId = (sendOutcome as { messageId: string }).messageId;
    const fb = await messaging.runFallbackCheck(waMessageId);
    expect(fb.kind).toBe("sms_sent");
    expect(mock.calls.length).toBe(2);
    expect(mock.calls[1]!.bodyText).toBeTruthy(); // SMS leg: bodyText, no template

    const waMsg = await bypass((tx) => tx.message.findUnique({ where: { id: waMessageId } }));
    expect(waMsg?.status).toBe("FALLBACK_TRIGGERED");
  });

  // ---- Test 5: full fail → Reminder FAILED ----
  it("5. WA undelivered + SMS undelivered → Reminder.status=FAILED", async () => {
    const { reminder } = await makeReminder("+201094111005");
    const sendOutcome = await messaging.sendReminder(reminder.id);
    expect(sendOutcome.kind).toBe("sent");
    const waMessageId = (sendOutcome as { messageId: string }).messageId;

    const fb = await messaging.runFallbackCheck(waMessageId);
    expect(fb.kind).toBe("sms_sent");
    const smsMessageId = (fb as { messageId: string }).messageId;

    // +2h final check with SMS still not delivered
    const final = await messaging.runFinalCheck(smsMessageId);
    expect(final).toBe("reminder_failed");

    const after = await bypass((tx) => tx.reminder.findUnique({ where: { id: reminder.id } }));
    expect(after?.status).toBe("FAILED");
  });

  // ---- Test 6: opt-out webhook end-to-end ----
  it("6. inbound 'stop' webhook → optedOutAt set → next reminder skipped", async () => {
    const phone = "+201094111006";
    const { customer, rule } = await makeReminder(phone);

    const payload = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { messages: [{ from: phone.slice(1), text: { body: "stop" } }] } },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac("sha256", process.env.WA_APP_SECRET!).update(payload).digest("hex")}`;

    // wrong signature rejected BEFORE any DB effect
    const bad = await request(http)
      .post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(payload);
    expect(bad.status).toBe(401);

    const ok = await request(http)
      .post("/api/v1/webhooks/whatsapp")
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", signature)
      .send(payload);
    expect(ok.status).toBe(201);

    const updated = await bypass((tx) => tx.customer.findUnique({ where: { id: customer.id } }));
    expect(updated?.optedOutAt).toBeTruthy();

    // a NEW reminder for the now-opted-out customer is skipped
    const newReminder = await bypass((tx) =>
      tx.reminder.create({
        data: {
          refillRuleId: rule.id,
          dueAt: new Date(Date.now() + 2 * DAY_MS),
          status: "PENDING",
        },
      }),
    );
    mock.reset();
    const outcome = await messaging.sendReminder(newReminder.id);
    expect(outcome.kind).toBe("skipped_optout");
    expect(mock.calls.length).toBe(0);
  });

  // ---- bonus: cron scan creates PENDING reminders with dedup ----
  it("cron scan: due rule → one Reminder, second scan no duplicate (R10)", async () => {
    const { rule } = await bypass(async (tx) => {
      const customer = await tx.customer.create({
        data: { pharmacyId, name: "عميل السكان", phone: "+201094111007", consentAt: new Date() },
      });
      const rule = await tx.refillRule.create({
        data: {
          customerId: customer.id,
          productRefId: productId,
          cycleDays: 30,
          remindDaysBefore: 2,
          nextDueAt: new Date(Date.now() + DAY_MS), // due tomorrow, remind 2d before → due NOW
        },
      });
      return { rule };
    });

    await scanner.scan();
    await scanner.scan(); // second scan must not duplicate

    const count = await bypass((tx) => tx.reminder.count({ where: { refillRuleId: rule.id } }));
    expect(count).toBe(1);
  });
});
