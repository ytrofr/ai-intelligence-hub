import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
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

/** The page size. Exported so the page can tell "this is everything"
 *  from "this is the first page" without hardcoding the number twice. */
export const LIMIT = 60;

export function toQuery(f: FilterState, limit = LIMIT): string {
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

/** The URL params this hook owns. Anything else in the query string is left
 *  alone - the page does not own the whole URL, only its own filters. */
const OWNED = [
  "q", "sources", "scoreMin", "scoreMax", "starsMin", "starsMax",
  "addedDays", "dateFrom", "dateTo", "bookmarksOnly", "sortBy", "sortOrder",
] as const;

function fromParams(sp: URLSearchParams): FilterState {
  return {
    ...EMPTY,
    q: sp.get("q") ?? "",
    sources: (sp.get("sources") ?? "").split(",").filter(Boolean),
    scoreMin: sp.get("scoreMin") ?? "",
    scoreMax: sp.get("scoreMax") ?? "",
    starsMin: sp.get("starsMin") ?? "",
    starsMax: sp.get("starsMax") ?? "",
    addedDays: sp.get("addedDays") ?? "",
    dateFrom: sp.get("dateFrom") ?? "",
    dateTo: sp.get("dateTo") ?? "",
    bookmarksOnly: sp.get("bookmarksOnly") === "true",
    sortBy: sp.get("sortBy") ?? EMPTY.sortBy,
    sortOrder: sp.get("sortOrder") ?? EMPTY.sortOrder,
  };
}

function intoParams(f: FilterState, sp: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const k of OWNED) next.delete(k);
  if (f.q.trim()) next.set("q", f.q.trim());
  if (f.sources.length) next.set("sources", f.sources.join(","));
  if (f.scoreMin) next.set("scoreMin", f.scoreMin);
  if (f.scoreMax) next.set("scoreMax", f.scoreMax);
  if (f.starsMin) next.set("starsMin", f.starsMin);
  if (f.starsMax) next.set("starsMax", f.starsMax);
  if (f.addedDays) next.set("addedDays", f.addedDays);
  if (f.dateFrom) next.set("dateFrom", f.dateFrom);
  if (f.dateTo) next.set("dateTo", f.dateTo);
  if (f.bookmarksOnly) next.set("bookmarksOnly", "true");
  // Defaults are omitted, so a clean feed has a clean URL. A link carrying
  // ?sortBy=date&sortOrder=DESC reads as a filtered view when it is not one.
  if (f.sortBy !== EMPTY.sortBy) next.set("sortBy", f.sortBy);
  if (f.sortOrder !== EMPTY.sortOrder) next.set("sortOrder", f.sortOrder);
  return next;
}

/**
 * Filter state, in the URL.
 *
 * This is the one change that alters behaviour rather than appearance: a
 * filtered view becomes a link you can paste, the back button undoes a filter,
 * and a browser bookmark IS a saved search. `replace: true` keeps typing in the
 * search box from filling the history with one entry per keystroke - back
 * should leave the feed, not walk backwards through a word.
 */
export function useItemFilters() {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => fromParams(sp), [sp]);

  const write = (next: FilterState) => setSp(intoParams(next, sp), { replace: true });
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => write({ ...f, [k]: v });
  const toggleSource = (id: string) =>
    write({
      ...f,
      sources: f.sources.includes(id) ? f.sources.filter((s) => s !== id) : [...f.sources, id],
    });

  const path = useMemo(() => toQuery(f), [f]);
  return { f, set, setF: write, toggleSource, reset: () => write(EMPTY), path, active: activeCount(f) };
}
