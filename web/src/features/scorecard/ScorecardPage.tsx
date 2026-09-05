import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { ScoreBar } from "@/components/app/ScoreBar";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import type { ScorecardPayload, ScorecardRow } from "../types";

/**
 * The per-project adoption scorecard.
 *
 * Operator, 2026-09-05: "measure everything per project before we adopt so we
 * base it on measure and data and insights and not guess." The store now
 * refuses `accepted` without a bench on the project's own row; this page is
 * the other half - what each project measured, what it only guessed, what it
 * never ran, and what each no taught.
 *
 * Every row here is THIS project's own radar row. A repo two projects ruled on
 * is two rows, on two scorecards, and project A's bench never appears under B.
 * That is the whole reason this is not a filter on the Stack Ledger.
 */

/** The measure, as a SHAPE first: the reader cannot rely on hue. */
function measureChip(r: ScorecardRow) {
  if (r.legacy_unbenched)
    return <StateChip level="poor" word="taken, no bench" title="accepted or in trial with no measurement on this project's data - run it or drop it" />;
  if (r.measure === "measured")
    return <StateChip level="good" word="measured" title={`bench on ${r.project}'s own data, ${r.bench_date ?? "date unknown"}`} />;
  if (r.measure === "estimated")
    return <StateChip level="mid" word="estimated" title="scored by judgement - nothing was run on this project yet" />;
  return <StateChip level="none" word="not run" title="no bench and no score - nobody has measured this here" />;
}

/** The operator's verdict on the pair, or an honest "not yet". */
function verdictCell(r: ScorecardRow) {
  if (!r.eyeballed) return r.pair ? <NoValue title="a pair was posted; no verdict yet">awaiting</NoValue> : <NoValue title="no pair posted yet" />;
  const v = r.eyeballed;
  const day = v.at ? v.at.slice(0, 10) : "";
  if (v.verb === "adopt") return <StateChip level="good" word={`adopt ${day}`} title={v.raw} />;
  if (v.verb === "reject") return <StateChip level="poor" word={`reject ${day}`} title={v.raw} />;
  if (v.verb === "not-yet") return <StateChip level="mid" word={`not yet ${day}`} title={v.raw} />;
  return <NoValue title={`unparsable verdict: ${v.raw}`}>{v.raw}</NoValue>;
}

function benchCell(r: ScorecardRow) {
  if (!r.bench) return <NoValue title={`not run on ${r.project}`} />;
  const result = r.bench_result ?? "";
  const short = result.length > 64 ? `${result.slice(0, 63)}…` : result;
  return (
    <div className="min-w-0" title={`${r.bench.run}\n${result}`}>
      <div className="font-mono text-[11px] text-dim">{r.bench_date ?? "date unknown"}</div>
      <div className="truncate text-xs">{short || <NoValue title="bench recorded with no result line" />}</div>
    </div>
  );
}

function beforeAfterCell(r: ScorecardRow) {
  if (!r.before_after) return <NoValue title="no before/after recorded - nothing was flipped and measured on live traffic" />;
  const b = r.before_after;
  return (
    <div className="min-w-0 text-xs" title={`before: ${b.before}\nafter: ${b.after}\nwindow ${b.window}, ${b.date}`}>
      <div className="truncate">{b.before}</div>
      <div className="truncate">{b.after}</div>
    </div>
  );
}

function clip(text: string | null, n: number) {
  if (!text) return <NoValue title="not recorded" />;
  return <span className="text-xs" title={text}>{text.length > n ? `${text.slice(0, n - 1)}…` : text}</span>;
}

export function ScorecardPage() {
  const project = useProject();
  const q = useApi<ScorecardPayload>(
    project ? `/adoption-scorecard?project=${encodeURIComponent(project)}` : "/adoption-scorecard",
  );
  const d = destinationById("scorecard")!;

  return (
    <PageShell title="Scorecard" blurb={d.blurb} width="wide">
      <Async query={q} what="the adoption scorecard">
        {(sc) => {
          const rows = sc.projects.flatMap((p) => p.rows);
          const c = sc.population;
          return (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
                <Fig n={c.rows} label="candidates" />
                <Fig n={c.measured} label="measured here" />
                <Fig n={c.estimated} label="estimated" />
                <Fig n={c.not_run} label="not run" />
                <Fig n={c.legacy_unbenched} label="taken, no bench" />
                <Fig n={c.with_verdict} label="with your verdict" />
              </div>

              <DataTable
                columns={[
                  { key: "repo", header: "Candidate", width: "18rem",
                    cell: (r) => (
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{r.repo}</div>
                        <div className="mt-0.5 truncate text-[11px] text-dim">
                          {!project && <span className="mr-2">{r.project}</span>}
                          {r.slot ?? ""}
                        </div>
                      </div>
                    ) },
                  { key: "measure", header: "Measured?", width: "9rem", cell: measureChip },
                  { key: "bench", header: "Bench (own data)", width: "16rem", cell: benchCell },
                  { key: "score", header: "Score", width: "8rem", secondary: true, cell: (r) => <ScoreBar total={r.score_total} /> },
                  { key: "state", header: "State", width: "10rem", cell: (r) =>
                      <StateChip level={r.status === "rejected" ? "poor" : r.state === "done" ? "good" : r.state.endsWith("-unseen") || r.state.endsWith("-unverified") || r.state === "accepted-without-evidence" ? "mid" : "none"}
                                 word={r.state} title={`status ${r.status}${r.verdict ? `, radar verdict ${r.verdict}` : ""}`} /> },
                  { key: "verdict", header: "Your verdict", width: "9rem", cell: verdictCell },
                  { key: "before_after", header: "Before / after", width: "14rem", secondary: true, cell: beforeAfterCell },
                  { key: "lesson", header: "Lesson", width: "14rem", secondary: true, cell: (r) => clip(r.lesson, 60) },
                  { key: "next", header: "Next", width: "13rem", cell: (r) =>
                      r.next && r.next !== "-" ? <span className="whitespace-nowrap text-xs">{r.next}</span> : <NoValue title="closed - nothing left to do" /> },
                ]}
                rows={rows}
                rowKey={(r) => `${r.project}::${r.repo}`}
                empty={{
                  what: project ? `${project} has ruled on nothing yet.` : "No project has ruled on anything yet.",
                  reason: "A scorecard row is a radar row this project wrote itself. Propose a candidate on the Radar, then bench it with /adopt.",
                }}
                caption={
                  <>
                    {rows.length} rows across {sc.population.repos} repos. Every row is this project's OWN radar
                    row: a repo two projects ruled on is two rows, and one project's bench never counts for another.
                    "Taken, no bench" is the debt this page exists to show - those rows were accepted before the
                    store started refusing it (2026-09-05).
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

function Fig({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-lg tabular-nums">{n}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
    </div>
  );
}
