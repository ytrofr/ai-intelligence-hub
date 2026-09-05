import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Band } from "./dimensions";

/**
 * The pieces every variant is built from - all shadcn primitives, so the four
 * arms differ in ARRANGEMENT only. A variant that also changed the controls
 * would be testing two things at once.
 */

/** A segmented control. The selected cell carries WEIGHT and a border, never
 *  colour alone - the reader of this app cannot rely on red/green. */
export function BandGroup({
  label, bands, value, onChange,
}: { label: string; bands: Band[]; value: string; onChange: (v: string) => void }) {
  return (
    // The four cells plus their count hints measure 461px - wider than a phone.
    // The label wraps away from the group, and the hints (a nicety, not the
    // control) drop below sm, rather than the page scrolling sideways.
    <div className="flex flex-wrap items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap rounded-md border">
        {bands.map((b) => {
          const on = b.value === value;
          return (
            <Button
              key={b.value || "any"}
              variant="ghost"
              size="sm"
              aria-pressed={on}
              onClick={() => onChange(b.value)}
              className={on ? "h-7 rounded-none bg-accent font-semibold" : "h-7 rounded-none font-normal text-muted-foreground"}
            >
              {b.label}
              {b.hint && <span className="ml-1 hidden font-mono text-[10px] text-dim sm:inline">{b.hint}</span>}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Stacked form of the same control, for the left-panel variant. */
export function BandStack({
  label, bands, value, onChange,
}: { label: string; bands: Band[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="flex flex-col">
        {bands.map((b) => {
          const on = b.value === value;
          return (
            <button
              key={b.value || "any"}
              aria-pressed={on}
              onClick={() => onChange(b.value)}
              className={`flex items-center justify-between rounded px-2 py-1 text-left text-xs ${
                on ? "bg-accent font-semibold" : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <span>{on ? "● " : "○ "}{b.label}</span>
              {b.hint && <span className="font-mono text-[10px] text-dim">{b.hint}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 24 sources is too many for a chip row, so they live behind one trigger that
 * states how many are selected. The count on the trigger is the whole point:
 * a closed picker that says only "Sources" hides whether it is narrowing.
 */
export function SourcePicker({
  sources, selected, onToggle, onClear, full,
}: { sources: { id: string; count: number }[]; selected: string[]; onToggle: (id: string) => void; onClear: () => void; full?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={full ? "h-8 w-full justify-between" : "h-8"}>
          Sources
          <span className="ml-1.5 font-mono text-[11px] text-dim">
            {selected.length ? `${selected.length} of ${sources.length}` : sources.length}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Sources</span>
          {selected.length > 0 && (
            <button onClick={onClear} className="text-[11px] font-normal text-primary hover:underline">clear</button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="h-72">
          {sources.map((s) => (
            <DropdownMenuCheckboxItem
              key={s.id}
              checked={selected.includes(s.id)}
              onCheckedChange={() => onToggle(s.id)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex-1 truncate">{s.id}</span>
              <span className="ml-2 font-mono text-[10px] text-dim">{s.count}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NumberPair({
  label, min, max, onMin, onMax,
}: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input value={min} onChange={(e) => onMin(e.target.value)} placeholder="min"
             className="h-7 w-20 font-mono text-xs" aria-label={`${label} minimum`} />
      <span className="text-xs text-dim">to</span>
      <Input value={max} onChange={(e) => onMax(e.target.value)} placeholder="max"
             className="h-7 w-20 font-mono text-xs" aria-label={`${label} maximum`} />
    </div>
  );
}
