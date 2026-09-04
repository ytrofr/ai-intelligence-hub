const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/**
 * How long ago, in words. Three states, never two.
 *
 * `null` for an absent or unparseable date, because "undated" and "just now"
 * are different findings and a page that renders them alike is lying about one
 * of them. A future date clamps to "just now" rather than going negative - a
 * negative age is not something a reader can interpret, and the date itself is
 * usually on the page anyway.
 */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = Math.max(0, now - t);
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h ago`;
  const days = Math.floor(d / DAY);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Days since an ISO date, or null. Same three states, same reasons. */
export function ageDays(iso: string | null | undefined, now = Date.now()): number | null {
  if (typeof iso !== "string" || !iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/** 12345 -> "12.3k". Keeps the magnitude readable without losing the order. */
export function compact(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "-";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
