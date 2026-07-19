// Compact relative timestamps ("3d ago") for cards and comment threads.
// Isomorphic — no Node built-ins (used by client components).

const UNITS: { limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60, divisor: 1, unit: "second" },
  { limit: 3_600, divisor: 60, unit: "minute" },
  { limit: 86_400, divisor: 3_600, unit: "hour" },
  { limit: 2_592_000, divisor: 86_400, unit: "day" },
  { limit: 31_536_000, divisor: 2_592_000, unit: "month" },
  { limit: Number.POSITIVE_INFINITY, divisor: 31_536_000, unit: "year" },
];

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "narrow" });

export function relativeTime(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 45) return "just now";
  for (const { limit, divisor, unit } of UNITS) {
    if (seconds < limit) return formatter.format(-Math.round(seconds / divisor), unit);
  }
  return "";
}
