/** Shared campaign UI types/labels (list + report pages). */
export interface CampaignRow {
  id: string;
  name: string;
  templateName: string;
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED";
  recipientCount: number | null;
  sentAt: string | null;
  createdAt: string;
  _count: { messages: number };
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignRow["status"], string> = {
  DRAFT: "مسودة",
  SCHEDULED: "مجدولة",
  SENDING: "قيد الإرسال",
  SENT: "أُرسلت",
  CANCELLED: "ملغاة",
};

export const CAMPAIGN_STATUS_STYLE: Record<CampaignRow["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SCHEDULED: "bg-sky-100 text-sky-700",
  SENDING: "bg-amber-100 text-amber-700",
  SENT: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-50 text-red-600",
};
