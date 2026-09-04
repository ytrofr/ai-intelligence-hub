import { Link } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { StateChip } from "@/components/app/StateChip";
import { ScoreBar } from "@/components/app/ScoreBar";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import type { HubPayload, HubSlot } from "../types";

/**
 * One project's needs: slot by slot, what we have for it.
 *
 * The ordering is the argument. A slot nobody proposed anything for sorts
 * FIRST and renders loudest, because it is the only state no other page in this
 * app can show - every other surface is keyed on the candidate, and a need with
 * no candidate has no row on any of them.
 */
export function NeedsPage() {
  const project = useProject();
  const q = useApi<HubPayload>(project ? `/projects-hub?project=${encodeURIComponent(project)}` : null);
  const d = destinationById("needs")!;

  return (
    <PageShell title="Needs" blurb={d.blurb} width="page">
      <Async query={q} what={`${project ?? "this project"}'s needs`}>
        {(hub) => {
          const p = hub.projects[0];
          if (!p) {
            return (
              <AbsenceRow tone="loud" what="No such project."
                reason={`Nothing in the config declares "${project}". The sidebar's switcher lists the ones that exist.`} />
            );
          }
          const order = { empty: 0, unscored: 1, scored: 2 } as const;
          const slots = [...p.slots].sort((a, b) => order[a.state] - order[b.state]);
          return (
            <div className="space-y-8">
              <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-lg border bg-card p-4">
                <Fig n={p.counts.slots} label="slots" />
                <Fig n={p.counts.slots_empty} label="needs unanswered" loud={p.counts.slots_empty > 0} />
                <Fig n={p.counts.candidates} label="candidates" />
                <Fig n={p.counts.best ?? "-"} label="top score" />
                <Fig n={p.counts.estimated} label="still estimated" />
                <Fig n={p.counts.slots_never_run} label="never run" loud={p.counts.slots_never_run > 0} />
              </div>

              {slots.length === 0 ? (
                <AbsenceRow tone="loud" what="This project declares no slots."
                  reason="Nothing has been written down as a need, so nothing here can be missing - which is itself the finding." />
              ) : (
                <div className="space-y-3">
                  {slots.map((s) => <SlotCard key={s.id} slot={s} project={p.id} />)}
                </div>
              )}

              {p.unslotted.length > 0 && (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold">
                    Candidates with no slot <span className="font-normal text-muted-foreground">{p.unslotted.length}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Scored, but not filed against any declared need - so they answer a question nobody wrote down.
                  </p>
                  <ul className="space-y-1">
                    {p.unslotted.map((r) => (
                      <li key={r.repo} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                        <span className="font-mono text-xs">{r.repo}</span>
                        <span className="ml-auto"><ScoreBar total={r.total} /></span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          );
        }}
      </Async>
    </PageShell>
  );
}

function Fig({ n, label, loud }: { n: number | string; label: string; loud?: boolean }) {
  return (
    <div>
      <div className={loud ? "font-mono text-lg tabular-nums text-warning" : "font-mono text-lg tabular-nums"}>
        {loud && <span aria-hidden className="mr-1">▲</span>}
        {n}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
    </div>
  );
}

function SlotCard({ slot, project }: { slot: HubSlot; project: string }) {
  const empty = slot.state === "empty";
  return (
    <div className={empty ? "rounded-lg border border-warning/40 bg-warning/5 p-4" : "rounded-lg border bg-card p-4"}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm">{slot.id}</div>
          {slot.needs && <p className="mt-1 text-sm text-muted-foreground">{slot.needs}</p>}
        </div>
        {slot.state === "empty" && <StateChip level="poor" word="nothing proposed" title="no candidate has ever been filed against this need" />}
        {slot.state === "unscored" && <StateChip level="mid" word="unscored" title="candidates exist but nobody has rated them" />}
        {slot.state === "scored" && <StateChip level="good" word={`best ${slot.best}`} title="the highest score filed against this need" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-dim">
        {/* `never run` is not age zero. A slot that has never run and one that
            ran today are opposite findings, so they never render alike. */}
        <span>{slot.runs === 0 ? "never run" : `${slot.runs} run${slot.runs === 1 ? "" : "s"}`}</span>
        <span>{slot.age_days === null ? "undated" : `last ran ${slot.age_days}d ago`}</span>
        <span>{slot.candidates.length} candidate{slot.candidates.length === 1 ? "" : "s"}</span>
        {slot.gap && <span className="text-warning">gap: {slot.gap}</span>}
      </div>
      {slot.scored.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-3">
          {slot.scored.slice(0, 5).map((r) => (
            <li key={r.repo} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{r.repo}</span>
              <ScoreBar total={r.total} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 border-t pt-3 text-xs">
        <Link to={`/p/${encodeURIComponent(project)}/matrix`} className="text-primary hover:underline">
          see this project's candidates ranked →
        </Link>
      </div>
    </div>
  );
}
