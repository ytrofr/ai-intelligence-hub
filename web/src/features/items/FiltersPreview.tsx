import { useMemo, useState } from "react";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { SourceBadge } from "@/components/app/SourceBadge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/useApi";
import { compact, timeAgo } from "@/lib/time";
import { useItemFilters } from "./filters/useItemFilters";
import { VariantA, VariantB, VariantCBar, VariantCPanel, VariantD, type VariantProps } from "./filters/variants";

/**
 * Four filter-bar arrangements, ONE at a time, on the live feed.
 *
 * One at a time is deliberate. Four side by side is a comparison exercise -
 * you read the differences instead of using the thing. Each arm here gets the
 * full page at full width with real results underneath, and the switcher is
 * labelled so the operator can name what they picked.
 *
 * What is held CONSTANT across the arms: the shell, the primitives, the query,
 * and the results. What VARIES: the arrangement - and, in D only, the number of
 * dimensions, so the round contains an arm that argues against "five".
 */

interface Item {
  id: number; source: string; title: string; url: string;
  description: string | null; stars: number | null; published_at: string | null;
}
interface ItemsPayload { items: Item[]; count: number; total: number }
interface Stats { totalItems: number; bySource: Record<string, number> }

const ARMS = [
  { key: "A", name: "Inline row", note: "everything visible, nothing hidden" },
  { key: "B", name: "Row + drawer", note: "four up front, the rest one click away" },
  { key: "C", name: "Left panel", note: "always-open column, dense rows" },
  { key: "D", name: "All twelve", note: "the old rig, ported faithfully" },
] as const;

export function FiltersPreview() {
  const [arm, setArm] = useState<(typeof ARMS)[number]["key"]>("A");
  const filters = useItemFilters();
  const stats = useApi<Stats>("/stats");
  const items = useApi<ItemsPayload>(filters.path);

  const sources = useMemo(() => {
    if (stats.state !== "ready") return [];
    return Object.entries(stats.data.bySource)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

  const p: VariantProps = { ...filters, sources };

  return (
    <PageShell
      title="Filter bar - four arrangements"
      blurb="One at a time, on the live feed. Pick by letter."
      width="wide"
    >
      <div className="space-y-4">
        {/* The switcher lives in the BODY, not PageShell's `actions` slot.
            That slot is `ml-auto` inside a header row that does not wrap, so a
            control this wide is pushed off-screen on a phone - not reachable,
            not clickable, and a round you cannot switch is not a round. The
            shell behaves that way for every page; changing it is a separate
            decision, so this file works within it rather than around it. */}
        <div className="flex flex-wrap gap-1 rounded-md border p-1">
          {ARMS.map((a) => (
            <Button
              key={a.key}
              variant="ghost"
              size="sm"
              aria-pressed={arm === a.key}
              onClick={() => setArm(a.key)}
              className={arm === a.key ? "h-7 bg-accent font-semibold" : "h-7 text-muted-foreground"}
            >
              {a.key} · {a.name}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{arm}</span> - {ARMS.find((a) => a.key === arm)!.name}
          {" · "}{ARMS.find((a) => a.key === arm)!.note}
        </p>

        {arm === "A" && <VariantA {...p} />}
        {arm === "B" && <VariantB {...p} />}
        {arm === "D" && <VariantD {...p} />}
        {arm === "C" && <VariantCBar {...p} />}

        <div className={arm === "C" ? "flex gap-4" : ""}>
          {arm === "C" && <VariantCPanel {...p} />}
          <div className="min-w-0 flex-1">
            <Async query={items} what="the filtered feed">
              {(data) =>
                data.items.length === 0 ? (
                  <AbsenceRow
                    what="Nothing matches these filters."
                    reason={`${filters.active} filter(s) active over ${stats.state === "ready" ? stats.data.totalItems.toLocaleString() : "the"} stored items. Widen one, or clear them all.`}
                  />
                ) : (
                  <div className="space-y-3">
                    {/* Count what is RENDERED, not what was fetched. The
                        preview shows 12 of the 60 it asks for, and a label
                        saying "60 shown" beside 12 cards is the page telling
                        the reader something they can see is false. */}
                    <p className="font-mono text-xs text-dim">
                      {Math.min(12, data.items.length)} shown · {data.total.toLocaleString()} match · {filters.active} filter(s) on
                    </p>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {data.items.slice(0, 12).map((it) => (
                        <a key={it.id} href={it.url} target="_blank" rel="noreferrer"
                           className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent">
                          <div className="flex flex-wrap items-center gap-2">
                            <SourceBadge source={it.source} />
                            {it.stars !== null && (
                              <span className="font-mono text-[11px] text-dim">★ {compact(it.stars)}</span>
                            )}
                            <span className="ml-auto font-mono text-[11px] text-dim">
                              {timeAgo(it.published_at) ?? "undated"}
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-2 text-sm font-medium">{it.title}</div>
                        </a>
                      ))}
                    </div>
                  </div>
                )
              }
            </Async>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
