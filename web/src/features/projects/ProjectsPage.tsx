import { Link } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { StateChip } from "@/components/app/StateChip";
import { DataTable } from "@/components/app/DataTable";
import { useApi } from "@/lib/useApi";
import type { HubPayload, HubProject } from "../types";
import { destinationById } from "@/components/app/nav";

/**
 * The fleet. Every project, five numbers each.
 *
 * "Needs unanswered" is the number no other page in this app can show, and the
 * reason this page exists: the matrix, the ledger and the radar are all keyed on
 * the CANDIDATE, so a need nobody proposed anything for has no row on any of
 * them. Here it is a row, and it is the loud one.
 */
export function ProjectsPage() {
  const q = useApi<HubPayload>("/projects-hub");
  const d = destinationById("projects")!;

  return (
    <PageShell title="All projects" blurb={d.blurb} width="wide">
      <Async query={q} what="the projects hub">
        {(hub) => (
          <div className="space-y-10">
            {hub.projects.length === 0 ? (
              <AbsenceRow
                tone="loud"
                what="No projects configured."
                reason="Copy config/projects.example.json to config/projects.json and restart."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {hub.projects.map((p) => <ProjectCard key={p.id} p={p} />)}
              </div>
            )}

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Adopted by more than one project{" "}
                <span className="font-normal text-muted-foreground">{hub.shared.length}</span>
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Counted from each project's OWN decision, never from the merged row - the merge is
                first-authored-wins, so reading its state would credit a project with somebody
                else's adoption.
              </p>
              <DataTable
                columns={[
                  { key: "repo", header: "Repo", width: "22rem",
                    cell: (r) => <span className="font-mono text-xs">{r.repo}</span> },
                  { key: "projects", header: "Adopted by", width: "14rem",
                    cell: (r) => (
                      <span className="flex flex-wrap gap-1">
                        {r.projects.map((id) => (
                          <Link key={id} to={`/p/${encodeURIComponent(id)}`}
                                className="font-mono text-xs text-primary hover:underline">{id}</Link>
                        ))}
                      </span>
                    ) },
                  { key: "why", header: "Why", secondary: true,
                    cell: (r) => <span className="text-xs text-muted-foreground">{r.why ?? "-"}</span> },
                ]}
                rows={hub.shared}
                rowKey={(r) => r.repo}
                empty={{
                  what: "Nothing is shared yet.",
                  reason: "No repo has been adopted by two projects, so there is nothing to reuse across them.",
                }}
              />
            </section>

            <p className="border-t pt-4 font-mono text-xs text-dim">
              live /api/projects-hub · {hub.population.projects} projects · {hub.population.slots} slots
              ({hub.population.slots_empty} with nothing proposed) · {hub.population.candidates} candidates
              of {hub.population.ledger_rows} ledger rows · {hub.population.unslotted} not slotted ·{" "}
              {hub.population.borrowed} borrowed · {hub.population.orphaned} orphaned
            </p>
          </div>
        )}
      </Async>
    </PageShell>
  );
}

function ProjectCard({ p }: { p: HubProject }) {
  const c = p.counts;
  return (
    <Link
      to={`/p/${encodeURIComponent(p.id)}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
    >
      <div className="font-mono text-sm text-primary">{p.id}</div>
      <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{p.name}</div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Stat label="slots" value={c.slots} />
        {/* The one number no other page can show. It is the finding, so it is
            the loudest thing on the card when it is not zero. */}
        <div>
          <dd>
            {c.slots_empty > 0 ? (
              <StateChip level="poor" word={String(c.slots_empty)} title="declared needs with nothing proposed at all" />
            ) : (
              <span className="font-mono tabular-nums text-success">0</span>
            )}
          </dd>
          <dt className="mt-1 text-[11px] uppercase tracking-wide text-dim">needs unanswered</dt>
        </div>
        <Stat label="candidates" value={c.candidates} />
        <Stat label="top score" value={c.best ?? "-"} />
        <Stat label="still estimated" value={c.estimated} />
        <Stat label="never run" value={c.slots_never_run} />
      </dl>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dd className="font-mono tabular-nums">{value}</dd>
      <dt className="mt-1 text-[11px] uppercase tracking-wide text-dim">{label}</dt>
    </div>
  );
}
