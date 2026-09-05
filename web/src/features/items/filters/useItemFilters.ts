import { useMemo, useState } from "react";
import { daysAgoIso } from "./dimensions";

/**
 * Filter state, and the query it produces.
 *
 * Held in one object so every variant drives the SAME state and the SAME
 * request - the round compares layouts, and a variant quietly querying
 * differently would make the comparison meaningless.
 *
 * The old page kept this in a module-level `Filters.state`. Putting it in the
 * URL instead is the one change that alters behaviour rather than appearance:
 * a filtered view becomes a link, back works, and a browser bookmark IS a saved
 * search. (`saved_searches` holds 0 rows. That the modal was the only way to
 * save one is a plausible reason, not a measured one.)
 */
export interface FilterState {
  q: string;
  sources: string[];
  scoreMin: string;
  scoreMax: string;
  starsMin: string;
  starsMax: string;
  addedDays: string;
  dateFrom: string;
  dateTo: string;
  bookmarksOnly: boolean;
  sortBy: string;
  sortOrder: string;
}

export const EMPTY: FilterState = {
  q: "", sources: [], scoreMin: "", scoreMax: "", starsMin: "", starsMax: "",
  addedDays: "", dateFrom: "", dateTo: "", bookmarksOnly: false,
  sortBy: "date", sortOrder: "DESC",
};

/**
 * How many filters are ACTUALLY narrowing the feed.
 *
 * Counts active ones, never available ones. "More filters (7)" where 7 is the
 * number of controls in the drawer tells the reader nothing; the number they
 * need is how much of the feed they are currently not seeing.
 */
export function activeCount(f: FilterState): number {
  let n = 0;
  if (f.sources.length) n++;
  if (f.scoreMin) n++;
  if (f.scoreMax) n++;
  if (f.starsMin) n++;
  if (f.starsMax) n++;
  if (f.addedDays || f.dateFrom) n++;
  if (f.dateTo) n++;
  if (f.bookmarksOnly) n++;
  return n;
}

export function toQuery(f: FilterState, limit = 60): string {
  const p = new URLSearchParams({ limit: String(limit) });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sources.length) p.set("sources", f.sources.join(","));
  if (f.scoreMin) p.set("scoreMin", f.scoreMin);
  if (f.scoreMax) p.set("scoreMax", f.scoreMax);
  if (f.starsMin) p.set("starsMin", f.starsMin);
  if (f.starsMax) p.set("starsMax", f.starsMax);
  if (f.bookmarksOnly) p.set("bookmarksOnly", "true");
  const from = f.dateFrom || daysAgoIso(f.addedDays);
  if (from) p.set("dateFrom", from);
  if (f.dateTo) p.set("dateTo", f.dateTo);
  p.set("sortBy", f.sortBy);
  p.set("sortOrder", f.sortOrder);
  return `/items?${p}`;
}

export function useItemFilters() {
  const [f, setF] = useState<FilterState>(EMPTY);
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));
  const toggleSource = (id: string) =>
    setF((prev) => ({
      ...prev,
      sources: prev.sources.includes(id)
        ? prev.sources.filter((s) => s !== id)
        : [...prev.sources, id],
    }));
  const path = useMemo(() => toQuery(f), [f]);
  return { f, set, setF, toggleSource, reset: () => setF(EMPTY), path, active: activeCount(f) };
}
