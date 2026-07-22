import { Body, Controller, Get, Patch } from "@nestjs/common";
import {
  patchLoyaltySchema,
  patchSettingsSchema,
  type PatchLoyaltyInput,
  type PatchSettingsInput,
} from "@pharmacrm/shared";
import { Roles } from "../../common/guards/roles.guard";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { SettingsService } from "./settings.service";

/**
 * docs/05 §7 — pharmacy settings. Reads for both roles (staff sees the quiet
 * window etc.), writes OWNER-only. Loyalty knobs live at /loyalty/settings
 * (S60) but share the same service/row.
 */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("settings")
  get() {
    return this.settings.get();
  }

  @Roles("OWNER")
  @Patch("settings")
  patch(
    @Body(new ZodValidationPipe(patchSettingsSchema)) body: PatchSettingsInput,
  ) {
    return this.settings.patch(body);
  }

  @Get("loyalty/settings")
  getLoyalty() {
    return this.settings.getLoyalty();
  }

  @Roles("OWNER")
  @Patch("loyalty/settings")
  patchLoyalty(
    @Body(new ZodValidationPipe(patchLoyaltySchema)) body: PatchLoyaltyInput,
  ) {
    return this.settings.patchLoyalty(body);
  }
}
