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
/** The endpoint every summary figure on this page is read from. */
const LEDGER_PATH = "/ledger";
const LEDGER_RAW = `/api${LEDGER_PATH}`;

export function StackPage() {
  const project = useProject();
  const q = useApi<LedgerPayload>(LEDGER_PATH);
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
        {/* Rows from the manifests carry no reason, so they land in "rows" and
            "no reason on file" only - those two also show the deps snapshot age. */}
        <Fig n={led.counts.total} label="rows" src="counts.total"
             readAt={led.generated_at} depsAt={led.deps_generated_at} />
        <Fig n={led.counts.explained} label="explained" src="counts.explained" readAt={led.generated_at} />
        <Fig n={led.counts.unexplained} label="no reason on file" src="counts.unexplained"
             readAt={led.generated_at} depsAt={led.deps_generated_at} />
        <Fig n={led.counts.closed} label="closed" src="counts.closed" readAt={led.generated_at} />
        <Fig n={led.counts.closedWithLesson} label="closed with a lesson" src="counts.closedWithLesson"
             readAt={led.generated_at} />
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
                          className="tap font-mono text-[11px] text-link hover:underline">{id}</Link>
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

/**
 * When the data behind a figure was read. The time is the payload's OWN
 * `generated_at`, which routes/ledger.js stamps when it reads the radar and
 * deps files for this request - not the page's fetch time. A payload with no
 * stamp says so rather than borrowing the clock.
 */
function readLabel(readAt?: string) {
  const d = readAt ? new Date(readAt) : null;
  if (!d || isNaN(d.getTime())) return "read time unknown";
  return `read ${d.toISOString().slice(11, 16)} UTC`;
}

/**
 * The age of config/ledger/deps.json, which the backfill writes and the route
 * only re-reads. A fresh read time on an old snapshot would claim the manifest
 * rows are current, so the snapshot date is shown beside it. Absent -> nothing.
 */
function depsLabel(depsAt?: string | null) {
  const d = depsAt ? new Date(depsAt) : null;
  if (!d || isNaN(d.getTime())) return null;
  return `deps snapshot ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/**
 * A summary figure, its label, and where it came from: the read time on the
 * left and the payload field it is read from on the right, opening the raw
 * endpoint (insight-doctrine, live screens).
 */
function Fig({ n, label, src, readAt, depsAt }: {
  n: number; label: string; src: string; readAt?: string; depsAt?: string | null;
}) {
  const deps = depsLabel(depsAt);
  return (
    <div>
      <div className="font-mono text-lg tabular-nums">{n}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
      <div className="mt-2 flex justify-between gap-2 border-t pt-1.5 text-[10.5px] text-muted-foreground">
        <span>
          {readLabel(readAt)}
          {deps && <span className="block" title={`config/ledger/deps.json generated ${depsAt}`}>{deps}</span>}
        </span>
        <a href={LEDGER_RAW} target="_blank" rel="noreferrer"
           className="whitespace-nowrap text-inherit underline decoration-dotted"
           title={`the payload this number is read from - look under ${src}`}>
          {src} ↗
        </a>
      </div>
    </div>
  );
}
