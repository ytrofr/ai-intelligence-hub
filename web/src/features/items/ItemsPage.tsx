import { useMemo, useState } from "react";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { SourceBadge } from "@/components/app/SourceBadge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { compact, timeAgo } from "@/lib/time";

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

/**
 * Everything the fetchers found.
 *
 * The view mode is the one piece of per-reader state this app keeps, and it
 * keeps it in localStorage exactly as the page it replaces did - so a reader's
 * choice survives the rebuild rather than being silently reset.
 */
const VIEW_KEY = "viewMode";

export function ItemsPage() {
  const [q, setQ] = useState("");
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

  const path = useMemo(() => {
    const p = new URLSearchParams({ limit: "60" });
    if (q.trim()) p.set("q", q.trim());
    return `/items?${p}`;
  }, [q]);

  const items = useApi<ItemsPayload>(path);
  const d = destinationById("items")!;

  return (
    <PageShell
      title="Items"
      blurb={d.blurb}
      width="wide"
      actions={
        <>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search titles and descriptions"
            className="h-8 w-72"
            aria-label="Search items"
          />
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
        </>
      }
    >
      <Async query={items} what="the item feed">
        {(data) =>
          data.items.length === 0 ? (
            <AbsenceRow
              what={q ? "Nothing matches that search." : "The feed is empty."}
              reason={
                q
                  ? `No stored item's title or description contains "${q}". The fetchers may simply not have seen it yet.`
                  : "No source has returned anything yet. Run a fetch, or check the failing-source count in the sidebar."
              }
              tone={q ? "neutral" : "loud"}
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
              <p className="text-xs text-muted-foreground">
                Showing {data.items.length} of {data.total} stored items.
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
