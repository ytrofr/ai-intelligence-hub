import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import type { Level } from "@/components/app/StateChip";
import { Fig } from "@/components/app/Fig";
import { useApi } from "@/lib/useApi";
import { ageDays } from "@/lib/time";

type CellState = "live" | "built" | "absent" | "unknown";

interface PracticeCell {
  state: CellState;
  evidence: string;
  files: { path: string; line: number; text: string }[];
}

interface PracticePayload {
  never_run: boolean;
  how?: string;
  state_path: string;
  generated_at: string | null;
  date: string | null;
  partial_run: string[] | null;
  versions_stale: string | null;
  items: { id: string; title: string }[];
  projects: {
    id: string; name: string; root: string; branch: string | null; sha: string | null;
    dirty_files: number | null; readable: boolean; cells: Record<string, PracticeCell>;
  }[];
  counts: { cells: number; by_state: Record<CellState, number> };
  control: { what: string; result: string; module_on_disk: boolean; module_named_in_cell: boolean; ok: boolean } | null;
  harvest_crosscheck: { harvest: string | null; rows?: number; items_here?: number; drift: string | null; reason?: string } | null;
  previous_run: string | null;
  changed_cells: { project: string; item: string; title: string; from: CellState; to: CellState; evidence: string }[];
  quests_to_file: string[];
}

/**
 * What each AI project actually PRACTISES, against the twelve items the stack harvest
 * keeps naming - scored by ~/.claude/scripts/ai-practice-scorecard.py, which reads each
 * checkout rather than asking anyone.
 *
 * Same laws as the Trust tab beside it:
 *  - Every state has a SHAPE and a WORD, never a colour alone (StateChip enforces it).
 *  - "can't tell" is its own state and is NEVER read as absent: one says the practice is
 *    missing, the other that the check could not judge.
 *  - A scorecard that has never run says so. It does not render an empty grid, which
 *    would read as "twelve practices, none of them present".
 *  - Counts come from the run, so this page and the dated report cannot disagree.
 *
 * The DIFF is the point of a standing routine, so it gets its own section: a weekly page
 * whose only content is today's grid cannot show that something regressed.
 */
const CHIP: Record<CellState, { level: Level; glyph: string; word: string; title: string }> = {
  live: { level: "good", glyph: "●", word: "live", title: "in the serving path, proven by the file:line below" },
  built: { level: "mid", glyph: "◐", word: "built", title: "the code is there and something short of serving - shadow mode, no caller, a disabled CI job" },
  absent: { level: "poor", glyph: "○", word: "absent", title: "measured missing, with the nearest near-miss named when there is one" },
  unknown: { level: "none", glyph: "?", word: "can't tell", title: "the check could not judge - this is NOT absent" },
};

/** An evidence path is a real place on this machine; make it openable, and readable if not. */
function Evidence({ cell }: { cell: PracticeCell }) {
  if (!cell.files.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {cell.files.slice(0, 4).map((f, i) => (
        <li key={`${f.path}:${f.line}:${i}`} className="break-all font-mono text-[11px] text-dim">
          <a href={`file://${f.path.startsWith("/") ? f.path : `/${f.path}`}`}
             title={f.text || "evidence"}
             className="text-link hover:underline">
            {f.path}:{f.line}
          </a>
          {f.text && <span className="ml-1 text-muted-foreground">{f.text}</span>}
        </li>
      ))}
    </ul>
  );
}

