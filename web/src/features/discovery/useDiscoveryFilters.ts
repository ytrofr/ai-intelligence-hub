import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Discovery's filters, in the URL - same contract as the feed's, so a filtered
 * view is a link on both pages and neither teaches a different habit.
 *
 * Three dimensions, and the reason each is here was measured rather than
 * chosen (2026-09-05, over a 200-row pool per project):
 *
 *   why     tech-stack 111 / unknown 41 / rising 35 / curated 13 on one project, and
 *           populated on all four projects. It is the only dimension that
 *           answers "why is this in front of me".
 *   stars   the feed's own bands, reused verbatim.
 *   source  4 distinct sources in a project-scoped pool.
 *
 * DELIBERATELY ABSENT: dependency overlap. It reads 3+ for all 200 rows on
 * two of the projects, so on half the projects it is a control that cannot
 * move. Also absent: "hide what we already ruled on" - modules/recommend.js
 * already DROPS rejected/done/accepted/trial/in-use rows before they arrive,
 * so the filter would have nothing to hide.
 */

export interface DiscoveryFilters {
  /** Which project to rank against. NOT the shell's project - the sidebar
   *  switcher navigates to /p/:id, a different section, and useProject() only
   *  reads that path. Discovery is a cross-project page, so it carries its own
   *  selection in its own URL param. Without it every row comes back
   *  strategy "unknown" and the `why` control has one dead value. */
  project: string;
  why: string;
  starsMin: string;
  sources: string[];
}

export const EMPTY: DiscoveryFilters = { project: "", why: "", starsMin: "", sources: [] };

/** The strategies modules/recommend.js actually stamps on a row. */
export const WHY_LABEL: Record<string, string> = {
  "tech-stack": "shares our stack",
  "rising-stars": "rising fast",
  "curated-lists": "on a curated list",
  unknown: "no reason recorded",
};

const OWNED = ["project", "why", "starsMin", "sources"] as const;

/** What is NARROWING the list. `project` is excluded on purpose: it changes
 *  which pool is ranked, it does not hide rows from one. */
export function activeCount(f: DiscoveryFilters): number {
  return (f.why ? 1 : 0) + (f.starsMin ? 1 : 0) + (f.sources.length ? 1 : 0);
}

export function useDiscoveryFilters() {
  const [sp, setSp] = useSearchParams();
  const f = useMemo<DiscoveryFilters>(
    () => ({
      project: sp.get("project") ?? "",
      why: sp.get("why") ?? "",
      starsMin: sp.get("starsMin") ?? "",
      sources: (sp.get("sources") ?? "").split(",").filter(Boolean),
    }),
    [sp],
  );

  const write = (next: DiscoveryFilters) => {
    const p = new URLSearchParams(sp);
    // Only our own keys. The page does not own the whole query string -
    // ?project= belongs to the shell and must survive a filter change.
    for (const k of OWNED) p.delete(k);
    if (next.project) p.set("project", next.project);
    if (next.why) p.set("why", next.why);
    if (next.starsMin) p.set("starsMin", next.starsMin);
    if (next.sources.length) p.set("sources", next.sources.join(","));
    setSp(p, { replace: true });
  };

  return {
    f,
    set: <K extends keyof DiscoveryFilters>(k: K, v: DiscoveryFilters[K]) => write({ ...f, [k]: v }),
    toggleSource: (id: string) =>
      write({ ...f, sources: f.sources.includes(id) ? f.sources.filter((s) => s !== id) : [...f.sources, id] }),
    // Clearing the FILTERS keeps the project - it is a lens, not a filter, and
    // resetting it would silently swap the pool under the reader.
    clear: () => write({ ...EMPTY, project: f.project }),
    active: activeCount(f),
  };
}

export interface Filterable {
  source: string;
  stars: number | null;
  relevance?: { strategy?: string };
}

/**
 * Applied CLIENT-side over the fetched pool, on purpose: the ranking is the
 * server's job and re-ranking per filter would change WHICH rows are the top
 * N, so a filter would silently alter the recommendation rather than narrow it.
 */
export function applyFilters<T extends Filterable>(rows: T[], f: DiscoveryFilters): T[] {
  const min = f.starsMin ? Number(f.starsMin) : null;
  return rows.filter((r) => {
    if (f.why && (r.relevance?.strategy ?? "unknown") !== f.why) return false;
    // A row with no star count is not a row with zero stars - a Hugging Face
    // model has no such number at all. It is excluded from a stars floor
    // rather than counted as 0, which would rank it as the least popular
    // thing we know of.
    if (min !== null && (r.stars ?? -1) < min) return false;
    if (f.sources.length && !f.sources.includes(r.source)) return false;
    return true;
  });
}

/** Counts for the band hints, over the UNFILTERED pool - a hint that moved
 *  with the selection would tell the reader what they already picked. */
export function countBy<T extends Filterable>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Star bands with counts taken from THIS pool.
 *
 *  The feed's STARS constant carries hints like "1,380" - the number of ITEMS
 *  above that floor, which is a different population entirely. Reusing it here
 *  put a feed count under a Discovery control, which is the exact class of
 *  defect the counts are meant to prevent: a number that is real, and about
 *  something else. */
export function starBands<T extends Filterable>(rows: T[]): { label: string; value: string; hint?: string }[] {
  const floors: [string, string][] = [["500+", "500"], ["5k+", "5000"], ["50k+", "50000"]];
  return [
    { label: "any", value: "" },
    ...floors.map(([label, value]) => {
      const n = rows.filter((r) => (r.stars ?? -1) >= Number(value)).length;
      return { label, value, hint: n ? n.toLocaleString() : undefined };
    }),
  ];
}
