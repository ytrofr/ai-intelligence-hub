import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageShell } from "@/components/app/PageShell";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { ScoreBar, DimBar } from "@/components/app/ScoreBar";
import { SourceBadge, BRANDED_SOURCES } from "@/components/app/SourceBadge";
import { Async } from "@/components/app/Loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";
import {
  measure, missing, swatch, verdict, PAIRS, REQUESTED_UI, ROLE_GROUPS,
  type Measured, type RoleReader, type Swatch,
} from "./palette";

/**
 * The design system, looked at rather than described.
 *
 * WHAT THIS PAGE IS: every colour role as the browser resolves it in the theme
 * you are currently in, every ink/surface pair with its measured contrast, and
 * every shared component in the states it actually ships in. Flip the theme in
 * the rail and every number here re-measures.
 *
 * WHAT IT IS NOT: visual regression, and not a picture of the pages. It renders
 * primitives in isolation, so it can show that a chip is readable and cannot
 * show that a page laid one out badly. That is still the eyeball's job.
 *
 * The honesty that makes it worth having: nothing on it is typed twice. The
 * colours are read from the live document, the source badges come from the same
 * BRAND map the app uses, and the missing-primitive list is the filesystem
 * differenced against the plan - so this page goes wrong when the app does,
 * which is the only condition under which a gallery is evidence of anything.
 */

/** Present on disk, at build time. The derived half of the gap list. */
const PRESENT_UI = Object.keys(import.meta.glob("../../components/ui/*.tsx"))
  .map((p) => p.split("/").pop()!.replace(/\.tsx$/, ""))
  .sort();

/**
 * Re-reads every role whenever the theme class on <html> changes.
 *
 * A useState snapshot taken once would show the dark values forever after a
 * switch to light - the swatches would keep painting themselves correctly from
 * CSS while the NUMBERS beside them described the other theme. Two channels
 * disagreeing silently is exactly the class of bug this page exists to catch,
 * so it must not have one of its own.
 */
function useResolvedRoles(): { read: RoleReader; generation: number } {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setGeneration((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const read = useCallback<RoleReader>(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generation IS the input
    [generation],
  );

  return { read, generation };
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mb-4 mt-1 max-w-2xl text-sm text-muted-foreground">{note}</p>
      {children}
    </section>
  );
}

function SwatchCard({ s }: { s: Swatch }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      {s.hex ? (
        <div
          className="mb-2 h-12 w-full rounded border"
          style={{ background: s.hex }}
          aria-hidden
        />
      ) : (
        // Not a grey square standing in for a colour: a square would read as a
        // resolved token that happens to be grey.
        <div className="mb-2 flex h-12 w-full items-center justify-center rounded border border-dashed text-xs text-dim">
          not resolved
        </div>
      )}
      <div className="font-mono text-xs">--{s.role}</div>
      <div className="mt-0.5 font-mono text-xs text-dim">{s.hex ?? "—"}</div>
    </div>
  );
}

function PairRow({ m }: { m: Measured }) {
  const v = verdict(m.ratio);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2.5 last:border-0">
      <span
        className="inline-flex shrink-0 items-center rounded border px-2 py-1 font-mono text-xs"
        style={
          m.ink.hex && m.surface.hex
            ? { background: m.surface.hex, color: m.ink.hex }
            : undefined
        }
      >
        {/* Real text in the real pair, so the number has something to be about. */}
        Aa 4.5
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-mono text-xs">--{m.ink.role}</span>
        <span className="text-dim"> on </span>
        <span className="font-mono text-xs">--{m.surface.role}</span>
        <span className="block text-xs text-muted-foreground">{m.where}</span>
      </span>
      <span className="shrink-0 font-mono text-xs tabular-nums">
        {m.ratio === null ? <NoValue title="one side did not resolve">—</NoValue> : `${m.ratio.toFixed(2)}:1`}
      </span>
      <StateChip level={v.band} word={v.word} className="shrink-0" />
    </div>
  );
}

