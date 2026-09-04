/**
 * Favourability - ported verbatim in behaviour from the page that owned it,
 * with its reasoning intact.
 *
 * A dimension's raw value is 1-5. Some dimensions are better LOW (cost, effort)
 * and some better HIGH, so `better` is -1 or +1 and the favourability is the
 * value read in the direction that actually helps. A page that coloured the raw
 * value would paint "cheap" and "expensive" the same.
 */
export function favour(value: unknown, better: number): number | null {
  if (!Number.isInteger(value)) return null;
  return better < 0 ? 6 - (value as number) : (value as number);
}

/** The three levels the ramp actually has. */
export type Band = "good" | "mid" | "poor" | "none";

/**
 * Three bands, not five.
 *
 * A five-step hue ramp is unreadable, and the exact value is already carried by
 * the bar length and by the digit printed beside it - so hue is the third
 * channel here, never the only one.
 */
export function band(fav: number | null): Band {
  if (fav === null) return "none";
  if (fav >= 4) return "good";
  if (fav === 3) return "mid";
  return "poor";
}

/**
 * Score bands are ABSOLUTE, not a ranking.
 *
 * 80 means "strong on every axis at once". A table whose top row is always
 * green would say nothing about whether the top row is any good. The thresholds
 * are printed in the page footer so a reader can check them rather than infer
 * them.
 */
export function scoreBand(total: unknown): Band {
  if (typeof total !== "number") return "none";
  if (total >= 80) return "good";
  if (total >= 65) return "mid";
  return "poor";
}
