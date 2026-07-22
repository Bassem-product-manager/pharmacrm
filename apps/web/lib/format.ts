const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** "15" → "١٥" — toasts and balances render Arabic-Indic digits (docs/02 §3). */
export const arDigits = (v: number | string): string =>
  String(v).replace(/\d/g, (d) => AR_DIGITS[Number(d)]!);

export const egp = (n: number): string => `${arDigits(n)} ج.م`;

/** Cairo calendar day "YYYY-MM-DD" — matches the API's GET /sales?date= semantics. */
export const cairoToday = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

export const cairoTime = (iso: string): string =>
  new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
