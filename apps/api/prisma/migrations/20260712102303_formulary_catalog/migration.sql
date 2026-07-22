-- AlterTable
ALTER TABLE "ProductRef" ADD COLUMN     "category" TEXT,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "priceEgp" DECIMAL(10,2),
ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "unitPriceEgp" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ProductRef_pharmacyId_category_idx" ON "ProductRef"("pharmacyId", "category");
