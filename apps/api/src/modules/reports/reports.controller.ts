import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { reportRangeSchema, type ReportRangeQuery } from "@pharmacrm/shared";
import { ZodValidationPipe } from "../../common/zod.pipe";
import { ReportsService } from "./reports.service";

const sendCsv = (res: Response, out: { filename: string; csv: string }) => {
  res
    .status(200)
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
    })
    .send(out.csv);
};

/** CSV downloads — fetched with the bearer token, saved as a blob client-side. */
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("sales.csv")
  async sales(
    @Query(new ZodValidationPipe(reportRangeSchema)) q: ReportRangeQuery,
    @Res() res: Response,
  ) {
    sendCsv(res, await this.reports.salesCsv(q));
  }

  @Get("customers.csv")
  async customers(@Res() res: Response) {
    sendCsv(res, await this.reports.customersCsv());
  }

  @Get("campaigns/:id.csv")
  async campaign(@Param("id") id: string, @Res() res: Response) {
    sendCsv(res, await this.reports.campaignCsv(id));
  }
}
