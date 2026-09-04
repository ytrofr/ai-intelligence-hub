import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { DimBar, ScoreBar } from "@/components/app/ScoreBar";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import type { MatrixRow } from "../types";

interface MatrixPayload {
  population: {
    rows: number; ledger_rows: number; hidden: number; scored: number;
    unscored: number; measured: number; estimated: number;
    licence_read: number; licence_restricted: number;
    by_project: Record<string, number>;
  };
  projects: { id: string; name: string; rows: MatrixRow[] }[];
}

/**
 * The four dimensions, and which direction is good for each.
 *
 * effort and risk are better LOW. Painting the raw value would make "cheap"
 * and "expensive" the same colour, which is the whole reason favour() takes a
 * direction rather than a number.
 */
const DIMS: { key: keyof MatrixRow; label: string; better: number; hint: string }[] = [
  { key: "effect", label: "Effect", better: +1, hint: "how much it moves the thing we care about" },
  { key: "effort", label: "Effort", better: -1, hint: "what it costs us to adopt - lower is better" },
  { key: "risk", label: "Risk", better: -1, hint: "what breaks if it goes wrong - lower is better" },
  { key: "impact", label: "Impact", better: +1, hint: "how much of the product it reaches" },
];

/** Whether the score came from a real run or from judgement. */
function basisChip(basis?: string) {
  if (basis === "measured") return <StateChip level="good" word="measured" title="a real run, with a report behind it" />;
  if (basis === "estimated") return <StateChip level="mid" word="estimated" title="scored by judgement - not run yet" />;
  return <NoValue title="no basis recorded" />;
}

/**
 * A licence chip. The stored value is sometimes an SPDX id and sometimes a
 * whole sentence ("free for individuals & orgs <=3 employees, else paid"),
 * and rendering the sentence as the chip's word turned one cell into a
 * paragraph and pushed the row six lines tall. Truncated in the chip, whole in
 * the tooltip - never dropped, because the awkward ones are the ones that
 * actually need reading.
 */
function licenceChip(licence?: string, klass?: string) {
  if (!licence) return <NoValue title="licence not read" />;
  const short = licence.length > 22 ? `${licence.slice(0, 21)}…` : licence;
  if (klass === "permissive")
    return <StateChip level="good" word={short} title={`${licence} - on the permissive allowlist`} />;
  if (klass === "restricted")
    return <StateChip level="poor" word={short} title={`${licence} - restricted, read it before adopting`} />;
  return <StateChip level="none" word={short} title={`${licence} - not recognised by the allowlist, so not cleared`} />;
}

/**
 * Candidates ranked, with the gates each still owes.
 *
 * The table is keyed on the CANDIDATE, which is exactly why it cannot show a
 * need nobody proposed anything for - that is the Needs page's job, and the
 * caption says so rather than leaving the reader to assume this page is
 * complete.
 */
export function MatrixPage() {
  const project = useProject();
  const q = useApi<MatrixPayload>(
    project ? `/adoption-matrix?project=${encodeURIComponent(project)}` : "/adoption-matrix",
  );
  const d = destinationById("matrix")!;

  return (
    <PageShell title="Adoption Matrix" blurb={d.blurb} width="wide">
      <Async query={q} what="the adoption matrix">
        {(m) => {
          const rows = m.projects.flatMap((p) => p.rows).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
          return (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
                <Fig n={m.population.rows} label="candidates" />
                <Fig n={m.population.measured} label="measured" />
                <Fig n={m.population.estimated} label="estimated" />
                <Fig n={m.population.unscored} label="unscored" />
                <Fig n={m.population.licence_restricted} label="restricted licence" />
              </div>

              <DataTable
                columns={[
                  { key: "repo", header: "Candidate", width: "20rem",
                    cell: (r) => (
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs">{r.repo}</div>
                        {r.slot && <div className="mt-0.5 truncate text-[11px] text-dim">{r.slot}</div>}
                      </div>
                    ) },
                  { key: "total", header: "Score", width: "10rem", cell: (r) => <ScoreBar total={r.total} /> },
                  { key: "basis", header: "Basis", width: "8rem", cell: (r) => basisChip(r.basis) },
                  ...DIMS.map((dim) => ({
                    key: String(dim.key),
                    header: <span title={dim.hint}>{dim.label}</span>,
                    width: "6.5rem",
                    secondary: true,
                    cell: (r: MatrixRow) => <DimBar value={r[dim.key]} better={dim.better} />,
                  })),
                  { key: "licence", header: "Licence", width: "11rem", secondary: true,
                    cell: (r) => licenceChip(r.licence, r.licence_class) },
                  { key: "next", header: "Next", width: "12rem", cell: (r) =>
                      r.next_action ? <span className="text-xs">{r.next_action}</span>
                                    : <NoValue title="no next action recorded" /> },
                ]}
                rows={rows}
                rowKey={(r) => `${r.project ?? ""}::${r.repo}`}
                empty={{
                  what: "No candidates scored here.",
                  reason: "Nothing has been proposed and rated for this project yet - the Needs page shows which slots are waiting.",
                }}
                caption={
                  <>
                    {rows.length} of {m.population.ledger_rows} ledger rows, {m.population.hidden} hidden.
                    Score bands are absolute: 80+ is strong on every axis at once, not "best of these".
                    This table is keyed on the CANDIDATE, so a need nobody proposed anything for has no
                    row here at all - see Needs for those.
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
