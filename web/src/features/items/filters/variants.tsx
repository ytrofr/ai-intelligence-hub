import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BandGroup, BandStack, NumberPair, SourcePicker } from "./parts";
import { ADDED, POPULARITY, SORTS, STARS } from "./dimensions";
import type { FilterState } from "./useItemFilters";

export interface VariantProps {
  f: FilterState;
  set: <K extends keyof FilterState>(k: K, v: FilterState[K]) => void;
  toggleSource: (id: string) => void;
  reset: () => void;
  active: number;
  sources: { id: string; count: number }[];
}

function SearchBox({ f, set, width }: VariantProps & { width: string }) {
  return (
    <Input
      value={f.q}
      onChange={(e) => set("q", e.target.value)}
      placeholder="search titles and descriptions"
      className={`h-8 ${width}`}
      aria-label="Search items"
    />
  );
}

function SortSelect({ f, set }: VariantProps) {
  const current = SORTS.find((s) => s.sortBy === f.sortBy && s.sortOrder === f.sortOrder) ?? SORTS[0];
  return (
    <Select
      value={current.label}
      onValueChange={(label) => {
        const s = SORTS.find((x) => x.label === label)!;
        set("sortBy", s.sortBy);
        set("sortOrder", s.sortOrder);
      }}
    >
      <SelectTrigger className="h-8 w-36" aria-label="Sort order"><SelectValue /></SelectTrigger>
      <SelectContent>
        {SORTS.map((s) => <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function ClearButton({ active, reset }: VariantProps) {
  if (active === 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={reset} className="h-8 text-muted-foreground">
      clear {active}
    </Button>
  );
}

/* ── A ─────────────────────────────────────────────────────────────────────
   Everything visible, one row, no disclosure. Nothing is hidden, so nothing
   can be forgotten - and the cost is a busy row that wraps on a laptop.       */
export function VariantA(p: VariantProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2">
      <SearchBox {...p} width="w-56" />
      <SourcePicker sources={p.sources} selected={p.f.sources} onToggle={p.toggleSource}
                    onClear={() => p.set("sources", [])} />
      <BandGroup label="popularity" bands={POPULARITY} value={p.f.scoreMin} onChange={(v) => p.set("scoreMin", v)} />
      <BandGroup label="stars" bands={STARS} value={p.f.starsMin} onChange={(v) => p.set("starsMin", v)} />
      <BandGroup label="added" bands={ADDED} value={p.f.addedDays} onChange={(v) => p.set("addedDays", v)} />
      <div className="ml-auto flex items-center gap-2">
        <SortSelect {...p} />
        <ClearButton {...p} />
      </div>
    </div>
  );
}

/* ── B ─────────────────────────────────────────────────────────────────────
   Four in the row, the rest behind a disclosure whose label counts the ACTIVE
   ones. Calm by default; one click away from the rest.                        */
export function VariantB(p: VariantProps) {
  const [open, setOpen] = useState(false);
  const hidden = (p.f.scoreMin ? 1 : 0) + (p.f.starsMin ? 1 : 0) + (p.f.addedDays ? 1 : 0);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <SearchBox {...p} width="w-72" />
        <SourcePicker sources={p.sources} selected={p.f.sources} onToggle={p.toggleSource}
                      onClear={() => p.set("sources", [])} />
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">
            {open ? "▾" : "▸"} More filters
            {hidden > 0 && <span className="ml-1.5 font-mono text-[11px] text-dim">{hidden} on</span>}
          </Button>
        </CollapsibleTrigger>
        <div className="ml-auto flex items-center gap-2">
          <SortSelect {...p} />
          <ClearButton {...p} />
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

/* ── C ─────────────────────────────────────────────────────────────────────
   A left column, always open, dense one-line rows - the shape the operator has
   already picked for admin lists on another project. Costs ~200px of width.   */
export function VariantCPanel(p: VariantProps) {
  return (
    // Hidden below md. A fixed 208px column beside the feed forces the page to
    // scroll sideways on a phone, which is a disqualification rather than a
    // trade-off - so on small screens the same controls come through the sheet
    // below, exactly as the app sidebar already does.
    <aside className="hidden w-52 shrink-0 space-y-4 rounded-lg border bg-card p-3 md:block">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Filters</span>
        {p.active > 0 && (
          <button onClick={p.reset} className="text-[11px] text-primary hover:underline">clear {p.active}</button>
        )}
      </div>
      <BandStack label="popularity" bands={POPULARITY} value={p.f.scoreMin} onChange={(v) => p.set("scoreMin", v)} />
      <BandStack label="stars" bands={STARS} value={p.f.starsMin} onChange={(v) => p.set("starsMin", v)} />
      <BandStack label="added" bands={ADDED} value={p.f.addedDays} onChange={(v) => p.set("addedDays", v)} />
      <div className="space-y-1">
        {/* block, not inline: shadcn's Label is inline-flex, so beside an
            inline-flex trigger it sat ON the button and spilled past the
            208px panel. */}
        <Label className="block text-[11px] uppercase tracking-wide text-muted-foreground">sources</Label>
        <SourcePicker sources={p.sources} selected={p.f.sources} onToggle={p.toggleSource}
                      onClear={() => p.set("sources", [])} full />
      </div>
    </aside>
  );
}

export function VariantCBar(p: VariantProps) {
  return (
    // flex-wrap, or the ml-auto sort select is pushed 47px past the right edge
    // at 390 and the page scrolls sideways. Measured, not guessed.
    <div className="flex flex-wrap items-center gap-3">
      <SearchBox {...p} width="w-48 sm:w-72" />
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 md:hidden">
            Filters{p.active > 0 && <span className="ml-1.5 font-mono text-[11px] text-dim">{p.active} on</span>}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72">
          <SheetHeader><SheetTitle>Filters</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-4">
            <BandStack label="popularity" bands={POPULARITY} value={p.f.scoreMin} onChange={(v) => p.set("scoreMin", v)} />
            <BandStack label="stars" bands={STARS} value={p.f.starsMin} onChange={(v) => p.set("starsMin", v)} />
            <BandStack label="added" bands={ADDED} value={p.f.addedDays} onChange={(v) => p.set("addedDays", v)} />
            <SourcePicker sources={p.sources} selected={p.f.sources} onToggle={p.toggleSource}
                          onClear={() => p.set("sources", [])} />
          </div>
        </SheetContent>
      </Sheet>
      <div className="ml-auto"><SortSelect {...p} /></div>
    </div>
  );
}

/* ── D ─────────────────────────────────────────────────────────────────────
   The control arm: all TWELVE dimensions the old page had, ported faithfully
   into our primitives. It exists so the round can disagree with "five is the
   right number" - a set of variants that all share an unexamined constant
   tests everything except the thing that might be wrong.                      */
export function VariantD(p: VariantProps) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <SearchBox {...p} width="w-64" />
        <SourcePicker sources={p.sources} selected={p.f.sources} onToggle={p.toggleSource}
                      onClear={() => p.set("sources", [])} />
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8">{open ? "▾" : "▸"} Advanced filters</Button>
        </CollapsibleTrigger>
        <div className="ml-auto flex items-center gap-2">
          <SortSelect {...p} />
          <ClearButton {...p} />
        </div>
      </div>
      <CollapsibleContent>
        <Separator />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-3 py-3">
          <NumberPair label="score" min={p.f.scoreMin} max={p.f.scoreMax}
                      onMin={(v) => p.set("scoreMin", v)} onMax={(v) => p.set("scoreMax", v)} />
          <NumberPair label="stars" min={p.f.starsMin} max={p.f.starsMax}
                      onMin={(v) => p.set("starsMin", v)} onMax={(v) => p.set("starsMax", v)} />
          {/* Two 144px date inputs plus their labels do not fit 320px. This is
              the cost of carrying twelve dimensions: A and B needed no wrap
              rules to survive a small phone, D needed three. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">added</span>
            <Input type="date" value={p.f.dateFrom} onChange={(e) => p.set("dateFrom", e.target.value)}
                   className="h-7 w-36 font-mono text-xs" aria-label="Added from" />
            <span className="text-xs text-dim">to</span>
            <Input type="date" value={p.f.dateTo} onChange={(e) => p.set("dateTo", e.target.value)}
                   className="h-7 w-36 font-mono text-xs" aria-label="Added to" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="bm" checked={p.f.bookmarksOnly}
                    onCheckedChange={(v) => p.set("bookmarksOnly", v)} />
            {/* Says what it would do AND that it would do nothing today. An
                empty control with no explanation teaches you to distrust the
                whole bar. */}
            <Label htmlFor="bm" className="text-xs text-muted-foreground">
              bookmarked only <span className="font-mono text-[10px] text-dim">0 saved</span>
            </Label>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
