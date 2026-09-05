import { Link } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { NoValue } from "@/components/app/StateChip";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";

interface InvProject {
  id: string;
  name: string;
  blurb: string | null;
  blurb_confirmed?: boolean;
  surface: string | null;
  repoPath: string | null;
  deps: number | string | null;
  adopted: string[];
}

interface InventoryPayload {
  projects: InvProject[];
  shared: { repo: string; projects: string[] }[];
  totals: { projects: number; adoptions: number; shared: number; unconfirmed_blurbs: number };
}

/**
 * What each project actually runs, read from the checkouts on disk.
 *
 * The one rule this page exists to keep: a repo we could not read reports
 * "unknown", never 0. Zero is a measurement - it says the project has no
 * dependencies - and printing it for a checkout that was missing turns a
 * failed read into a confident false claim.
 */
export function InventoryPage() {
  const q = useApi<InventoryPayload>("/inventory");
  const d = destinationById("inventory")!;

  return (
    <PageShell title="What we have" blurb={d.blurb} width="wide">
      <Async query={q} what="the inventory">
        {(inv) => (
          <div className="space-y-8">
            <DataTable
              columns={[
                {
                  key: "project", header: "Project", width: "16rem",
                  cell: (p) => (
                    <Link to={`/p/${encodeURIComponent(p.id)}`} className="block">
                      <span className="font-mono text-xs text-link">{p.id}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{p.name}</span>
                    </Link>
                  ),
                },
                {
                  key: "deps", header: "Dependencies", numeric: true, width: "9rem",
                  cell: (p) =>
                    typeof p.deps === "number"
                      ? <span className="font-mono tabular-nums">{p.deps}</span>
                      // Not 0. An unreadable checkout and an empty one are
                      // different findings and must never render alike.
                      : <NoValue title="the checkout could not be read - this is not the same as having none">unknown</NoValue>,
                },
                {
                  key: "adopted", header: "Adopted", numeric: true, width: "7rem",
                  cell: (p) => <span className="font-mono tabular-nums">{p.adopted.length}</span>,
                },
                {
                  key: "surface", header: "Where it runs", secondary: true,
                  cell: (p) => p.surface
                    ? <span className="font-mono text-xs text-muted-foreground">{p.surface}</span>
                    : <NoValue title="no surface recorded" />,
                },
              ]}
              rows={inv.projects}
              rowKey={(p) => p.id}
              empty={{
                what: "No projects configured.",
                reason: "Copy config/projects.example.json to config/projects.json and restart.",
              }}
              caption={
                <>
                  {inv.totals.projects} projects · {inv.totals.adoptions} adoptions ·{" "}
                  {inv.totals.shared} repos used by more than one. Dependency counts are read
                  live from each checkout, so a moved or missing one reads "unknown" rather than
                  zero.
                </>
              }
            />

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Used by more than one project{" "}
                <span className="font-normal text-muted-foreground">{inv.shared.length}</span>
              </h2>
              <DataTable
                columns={[
                  { key: "repo", header: "Repo", width: "24rem",
                    cell: (r) => <span className="font-mono text-xs">{r.repo}</span> },
                  { key: "projects", header: "Projects",
                    cell: (r) => (
                      <span className="flex flex-wrap gap-1">
                        {r.projects.map((id) => (
                          <Link key={id} to={`/p/${encodeURIComponent(id)}`}
                                className="tap font-mono text-xs text-link hover:underline">{id}</Link>
                        ))}
                      </span>
                    ) },
                ]}
                rows={inv.shared}
                rowKey={(r) => r.repo}
                empty={{
                  what: "Nothing overlaps.",
                  reason: "No repo appears in two projects' resolved dependencies, so there is nothing being solved twice.",
                }}
              />
            </section>
          </div>
        )}
      </Async>
    </PageShell>
  );
}
