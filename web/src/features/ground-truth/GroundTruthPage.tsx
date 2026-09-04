import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import { ageDays } from "@/lib/time";

interface GtSlot {
  id: string;
  instrument: string | null;
  needs: string | null;
  kind: string | null;
  gap: string | null;
  subject_declared: boolean;
  unvetted_caveat: string | null;
  runs: number;
  last_ran: { at?: string } | null;
  candidates: unknown[];
  counts: Record<string, number>;
}

interface GtPayload {
  projects: { id: string; name: string; slots: GtSlot[] }[];
  counts: {
    projects: number; slots: number; slots_with_a_run: number;
    slots_never_run: number; slots_recording_a_gap: number;
    candidates: number; candidates_vetted: number; candidates_unvetted: number;
    slots_without_a_subject: number;
  };
}

/**
 * Every instrument, and when it last actually said something.
 *
 * A row with NO run is the finding, not a gap in the table. An instrument that
 * has never been run is indistinguishable, from every other page in this app,
 * from one that runs daily and passes - which is exactly why this page exists
 * and why the never-run rows sort to the top.
 */
export function GroundTruthPage() {
  const project = useProject();
  const q = useApi<GtPayload>(
    project ? `/ground-truth?project=${encodeURIComponent(project)}` : "/ground-truth",
  );
  const d = destinationById("ground-truth")!;

  return (
    <PageShell title="Ground Truth" blurb={d.blurb} width="wide">
      <Async query={q} what="ground truth">
        {(gt) => {
          const rows = gt.projects
            .flatMap((p) => p.slots.map((s) => ({ ...s, project: p.id })))
            // Never-run first: it is the state no other surface can show.
            .sort((a, b) => a.runs - b.runs || a.id.localeCompare(b.id));
          return (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
                <Fig n={gt.counts.slots} label="instruments" />
                <Fig n={gt.counts.slots_never_run} label="never run" loud={gt.counts.slots_never_run > 0} />
                <Fig n={gt.counts.slots_recording_a_gap} label="recording a gap" />
                <Fig n={gt.counts.candidates} label="candidates" />
                <Fig n={gt.counts.candidates_unvetted} label="unvetted" loud={gt.counts.candidates_unvetted > 0} />
              </div>

              <DataTable
                columns={[
                  { key: "slot", header: "Instrument", width: "18rem",
                    cell: (s) => (
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{s.project}/{s.id}</div>
                        {s.instrument && <div className="mt-0.5 truncate text-[11px] text-dim">{s.instrument}</div>}
                      </div>
                    ) },
                  { key: "runs", header: "Runs", numeric: true, width: "7rem",
                    cell: (s) =>
                      // Never run is a WORD, never a zero. Zero reads as a
                      // measurement; "never run" reads as the absence it is.
                      s.runs === 0
                        ? <StateChip level="poor" word="never run" title="this instrument has produced no evidence at all" />
                        : <span className="font-mono tabular-nums">{s.runs}</span> },
                  { key: "last", header: "Last said something", width: "12rem",
                    cell: (s) => {
                      const at = s.last_ran?.at ?? null;
                      const age = ageDays(at);
                      if (age === null) return <NoValue title="no dated run on file">undated</NoValue>;
                      return <span className="text-xs">{age}d ago</span>;
                    } },
                  { key: "subject", header: "Subject", width: "10rem", secondary: true,
                    cell: (s) => s.subject_declared
                      ? <StateChip level="good" word="declared" title="the slot says what shape of data can grade it" />
                      : <StateChip level="mid" word="undeclared" title="nothing says what could grade this, so any corpus matches" /> },
                  { key: "needs", header: "What it needs", cell: (s) =>
                      s.needs ? <span className="text-xs">{s.needs}</span> : <NoValue /> },
                  { key: "gap", header: "Gap", secondary: true, cell: (s) =>
                      s.gap ? <span className="text-xs text-warning">{s.gap}</span> : <NoValue /> },
                ]}
                rows={rows}
                rowKey={(s) => `${s.project}/${s.id}`}
                empty={{
                  what: "No instruments declared.",
                  reason: "Nothing has been written down as gradeable, so there is nothing here that could have run - which is itself the finding.",
                }}
                caption={
                  <>
                    {gt.counts.slots_never_run} of {gt.counts.slots} instruments have never run.
                    A row with no run IS the finding: from every other page in this app it looks
                    identical to one that runs daily and passes.
                  </>
                }
              />
            </div>
          );
        }}
      </Async>
    </PageShell>
  );
}

function Fig({ n, label, loud }: { n: number; label: string; loud?: boolean }) {
  return (
    <div>
      <div className={loud ? "font-mono text-lg tabular-nums text-warning" : "font-mono text-lg tabular-nums"}>
        {loud && <span aria-hidden className="mr-1">▲</span>}{n}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
    </div>
  );
}