export function PracticeScorecard() {
  const q = useApi<PracticePayload>("/ai-practice");
  return (
    <Async query={q} what="the AI practice scorecard">
      {(p) =>
        p.never_run ? (
          <div className="rounded-lg border bg-card p-4 text-sm">
            <p className="font-semibold">The scorecard has never run.</p>
            <p className="mt-1 text-muted-foreground">
              Nothing has been measured, so there is nothing to show - which is not the same as
              twelve absent practices. Run it:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{p.how}</pre>
            <p className="mt-2 text-[11px] text-dim">It writes {p.state_path}.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
              <Fig n={p.counts.cells} label="cells scored" />
              <Fig n={p.counts.by_state.live ?? 0} label="live" />
              <Fig n={p.counts.by_state.built ?? 0} label="built, not live" />
              <Fig n={p.counts.by_state.absent ?? 0} label="absent" />
              <Fig n={p.counts.by_state.unknown ?? 0} label="can't tell" />
              <div className="self-end text-[11px] text-dim">
                {p.generated_at ? `scored ${ageDays(p.generated_at) ?? 0}d ago` : "never scored"}
              </div>
            </div>

            {p.control && (
              <p className={`rounded-lg border p-3 text-xs ${p.control.ok ? "bg-card" : "bg-muted"}`}>
                <StateChip level={p.control.ok ? "good" : "poor"}
                           glyph={p.control.ok ? "✓" : "▲"}
                           word={p.control.ok ? "control fired" : "control did NOT fire"}
                           title={p.control.ok
                             ? "a cell whose answer is known independently came back right, so the search was working"
                             : "the search is broken - do not quote any number on this run"} />{" "}
                <span className="text-muted-foreground">
                  {p.control.what} - came back <span className="font-mono">{p.control.result}</span>.
                </span>
                {!p.control.ok && (
                  <span className="ml-1 font-semibold">
                    No number on this run is evidence until the run is repeated green.
                  </span>
                )}
              </p>
            )}

            {p.partial_run && (
              <p className="text-xs text-muted-foreground">
                Partial run ({p.partial_run.join(", ")}). Every other column is carried from the
                previous run and is only as fresh as that one.
              </p>
            )}
            {p.versions_stale && (
              <p className="text-xs text-muted-foreground">
                Version reference: {p.versions_stale} - the drift row reads "can't tell" on purpose.
              </p>
            )}

            <DataTable
              columns={[
                {
                  key: "item", header: "Practice item", width: "18rem",
                  cell: (it: { id: string; title: string }, ) => (
                    <div className="min-w-0">
                      <div className="text-sm">{it.title}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-dim">{it.id}</div>
                    </div>
                  ),
                },
                ...p.projects.map((proj) => ({
                  key: proj.id,
                  header: (
                    <span>
                      <span className="font-mono">{proj.id}</span>
                      <span className="mt-0.5 block text-[11px] font-normal text-dim">
                        {proj.sha ? `${proj.branch}@${proj.sha}` : "checkout unknown"}
                      </span>
                    </span>
                  ),
                  cell: (it: { id: string; title: string }) => {
                    const cell = proj.cells[it.id];
                    if (!cell) return <NoValue title="this run did not score the cell">not scored</NoValue>;
                    const chip = CHIP[cell.state];
                    return (
                      <div className="min-w-0">
                        <StateChip level={chip.level} glyph={chip.glyph} word={chip.word}
                                   title={`${chip.title} - ${cell.evidence}`} />
                        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{cell.evidence}</div>
                        <Evidence cell={cell} />
                      </div>
                    );
                  },
                })),
              ]}
              rows={p.items}
              rowKey={(it) => it.id}
              empty={{
                what: "No practice items registered.",
                reason: "The scorecard script scored none, so there is nothing that could have been measured.",
              }}
              caption={
                <>
                  {p.counts.cells} cells, every one read from the checkout on disk - source only,
                  docs and archives excluded. Evidence links point at real paths on this machine;
                  a browser may refuse to open file:// from a page, so the path is written out too.
                </>
              }
            />

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">
                Changed since the last run{" "}
                <span className="font-normal text-muted-foreground">
                  {p.previous_run ? p.previous_run : "no baseline yet"}
                </span>
              </h2>
              {!p.previous_run ? (
                <p className="text-xs text-muted-foreground">
                  First run - no earlier scorecard exists, so no cell can be reported as changed.
                  This run is the baseline.
                </p>
              ) : p.changed_cells.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No cell changed state. A zero-change run is still a run, and it is recorded.
                </p>
              ) : (
                <DataTable
                  columns={[
                    { key: "project", header: "Project", width: "7rem",
                      cell: (c) => <span className="font-mono text-xs">{c.project}</span> },
                    { key: "item", header: "Item", cell: (c) => <span className="text-xs">{c.title}</span> },
                    { key: "move", header: "Moved", width: "16rem",
                      cell: (c) => (
                        <span className="text-xs">
                          <StateChip level={CHIP[c.from].level} glyph={CHIP[c.from].glyph} word={CHIP[c.from].word} />
                          <span className="mx-1 text-dim">to</span>
                          <StateChip level={CHIP[c.to].level} glyph={CHIP[c.to].glyph} word={CHIP[c.to].word} />
                        </span>
                      ) },
                    { key: "evidence", header: "Evidence", secondary: true,
                      cell: (c) => <span className="text-[11px] text-muted-foreground">{c.evidence}</span> },
                  ]}
                  rows={p.changed_cells}
                  rowKey={(c) => `${c.project}:${c.item}`}
                  empty={{ what: "Nothing moved.", reason: "No cell changed state since the previous run." }}
                />
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">
                Quests to file{" "}
                <span className="font-normal text-muted-foreground">{p.quests_to_file.length}</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                One line per absent cell, for the operator to ratify. Nothing here has been filed -
                an unratified board is worse than no board.
              </p>
              {p.quests_to_file.length > 0 ? (
                <pre className="overflow-x-auto rounded-lg border bg-card p-3 font-mono text-[11px] leading-relaxed">
                  {p.quests_to_file.join("\n")}
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">No cell reads absent.</p>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Is the list of twelve still the list?</h2>
              <p className="text-xs text-muted-foreground">
                {p.harvest_crosscheck?.drift
                  ? `Drift: ${p.harvest_crosscheck.drift} (${p.harvest_crosscheck.harvest}). The items are re-derived from each harvest's "Scorecard inputs" section - reconcile before the next run.`
                  : p.harvest_crosscheck?.harvest
                    ? `${p.harvest_crosscheck.harvest} names ${p.harvest_crosscheck.rows} practice items and this run scores ${p.harvest_crosscheck.items_here}. No drift.`
                    : `Could not check: ${p.harvest_crosscheck?.reason ?? "no harvest report found"}.`}
              </p>
            </section>

            <p className="text-xs text-muted-foreground">
              Scored by ~/.claude/scripts/ai-practice-scorecard.py (the /ai-dna practice-scorecard
              phase): weekly, and on every /finalize of an AI-touching plan. "Can't tell" is never
              read as absent, and a cell nobody scored says so.
            </p>
          </div>
        )
      }
    </Async>
  );
}
