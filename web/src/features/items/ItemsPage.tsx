import { useMemo, useState } from "react";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { SourceBadge } from "@/components/app/SourceBadge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { compact, timeAgo } from "@/lib/time";
import { LIMIT, useItemFilters } from "./filters/useItemFilters";
import { FilterBar } from "./filters/FilterBar";

interface Item {
  id: number;
  source: string;
  title: string;
  url: string;
  description: string | null;
  author: string | null;
  stars: number | null;
  published_at: string | null;
  bookmark_id: number | null;
}
interface ItemsPayload { items: Item[]; count: number; total: number }
interface Stats { totalItems: number; bySource: Record<string, number> }

/**
 * Everything the fetchers found.
 *
 * The view mode is the one piece of per-reader state this app keeps, and it
 * keeps it in localStorage exactly as the page it replaces did - so a reader's
 * choice survives the rebuild rather than being silently reset.
 */
const VIEW_KEY = "viewMode";

export function ItemsPage() {
  const filters = useItemFilters();
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
    } catch {
      // A browser with storage blocked is not a broken app; it just does not
      // remember. Falling through to the default is the whole handling.
      return "grid";
    }
  });

  const setMode = (m: "grid" | "list") => {
    setView(m);
    try {
      localStorage.setItem(VIEW_KEY, m);
    } catch { /* see above */ }
  };

  const items = useApi<ItemsPayload>(filters.path);
  // Per-source counts for the picker. They come from /stats, which already
  // computes them - a second count derived here could disagree with the one
  // the rest of the app shows.
  const stats = useApi<Stats>("/stats");
  const sources = useMemo(
    () =>
      stats.state === "ready"
        ? Object.entries(stats.data.bySource)
            .map(([id, count]) => ({ id, count }))
            .sort((a, b) => b.count - a.count)
        : [],
    [stats],
  );
  const d = destinationById("items")!;

  return (
    <PageShell
      title="Items"
      blurb={d.blurb}
      width="wide"
      actions={
        <div className="flex rounded-md border">
          {(["grid", "list"] as const).map((m) => (
            <Button
              key={m}
              variant="ghost"
              size="sm"
              aria-pressed={view === m}
              onClick={() => setMode(m)}
              className={view === m ? "h-7 bg-accent font-semibold" : "h-7"}
            >
              {m}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-4">
        <FilterBar {...filters} sources={sources} />
      </div>
      <Async query={items} what="the item feed">
        {(data) =>
          data.items.length === 0 ? (
            <AbsenceRow
              what={filters.active || filters.f.q ? "Nothing matches these filters." : "The feed is empty."}
              reason={
                filters.active || filters.f.q
                  ? `${filters.active} filter(s) active${filters.f.q ? ` and a search for "${filters.f.q}"` : ""} over ${stats.state === "ready" ? stats.data.totalItems.toLocaleString() : "the"} stored items. Widen one, or clear them all.`
                  : "No source has returned anything yet. Run a fetch, or check the failing-source count in the sidebar."
              }
              tone={filters.active || filters.f.q ? "neutral" : "loud"}
            />
          ) : (
            <div className="space-y-4">
              <div
                className={
                  view === "grid"
                    ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                    : "space-y-2"
                }
              >
                {data.items.map((it) => <ItemCard key={it.id} item={it} dense={view === "list"} />)}
              </div>
              {/* `total` from /api/items is the STORE count - it does not move
                  when filters narrow the feed. Calling it "matching" made a
                  true number read as a false claim, so the page says only what
                  it can actually know: a short page IS the whole match set; a
                  full page means there are more, and how many more is a
                  question this endpoint cannot answer. */}
              <p className="text-xs text-muted-foreground">
                {data.items.length < LIMIT
                  ? `${data.items.length} item${data.items.length === 1 ? "" : "s"} match`
                  : `First ${data.items.length} of more that match`}
                {filters.active > 0 ? ` · ${filters.active} filter(s) on` : ""}
                {` · ${data.total.toLocaleString()} stored`}
              </p>
            </div>
          )
        }
      </Async>
    </PageShell>
  );
}

function ItemCard({ item, dense }: { item: Item; dense: boolean }) {
  const when = timeAgo(item.published_at);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={item.source} />
        {item.stars !== null && (
          <span className="font-mono text-[11px] text-dim">★ {compact(item.stars)}</span>
        )}
        {/* Undated is its own word. "just now" for a row with no date would be
            a fabricated fact about when it appeared. */}
        <span className="ml-auto font-mono text-[11px] text-dim">{when ?? "undated"}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-medium">{item.title}</div>
      {!dense && item.description && (
        <p className="mt-1.5 line-clamp-3 text-xs text-muted-foreground">{item.description}</p>
      )}
    </a>
  );
}
