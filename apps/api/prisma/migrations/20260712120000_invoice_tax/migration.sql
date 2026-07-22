-- Tax invoice support (Phase B+ CTO):
-- Pharmacy gains invoice header fields + a per-pharmacy invoice counter;
-- Sale gains the assigned-at-issuance sequential invoice number.
ALTER TABLE "Pharmacy"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "taxId" TEXT,
  ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 14,
  ADD COLUMN "invoiceSeq" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Sale" ADD COLUMN "invoiceNo" INTEGER;

-- Nulls don't collide in PG unique indexes: only issued invoices are constrained.
CREATE UNIQUE INDEX "Sale_pharmacyId_invoiceNo_key" ON "Sale"("pharmacyId", "invoiceNo");
