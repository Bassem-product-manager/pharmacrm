/**
 * PharmaCRM seed — Session 2.
 * Re-runnable: deterministic IDs + upserts (no duplicates on second run).
 * Data: 1 pharmacy (FREE), OWNER + STAFF, 10 customers (CHRONIC/VIP mix),
 * 6 products, 5 sales + SaleItems + PointsTransactions, 2 RefillRules, 1 Reminder.
 */
import { Prisma, PrismaClient, Tag, Gender, PointsType } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const client = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

const PHARMACY_ID = "seed-pharmacy-1";

type Tx = Prisma.TransactionClient;

async function seed(prisma: Tx) {
  // ---------- Pharmacy ----------
  const taxFields = {
    address: "١٥ شارع التحرير، الدقي، الجيزة",
    taxId: "٣٥٩-٤٧٢-٦١٨", // البطاقة الضريبية (demo)
    vatRate: 14,
  };
  const pharmacy = await prisma.pharmacy.upsert({
    where: { id: PHARMACY_ID },
    update: taxFields, // backfill invoice fields on re-runs against an existing DB
    create: {
      id: PHARMACY_ID,
      name: "صيدلية النور",
      phone: "+201001234567",
      city: "القاهرة",
      plan: "FREE",
      ...taxFields,
    },
  });
  const pid = pharmacy.id;

  // ---------- Super admin (docs/06) ----------
  await prisma.adminUser.upsert({
    where: { email: "admin@pharmacrm.local" },
    update: {},
    create: {
      id: "seed-admin-1",
      email: "admin@pharmacrm.local",
      passwordHash: await bcrypt.hash("Admin123!", 10),
    },
  });

  // ---------- Users ----------
  const passwordHash = await bcrypt.hash("Passw0rd!", 10);
  const owner = await prisma.user.upsert({
    where: { phone: "+201001111111" },
    update: {},
    create: {
      id: "seed-user-owner",
      pharmacyId: pid,
      name: "د. أحمد حسن",
      phone: "+201001111111",
      passwordHash,
      role: "OWNER",
    },
  });
  const staff = await prisma.user.upsert({
    where: { phone: "+201002222222" },
    update: {},
    create: {
      id: "seed-user-staff",
      pharmacyId: pid,
      name: "محمد سمير",
      phone: "+201002222222",
      passwordHash,
      role: "STAFF",
    },
  });

  // ---------- Customers ----------
  type C = {
    n: number;
    name: string;
    phone: string;
    gender: Gender;
    birthYear?: number;
    tags: Tag[];
    lastVisitDaysAgo?: number;
    optedOut?: boolean;
  };
  const customersData: C[] = [
    { n: 1, name: "فاطمة عبد الرحمن", phone: "+201012345601", gender: "FEMALE", birthYear: 1958, tags: ["CHRONIC"], lastVisitDaysAgo: 3 },
    { n: 2, name: "محمود السيد", phone: "+201112345602", gender: "MALE", birthYear: 1965, tags: ["CHRONIC", "VIP"], lastVisitDaysAgo: 5 },
    { n: 3, name: "منى إبراهيم", phone: "+201212345603", gender: "FEMALE", birthYear: 1980, tags: ["VIP"], lastVisitDaysAgo: 10 },
    { n: 4, name: "خالد مصطفى", phone: "+201512345604", gender: "MALE", birthYear: 1972, tags: ["CHRONIC"], lastVisitDaysAgo: 20 },
    { n: 5, name: "سارة يوسف", phone: "+201012345605", gender: "FEMALE", birthYear: 1990, tags: [], lastVisitDaysAgo: 15 },
    { n: 6, name: "عمر فاروق", phone: "+201112345606", gender: "MALE", birthYear: 1985, tags: [], lastVisitDaysAgo: 45 },
    { n: 7, name: "هدى كمال", phone: "+201212345607", gender: "FEMALE", birthYear: 1955, tags: ["CHRONIC"], lastVisitDaysAgo: 7 },
    { n: 8, name: "طارق عادل", phone: "+201512345608", gender: "MALE", birthYear: 1978, tags: ["VIP"], lastVisitDaysAgo: 60 },
    { n: 9, name: "نادية شوقي", phone: "+201012345609", gender: "FEMALE", birthYear: 1968, tags: [], optedOut: true, lastVisitDaysAgo: 90 },
    { n: 10, name: "يوسف النجار", phone: "+201112345610", gender: "MALE", birthYear: 1995, tags: [] },
  ];
  const customers = [] as Awaited<ReturnType<typeof prisma.customer.upsert>>[];
  for (const c of customersData) {
    customers.push(
      await prisma.customer.upsert({
        where: { pharmacyId_phone: { pharmacyId: pid, phone: c.phone } },
        update: {},
        create: {
          id: `seed-customer-${c.n}`,
          pharmacyId: pid,
          name: c.name,
          phone: c.phone,
          gender: c.gender,
          birthYear: c.birthYear,
          tags: c.tags,
          consentAt: daysAgo(120),
          optedOutAt: c.optedOut ? daysAgo(30) : null,
          lastVisitAt: c.lastVisitDaysAgo != null ? daysAgo(c.lastVisitDaysAgo) : null,
        },
      }),
    );
  }

  // ---------- Products (formulary: price, company, category, stock) ----------
  const productCatalog = [
    { nameText: "كونكور 5 مجم", company: "ميرك", category: "أدوية الضغط", priceEgp: 120, stock: 40, description: "بيسوبرولول — لعلاج ضغط الدم المرتفع وأمراض القلب." },
    { nameText: "جلوكوفاج 850 مجم", company: "ميرك", category: "أدوية السكر", priceEgp: 45, stock: 60, description: "ميتفورمين — للتحكم في سكر الدم لمرضى النوع الثاني." },
    { nameText: "أموريل 2 مجم", company: "سانوفي", category: "أدوية السكر", priceEgp: 55, stock: 3, description: "جليمابيريد — يحفّز إفراز الأنسولين." },
    { nameText: "بنادول اكسترا", company: "جلاكسو", category: "مسكنات", priceEgp: 30, stock: 120, description: "باراسيتامول + كافيين — مسكّن وخافض للحرارة." },
    { nameText: "فيتامين د 5000", company: "فاركو", category: "فيتامينات", priceEgp: 75, stock: 25, description: "مكمّل فيتامين د — لنقص الفيتامين ودعم العظام." },
    { nameText: "كريستور 10 مجم", company: "أسترازينيكا", category: "أدوية الكوليسترول", priceEgp: 180, stock: 4, description: "روزوفاستاتين — لخفض الكوليسترول الضار." },
  ];
  const products = [] as Awaited<ReturnType<typeof prisma.productRef.upsert>>[];
  for (const [i, p] of productCatalog.entries()) {
    products.push(
      await prisma.productRef.upsert({
        where: { pharmacyId_nameText: { pharmacyId: pid, nameText: p.nameText } },
        update: {
          company: p.company,
          category: p.category,
          priceEgp: p.priceEgp,
          stock: p.stock,
          description: p.description,
        },
        create: {
          id: `seed-product-${i + 1}`,
          pharmacyId: pid,
          nameText: p.nameText,
          aliases: [],
          company: p.company,
          category: p.category,
          priceEgp: p.priceEgp,
          stock: p.stock,
          description: p.description,
        },
      }),
    );
  }

  // ---------- Sales + items + points (ledger-consistent) ----------
  // loyaltyRatio 0.1 → earned = floor(total * 0.1)
  type S = {
    n: number;
    customerIdx: number; // index in customers[]
    loggedById: string;
    items: { productIdx?: number; nameText: string; qty: number; unitPriceEgp?: number }[];
    totalEgp: number;
    daysAgo: number;
  };
  const salesData: S[] = [
    { n: 1, customerIdx: 0, loggedById: owner.id, items: [{ productIdx: 0, nameText: "كونكور 5 مجم", qty: 1, unitPriceEgp: 120 }], totalEgp: 120, daysAgo: 0 },
    { n: 2, customerIdx: 1, loggedById: staff.id, items: [{ productIdx: 1, nameText: "جلوكوفاج 850 مجم", qty: 2, unitPriceEgp: 45 }, { productIdx: 4, nameText: "فيتامين د 5000", qty: 1, unitPriceEgp: 75 }], totalEgp: 165, daysAgo: 1 },
    { n: 3, customerIdx: 2, loggedById: staff.id, items: [{ productIdx: 3, nameText: "بنادول اكسترا", qty: 2, unitPriceEgp: 30 }], totalEgp: 60, daysAgo: 2 },
    { n: 4, customerIdx: 6, loggedById: owner.id, items: [{ productIdx: 5, nameText: "كريستور 10 مجم", qty: 1, unitPriceEgp: 180 }], totalEgp: 180, daysAgo: 3 },
    { n: 5, customerIdx: 3, loggedById: staff.id, items: [{ productIdx: 2, nameText: "أموريل 2 مجم", qty: 1, unitPriceEgp: 55 }, { productIdx: 3, nameText: "بنادول اكسترا", qty: 1, unitPriceEgp: 30 }], totalEgp: 85, daysAgo: 4 },
    { n: 6, customerIdx: 4, loggedById: owner.id, items: [{ productIdx: 0, nameText: "كونكور 5 مجم", qty: 2, unitPriceEgp: 120 }], totalEgp: 240, daysAgo: 6 },
    { n: 7, customerIdx: 5, loggedById: staff.id, items: [{ productIdx: 1, nameText: "جلوكوفاج 850 مجم", qty: 1, unitPriceEgp: 45 }], totalEgp: 45, daysAgo: 8 },
    { n: 8, customerIdx: 7, loggedById: owner.id, items: [{ productIdx: 3, nameText: "بنادول اكسترا", qty: 3, unitPriceEgp: 30 }, { productIdx: 4, nameText: "فيتامين د 5000", qty: 1, unitPriceEgp: 75 }], totalEgp: 165, daysAgo: 11 },
  ];

  const earnedByCustomer = new Map<string, number>();
  for (const s of salesData) {
    const saleId = `seed-sale-${s.n}`;
    const customer = customers[s.customerIdx];
    const existing = await prisma.sale.findUnique({ where: { id: saleId } });
    const earned = Math.floor(s.totalEgp * 0.1);
    earnedByCustomer.set(customer.id, (earnedByCustomer.get(customer.id) ?? 0) + earned);
    if (existing) continue;
    await prisma.sale.create({
      data: {
        id: saleId,
        pharmacyId: pid,
        customerId: customer.id,
        loggedById: s.loggedById,
        totalEgp: s.totalEgp,
        clientRef: `seed-clientref-${s.n}`,
        createdAt: daysAgo(s.daysAgo),
        items: {
          create: s.items.map((it, j) => ({
            id: `seed-saleitem-${s.n}-${j + 1}`,
            nameText: it.nameText,
            qty: it.qty,
            unitPriceEgp: it.unitPriceEgp ?? 0,
            productRefId: it.productIdx != null ? products[it.productIdx].id : null,
          })),
        },
        pointsTx: {
          create: {
            id: `seed-points-${s.n}`,
            pharmacyId: pid,
            customerId: customer.id,
            type: PointsType.EARN,
            points: earned,
            createdAt: daysAgo(s.daysAgo),
          },
        },
      },
    });
  }

  // ---------- Historical sales (BI demo: 6 months of trend data) ----------
  // Deterministic pseudo-random walk over days 15..180 so monthly trends,
  // growth comparisons and previous-window KPIs have real data. Modeled as a
  // historical import: no points ledger entries (balances stay D1-consistent).
  for (let n = 9; n <= 60; n++) {
    const saleId = `seed-sale-${n}`;
    if (await prisma.sale.findUnique({ where: { id: saleId } })) continue;
    const r = (k: number) => ((n * 7919 + k * 104729) % 997) / 997; // deterministic 0..1
    const dayOffset = 15 + Math.floor(r(1) * 165); // 15..180 days ago
    const customer = customers[Math.floor(r(2) * customers.length)];
    const productIdx = Math.floor(r(3) * products.length);
    const qty = 1 + Math.floor(r(4) * 3);
    const unitPrice = [120, 45, 55, 30, 75, 180][productIdx] ?? 50;
    await prisma.sale.create({
      data: {
        id: saleId,
        pharmacyId: pid,
        customerId: customer.id,
        loggedById: r(5) > 0.5 ? owner.id : staff.id,
        totalEgp: unitPrice * qty,
        clientRef: `seed-clientref-${n}`,
        createdAt: daysAgo(dayOffset),
        items: {
          create: [{
            id: `seed-saleitem-${n}-1`,
            nameText: products[productIdx].nameText,
            qty,
            unitPriceEgp: unitPrice,
            productRefId: products[productIdx].id,
          }],
        },
      },
    });
  }

  // Heal denormalized balances from the ledger (D1)
  for (const [customerId, sum] of earnedByCustomer) {
    await prisma.customer.update({
      where: { id: customerId },
      data: { pointsBalance: sum },
    });
  }

  // ---------- Refill rules ----------
  // Rule 1: فاطمة — كونكور monthly, due in 25 days (bought 3 days ago, 28-day cycle)
  const rule1 = await prisma.refillRule.upsert({
    where: { id: "seed-refill-1" },
    update: {},
    create: {
      id: "seed-refill-1",
      customerId: customers[0].id,
      productRefId: products[0].id,
      cycleDays: 28,
      remindDaysBefore: 2,
      nextDueAt: daysAhead(25),
    },
  });
  // Rule 2: محمود — جلوكوفاج, due tomorrow → produces the PENDING reminder
  const rule2 = await prisma.refillRule.upsert({
    where: { id: "seed-refill-2" },
    update: {},
    create: {
      id: "seed-refill-2",
      customerId: customers[1].id,
      productRefId: products[1].id,
      cycleDays: 30,
      remindDaysBefore: 2,
      nextDueAt: daysAhead(1),
    },
  });

  // ---------- Reminder (PENDING, for rule 2) ----------
  await prisma.reminder.upsert({
    where: { refillRuleId_dueAt: { refillRuleId: rule2.id, dueAt: rule2.nextDueAt } },
    update: {},
    create: {
      id: "seed-reminder-1",
      refillRuleId: rule2.id,
      dueAt: rule2.nextDueAt,
      status: "PENDING",
    },
  });

  console.log("Seed complete:", {
    pharmacy: pharmacy.name,
    users: 2,
    customers: customers.length,
    products: products.length,
    sales: salesData.length,
    refillRules: [rule1.id, rule2.id],
    reminders: 1,
  });
}

async function main() {
  // Single interactive transaction so SET LOCAL app.pharmacy_id (required by
  // FORCED RLS) holds for every statement on the same connection.
  await client.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.pharmacy_id = '${PHARMACY_ID}'`);
      await seed(tx);
    },
    { timeout: 120_000 },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => client.$disconnect());
