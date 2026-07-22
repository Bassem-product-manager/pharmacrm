/**
 * Quiet-hours math in Africa/Cairo (R2). No tz library — Intl only, same
 * approach as sales.service cairoDayRange (Egypt observes DST since 2023).
 */
const HOUR_MS = 60 * 60 * 1000;

export function cairoHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      hour12: false,
      hour: "2-digit",
    }).format(at),
  ) % 24;
}

export function isWithinQuietWindow(at: Date, quietStart: number, quietEnd: number): boolean {
  const h = cairoHour(at);
  return quietStart < quietEnd
    ? h >= quietStart && h < quietEnd
    : h >= quietStart || h < quietEnd; // window crossing midnight
}

/**
 * ms to delay so the job lands just after the window opens (quietStart:00
 * Cairo). Walks hour-by-hour — max 24 iterations, DST-safe because each step
 * re-reads the Cairo hour.
 */
export function delayUntilWindowOpenMs(from: Date, quietStart: number, quietEnd: number): number {
  if (isWithinQuietWindow(from, quietStart, quietEnd)) return 0;
  // jump to the next top-of-hour, then walk until the window opens
  const nextHourTop = Math.ceil(from.getTime() / HOUR_MS) * HOUR_MS;
  for (let i = 0; i <= 30; i++) {
    const candidate = new Date(nextHourTop + i * HOUR_MS);
    if (isWithinQuietWindow(candidate, quietStart, quietEnd)) {
      return Math.max(1, candidate.getTime() - from.getTime()) + 60_000; // +1min margin
    }
  }
  return 12 * HOUR_MS; // defensive fallback — should be unreachable
}
