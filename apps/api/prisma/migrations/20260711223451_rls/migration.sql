-- PharmaCRM Row Level Security (R6, layer 2 backstop for raw queries).
-- Apply AFTER the init migration:
--   npx prisma migrate dev --create-only --name rls
--   → paste this file into the generated migration.sql
--   npx prisma migrate dev
--
-- The API sets the tenant per request-transaction:
--   SET LOCAL app.pharmacy_id = '<pharmacyId from JWT>';
-- current_setting('app.pharmacy_id', true) returns NULL when unset → all
-- policies fail closed (0 rows) for any connection that forgot to set it.
--
-- FORCE is required: Prisma connects as the table owner, and owners bypass
-- plain ENABLE ROW LEVEL SECURITY.

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION app_pharmacy_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.pharmacy_id', true)
$$;

-- Service bypass flag: opened per-transaction with SET LOCAL app.bypass_tenant
-- = 'on' (auth service, admin module). Unset → false → no bypass (fail-closed).
CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.bypass_tenant', true) = 'on'
$$;

-- ---------- tenant root ----------
ALTER TABLE "Pharmacy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Pharmacy" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Pharmacy"
  USING (id = app_pharmacy_id())
  WITH CHECK (id = app_pharmacy_id());

-- ---------- tables with a direct "pharmacyId" column ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'User', 'Customer', 'ProductRef', 'Sale',
    'PointsTransaction', 'Campaign', 'Message', 'AuditLog'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("pharmacyId" = app_pharmacy_id())
         WITH CHECK ("pharmacyId" = app_pharmacy_id())', t);
  END LOOP;
END $$;

-- ---------- child tables scoped through parent relations ----------
ALTER TABLE "SaleItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SaleItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SaleItem"
  USING (EXISTS (
    SELECT 1 FROM "Sale" s
    WHERE s.id = "SaleItem"."saleId" AND s."pharmacyId" = app_pharmacy_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Sale" s
    WHERE s.id = "SaleItem"."saleId" AND s."pharmacyId" = app_pharmacy_id()));

ALTER TABLE "RefillRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefillRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RefillRule"
  USING (EXISTS (
    SELECT 1 FROM "Customer" c
    WHERE c.id = "RefillRule"."customerId" AND c."pharmacyId" = app_pharmacy_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Customer" c
    WHERE c.id = "RefillRule"."customerId" AND c."pharmacyId" = app_pharmacy_id()));

ALTER TABLE "Reminder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reminder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Reminder"
  USING (EXISTS (
    SELECT 1 FROM "RefillRule" r
    JOIN "Customer" c ON c.id = r."customerId"
    WHERE r.id = "Reminder"."refillRuleId" AND c."pharmacyId" = app_pharmacy_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "RefillRule" r
    JOIN "Customer" c ON c.id = r."customerId"
    WHERE r.id = "Reminder"."refillRuleId" AND c."pharmacyId" = app_pharmacy_id()));

-- ---------- service bypass (auth bootstrap + internal admin) ----------
-- Login/signup must read "User"/"Pharmacy" BEFORE any tenant is known, and
-- /admin/* aggregates across tenants. Postgres OR's permissive policies, so
-- this adds a second policy per table that is still fail-closed: it opens ONLY
-- inside a transaction that ran SET LOCAL app.bypass_tenant = 'on' (auth
-- service, admin module). A connection that sets nothing still sees 0 rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Pharmacy', 'User', 'Customer', 'ProductRef', 'Sale', 'SaleItem',
    'PointsTransaction', 'RefillRule', 'Reminder', 'Campaign', 'Message', 'AuditLog'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY service_bypass ON %I
         USING (app_bypass())
         WITH CHECK (app_bypass())', t);
  END LOOP;
END $$;

-- "AdminUser" intentionally has NO RLS — outside the tenant model (docs/06 §2).
