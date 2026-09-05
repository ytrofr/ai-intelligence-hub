import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { Input } from "@/components/ui/input";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import type { LedgerPayload, LedgerRow } from "../types";

/** Which states mean the decision is CLOSED, and how each one reads. */
function statusChip(row: LedgerRow) {
  const s = row.status || "";
  if (s === "done" || s === "accepted") return <StateChip level="good" word={s} title={row.outcome || undefined} />;
  if (s === "rejected") return <StateChip level="poor" word="rejected" title={row.lesson || row.why || undefined} />;
  if (s === "trial" || s === "proposed") return <StateChip level="mid" word={s} />;
  if (s === "in-use") return <StateChip level="none" word="in use" title="resolved out of a manifest - nobody decided this" />;
  return s ? <StateChip level="none" word={s} /> : <NoValue />;
}

/**
 * Every repo and dataset we use, what happened to it, and what it taught us.
 *
 * A REJECTED row stays visible. The whole value of a ledger is that it records
 * the decisions that went the other way - a list of only the adoptions is a
 * list of things we happen to use, which the dependency files already are.
 */
export function StackPage() {
  const project = useProject();
  const q = useApi<LedgerPayload>("/ledger");
  const [needle, setNeedle] = useState("");
  const d = destinationById("stack")!;

  return (
    <PageShell
      title="Stack Ledger"
      blurb={d.blurb}
      width="wide"
      actions={
        <Input
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          placeholder="filter by repo, topic or reason"
          className="h-8 w-36 sm:w-64"
          aria-label="Filter the ledger"
        />
      }
    >
      <Async query={q} what="the stack ledger">
        {(led) => <Body led={led} project={project} needle={needle} />}
      </Async>
    </PageShell>
  );
}

function Body({ led, project, needle }: { led: LedgerPayload; project?: string; needle: string }) {
  const rows = useMemo(() => {
    const n = needle.trim().toLowerCase();
    return led.rows.filter((r) => {
      // Membership, not substring. Matching the project id against the whole
      // row once pulled in rows whose REASON merely mentioned the project -
      // three repos it does not own, presented as if it did.
      if (project && !r.projects.includes(project) && !r.radar_projects.includes(project)) return false;
      if (!n) return true;
      return `${r.repo} ${r.topic} ${r.why} ${r.lesson}`.toLowerCase().includes(n);
    });
  }, [led.rows, project, needle]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4 text-sm">
        <Fig n={led.counts.total} label="rows" />
        <Fig n={led.counts.explained} label="explained" />
        <Fig n={led.counts.unexplained} label="no reason on file" />
        <Fig n={led.counts.closed} label="closed" />
        <Fig n={led.counts.closedWithLesson} label="closed with a lesson" />
      </div>

      <DataTable
        columns={[
          { key: "repo", header: "Repo", width: "20rem",
            cell: (r: LedgerRow) => (
              <div className="min-w-0">
                <div className="truncate font-mono text-xs">{r.repo}</div>
                {r.topic && <div className="mt-0.5 truncate text-[11px] text-dim">{r.topic}</div>}
              </div>
            ) },
          { key: "status", header: "Status", width: "9rem", cell: statusChip },
          { key: "projects", header: "Projects", width: "11rem", secondary: true,
            cell: (r: LedgerRow) => (
              <span className="flex flex-wrap gap-1">
                {r.projects.length === 0 ? <NoValue title="not claimed by any project" /> :
                  r.projects.map((id) => (
                    <Link key={id} to={`/p/${encodeURIComponent(id)}/stack`}
                          className="font-mono text-[11px] text-primary hover:underline">{id}</Link>
                  ))}
              </span>
            ) },
          { key: "why", header: "Why", cell: (r: LedgerRow) =>
              r.why ? <span className="text-xs">{r.why}</span>
                    : <NoValue title="nobody wrote down why this is here" /> },
          // The lesson is the column that makes this a ledger rather than a
          // list. A closed row with no lesson is a decision nobody can reuse.
          { key: "lesson", header: "Lesson", secondary: true, cell: (r: LedgerRow) =>
              r.lesson ? <span className="text-xs text-muted-foreground">{r.lesson}</span>
                       : <NoValue title="closed without recording what it taught us" /> },
        ]}
        rows={rows}
        rowKey={(r) => `${r.repo}::${r.pkg}`}
        empty={{
          what: needle ? "Nothing matches that filter." : "No rows for this project.",
          reason: needle
            ? `No repo, topic, reason or lesson contains "${needle}".`
            : "This project has not claimed any repo in the ledger yet.",
        }}
        caption={
          project ? (
            <>
              Showing {rows.length} of {led.counts.total} rows, filtered to{" "}
              <span className="font-mono">{project}</span>. The counts above are ledger-wide -
              a denominator that moves with the filter is not a denominator.
            </>
          ) : (
            <>Showing {rows.length} of {led.counts.total} rows.</>
          )
        }
      />
    </div>
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
