import { Injectable } from "@nestjs/common";
import type { PatchLoyaltyInput, PatchSettingsInput } from "@pharmacrm/shared";
import { getPharmacyId } from "../../common/tenant-context";
import { PrismaService } from "../../common/prisma.service";

const SETTINGS_SELECT = {
  id: true,
  name: true,
  phone: true,
  city: true,
  address: true,
  taxId: true,
  vatRate: true,
  smsSenderName: true,
  smsFallback: true,
  quietStart: true,
  quietEnd: true,
  plan: true,
  monthlyReminderCap: true,
} as const;

const LOYALTY_SELECT = { loyaltyRatio: true, redeemRate: true } as const;

/**
 * The Pharmacy row IS the settings record. Access goes through withTenantRls
 * with id = the JWT pharmacyId — the tenant extension doesn't scope Pharmacy
 * (it's the tenant root), so RLS is the enforcement layer here.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get() {
    return this.prisma.withTenantRls((tx) =>
      tx.pharmacy.findUniqueOrThrow({ where: { id: getPharmacyId()! }, select: SETTINGS_SELECT }),
    );
  }

  patch(input: PatchSettingsInput) {
    return this.prisma.withTenantRls((tx) =>
      tx.pharmacy.update({
        where: { id: getPharmacyId()! },
        data: input,
        select: SETTINGS_SELECT,
      }),
    );
  }

  getLoyalty() {
    return this.prisma.withTenantRls((tx) =>
      tx.pharmacy.findUniqueOrThrow({ where: { id: getPharmacyId()! }, select: LOYALTY_SELECT }),
    );
  }

  patchLoyalty(input: PatchLoyaltyInput) {
    return this.prisma.withTenantRls((tx) =>
      tx.pharmacy.update({
        where: { id: getPharmacyId()! },
        data: input,
        select: LOYALTY_SELECT,
      }),
    );
  }
}
