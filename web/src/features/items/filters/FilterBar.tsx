import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BandGroup, SourcePicker } from "./parts";
import { ADDED, POPULARITY, SORTS, STARS } from "./dimensions";
import type { FilterState } from "./useItemFilters";

/**
 * The feed's filter bar. Arm B of the 2026-09-05 round, picked by the operator.
 *
 * Four controls in the row, three behind a disclosure. The other three arms
 * (inline row, left panel, all-twelve) were deleted in the same commit rather
 * than left beside this one - two arrangements alive at once is how a fix stops
 * sticking, and the round is in git if it needs re-reading.
 *
 * The drawer's label counts ACTIVE filters, never available ones. "More filters
 * (3)" where 3 is how many controls exist tells the reader nothing; the number
 * they need is how much of the feed they are currently not seeing.
 *
 * Four dimensions of the old page's twelve are deliberately absent - scoreMax,
 * starsMax, dateTo and a separate sort-order toggle. An upper bound on quality
 * has no use case, and the sort order folds into the sort select. The state and
 * the query builder still carry them, so re-adding one is a render change only.
 */
export interface FilterBarProps {
  f: FilterState;
  set: <K extends keyof FilterState>(k: K, v: FilterState[K]) => void;
  toggleSource: (id: string) => void;
  reset: () => void;
  active: number;
  sources: { id: string; count: number }[];
}

export function FilterBar(p: FilterBarProps) {
  // Opens itself when arriving on a link that already carries a drawer filter -
  // otherwise a pasted URL narrows the feed with the reason folded out of sight.
  const drawerOn = (p.f.scoreMin ? 1 : 0) + (p.f.starsMin ? 1 : 0) + (p.f.addedDays ? 1 : 0);
  const [open, setOpen] = useState(drawerOn > 0);
  const current = SORTS.find((s) => s.sortBy === p.f.sortBy && s.sortOrder === p.f.sortOrder) ?? SORTS[0];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <Input
          value={p.f.q}
          onChange={(e) => p.set("q", e.target.value)}
          placeholder="search titles and descriptions"
          className="h-8 w-48 sm:w-72"
          aria-label="Search items"
        />
        <SourcePicker
          sources={p.sources}
          selected={p.f.sources}
          onToggle={p.toggleSource}
          onClear={() => p.set("sources", [])}
        />
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            {open ? "▾" : "▸"} More filters
            {drawerOn > 0 && <span className="ml-1.5 font-mono text-[11px] text-dim">{drawerOn} on</span>}
          </Button>
        </CollapsibleTrigger>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={current.label}
            onValueChange={(label) => {
              const s = SORTS.find((x) => x.label === label)!;
              p.set("sortBy", s.sortBy);
              p.set("sortOrder", s.sortOrder);
            }}
          >
            <SelectTrigger className="h-8 w-36" aria-label="Sort order"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {p.active > 0 && (
            <Button variant="ghost" size="sm" onClick={p.reset} className="h-8 text-muted-foreground">
              clear {p.active}
            </Button>
          )}
        </div>
      </div>
      <CollapsibleContent>
        <Separator />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-3 py-3">
          <BandGroup label="popularity" bands={POPULARITY} value={p.f.scoreMin} onChange={(v) => p.set("scoreMin", v)} />
          <BandGroup label="stars" bands={STARS} value={p.f.starsMin} onChange={(v) => p.set("starsMin", v)} />
          <BandGroup label="added" bands={ADDED} value={p.f.addedDays} onChange={(v) => p.set("addedDays", v)} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
