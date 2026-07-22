-- Super-admin restriction: a blocked pharmacy can no longer log in or refresh
-- sessions (checked in auth.service). Existing access tokens age out in <=15m.
ALTER TABLE "Pharmacy" ADD COLUMN "blockedAt" TIMESTAMP(3);
