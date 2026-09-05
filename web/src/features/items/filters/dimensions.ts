/**
 * The filter dimensions, declared ONCE.
 *
 * Every variant below renders these same dimensions - that is the constant the
 * round holds fixed, so what is being compared is the LAYOUT, not the feature
 * set. The one exception is variant D, which deliberately carries all twelve of
 * the old page's dimensions: a round whose every cell shares an unchecked
 * constant cannot contain a good answer, and "five is the right number" is
 * exactly the kind of constant that needs an arm arguing against it.
 *
 * Bands are computed from the real distribution, not invented. Score runs
 * 5.5 to 828,450 with a mean of 2,058, so a raw "minimum score" box asks the
 * reader to know what 2,058 means. Measured on hub.db 2026-09-05, 9,315 items.
 */

export interface Band { label: string; value: string; hint?: string }

/** score >= N, from the real percentiles. Counts are the live population. */
export const POPULARITY: Band[] = [
  { label: "any", value: "" },
  { label: "top half", value: "50", hint: "6,580" },
  { label: "top quarter", value: "100", hint: "2,829" },
  { label: "top 10%", value: "200", hint: "1,087" },
];

/** GitHub-derived rows only; everything else has no star count at all. */
export const STARS: Band[] = [
  { label: "any", value: "" },
  { label: "500+", value: "500", hint: "1,380" },
  { label: "5k+", value: "5000" },
  { label: "50k+", value: "50000" },
];

export const ADDED: Band[] = [
  { label: "any", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
];

export const SORTS = [
  { label: "Newest", sortBy: "date", sortOrder: "DESC" },
  { label: "Oldest", sortBy: "date", sortOrder: "ASC" },
  { label: "Highest score", sortBy: "score", sortOrder: "DESC" },
] as const;

export function daysAgoIso(days: string): string | undefined {
  if (!days) return undefined;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Number(days));
  return d.toISOString().slice(0, 10);
}