export function DesignPage() {
  const { read, generation } = useResolvedRoles();
  const gaps = missing(REQUESTED_UI, PRESENT_UI);

  return (
    <PageShell
      title="Design system"
      blurb="Every token as the browser resolves it, every pair measured, every shared component in the states it ships in."
      width="page"
    >
      <Alert className="mb-10">
        <AlertTitle>What this page can and cannot tell you</AlertTitle>
        <AlertDescription>
          It reads the live document, so the numbers below describe the theme you are in right now -
          switch it in the rail and they re-measure. It shows primitives in isolation, which means it
          can prove a chip is readable and cannot prove a page laid one out well. Nothing here is a
          copy: the colours come from the stylesheet, the badges from the same list the app uses, and
          the gap list from the filesystem.
        </AlertDescription>
      </Alert>

      {ROLE_GROUPS.map((g) => (
        <Section key={g.title} title={g.title} note={g.note}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.roles.map((role) => (
              <SwatchCard key={`${role}-${generation}`} s={swatch(read, role)} />
            ))}
          </div>
        </Section>
      ))}

      <Section
        title="Contrast, measured"
        note="Every pair the app actually paints, against WCAG 4.5:1. A pair that cannot be read reports 'not measured' rather than passing quietly."
      >
        <div className="rounded-lg border bg-card px-4">
          {PAIRS.map((p) => (
            <PairRow key={`${p.ink}-${p.on}-${generation}`} m={measure(read, p)} />
          ))}
        </div>
      </Section>

      <Section
        title="Verdicts"
        note="The favourability ramp - deliberately not the red/green pair, and never travelling alone. Every chip carries a shape and a word, so removing colour entirely leaves the state readable."
      >
        <div className="flex flex-wrap items-center gap-2">
          <StateChip level="good" word="adopted" />
          <StateChip level="mid" word="trial" />
          <StateChip level="poor" word="rejected" />
          <StateChip level="none" word="unscored" />
          <StateChip level="poor" word="never run" glyph="◷" />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6 rounded-lg border bg-card p-4">
          <ScoreBar total={86} />
          <ScoreBar total={71} />
          <ScoreBar total={42} />
          <ScoreBar total={null} />
          <span className="flex items-center gap-3">
            <DimBar value={5} better={1} />
            <DimBar value={3} better={1} />
            <DimBar value={1} better={1} />
            <DimBar value={null} better={1} />
          </span>
        </div>
      </Section>

      <Section
        title="Sources"
        note="Eleven third parties' own marks. The ink is derived per theme rather than chosen, so the twelfth source someone adds cannot ship unreadable - and one we have no colour for renders muted instead of vanishing."
      >
        <div className="flex flex-wrap gap-2">
          {BRANDED_SOURCES.map((s) => (
            <SourceBadge key={s} source={s} />
          ))}
          <SourceBadge source="a-source-we-have-no-colour-for" />
        </div>
      </Section>

      <Section
        title="Absence"
        note="An absence is a row, never a missing row. `reason` is required, because 'no data' only repeats the observation."
      >
        <div className="space-y-3">
          <AbsenceRow
            what="No candidates."
            reason="Nothing has been proposed for this slot yet."
          />
          <AbsenceRow
            tone="loud"
            what="Never run."
            reason="This instrument has no recorded run at all - which is a different finding from a run that came back empty."
          />
        </div>
      </Section>

      <Section
        title="The three states of a fetch"
        note="Loading, failed and ready render differently on purpose. A component that returns null for two of them tells you the same thing twice, and that thing is false once."
      >
        <div className="space-y-6">
          <Async query={{ state: "loading" }} what="the ledger">{() => null}</Async>
          <Async
            query={{ state: "error", error: new ApiError(500, "/api/ledger", "the database is locked") }}
            what="the ledger"
          >
            {() => null}
          </Async>
          <Async query={{ state: "ready", data: "it arrived" }} what="the ledger">
            {(d) => <div className="rounded-lg border bg-card px-4 py-3 text-sm">{d}</div>}
          </Async>
        </div>
      </Section>

      <Section
        title="Controls"
        note="Upstream shadcn, unmodified, painted by our tokens. Two of these are the first place in the app that paints their pair - no route uses a default or a destructive button, every one of them is ghost or outline - and both come out under the contrast floor above. That is why the pixel probe never saw them: its population is the screen, and these were not on it."
      >
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="destructive">Destructive</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <span className="grid gap-1.5">
              <Label htmlFor="ds-demo-input">A labelled field</Label>
              <Input id="ds-demo-input" className="w-56" placeholder="type here" />
            </span>
            <span className="flex items-center gap-2">
              <Switch id="ds-demo-switch" />
              <Label htmlFor="ds-demo-switch">A switch</Label>
            </span>
          </div>
        </div>
      </Section>

      <Section
        title="What this system does not have"
        note="The plan asked for 23 primitives. This is the filesystem differenced against that list - so a primitive that gets deleted turns up here without anyone remembering to write it down."
      >
        {gaps.length === 0 ? (
          <AbsenceRow
            what="Nothing missing."
            reason={`All ${REQUESTED_UI.length} requested primitives are on disk.`}
          />
        ) : (
          <AbsenceRow
            what={`${gaps.length} of ${REQUESTED_UI.length} never landed: ${gaps.join(", ")}.`}
            reason="Nothing in ten routes has needed them yet. They are absent by omission, not by decision - which is worth knowing before someone builds one by hand."
          />
        )}
      </Section>
    </PageShell>
  );
}
