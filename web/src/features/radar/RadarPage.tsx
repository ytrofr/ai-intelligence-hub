import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApi } from "@/lib/useApi";
import { useProject } from "@/components/app/useProject";
import { destinationById } from "@/components/app/nav";
import { compact } from "@/lib/time";

interface RadarRow {
  repo: string;
  topic: string;
  verdict: string;
  status: string;
  why: string;
  stars?: number;
  lesson?: string;
  evidence?: string;
}
interface RadarTopic { id: string; label: string; blurb: string; count: number; top: RadarRow[]; sub: RadarRow[] }
interface RadarPayload {
  project: string;
  title: string;
  subtitle: string;
  summary: Record<string, number>;
  topics: RadarTopic[];
  needsReview: RadarRow[];
}

function verdictChip(v: string) {
  if (v === "ADOPT") return <StateChip level="good" word="adopt" />;
  if (v === "WATCH") return <StateChip level="mid" word="watch" />;
  if (v === "SKIP") return <StateChip level="poor" word="skip" />;
  return v ? <StateChip level="none" word={v.toLowerCase()} /> : <NoValue />;
}

function statusChip(s: string) {
  if (!s) return <NoValue title="not yet triaged" />;
  if (s === "done" || s === "accepted") return <StateChip level="good" word={s} />;
  if (s === "rejected") return <StateChip level="poor" word="rejected" />;
  return <StateChip level="mid" word={s} />;
}

/**
 * The queue: what has been proposed, tried, adopted or refused.
 *
 * READ ONLY here, deliberately. The old page carried a close form, and closing
 * a row is gated server-side on evidence, a lesson and an eyeball - a gate the
 * client must not be able to appear to satisfy. Until the write path is rebuilt
 * with its refusal handling intact, offering a button that might silently fail
 * is worse than offering none.
 */
export function RadarPage() {
  const project = useProject();
  const q = useApi<RadarPayload>(project ? `/radar?project=${encodeURIComponent(project)}` : null);
  const d = destinationById("radar")!;

  return (
    <PageShell title="Adoption Radar" blurb={d.blurb} width="wide">
      <Async query={q} what={`${project ?? "this project"}'s radar`}>
        {(r) => (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
              <Fig n={r.summary.curated ?? 0} label="curated" />
              <Fig n={r.summary.adopt ?? 0} label="adopt" />
              <Fig n={r.summary.watch ?? 0} label="watch" />
              <Fig n={r.summary.skip ?? 0} label="skip" />
              <Fig n={r.summary.done ?? 0} label="done" />
              <Fig n={r.summary.rejected ?? 0} label="rejected" />
            </div>

            <Tabs defaultValue={r.topics[0]?.id ?? "none"}>
              <TabsList className="flex-wrap">
                {r.topics.map((t) => (
                  <TabsTrigger key={t.id} value={t.id} className="gap-2">
                    {t.label}
                    <span className="font-mono text-[11px] text-muted-foreground">{t.count}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {r.topics.map((t) => (
                <TabsContent key={t.id} value={t.id} className="space-y-3">
                  <p className="max-w-3xl text-sm text-muted-foreground">{t.blurb}</p>
                  <DataTable
                    columns={[
                      { key: "repo", header: "Repo", width: "20rem",
                        cell: (x: RadarRow) => <span className="font-mono text-xs">{x.repo}</span> },
                      { key: "stars", header: "Stars", numeric: true, width: "6rem", secondary: true,
                        cell: (x: RadarRow) => <span className="font-mono text-xs">{compact(x.stars)}</span> },
                      { key: "verdict", header: "Verdict", width: "7rem", cell: (x: RadarRow) => verdictChip(x.verdict) },
                      { key: "status", header: "Status", width: "8rem", cell: (x: RadarRow) => statusChip(x.status) },
                      { key: "why", header: "Why", cell: (x: RadarRow) =>
                          x.why ? <span className="text-xs">{x.why}</span> : <NoValue title="no reason on file" /> },
                    ]}
                    rows={[...(t.top ?? []), ...(t.sub ?? [])]}
                    rowKey={(x) => x.repo}
                    empty={{
                      what: "Nothing under this topic.",
                      reason: "No repo has been curated into it yet, so the topic is declared but empty.",
                    }}
                  />
                </TabsContent>
              ))}
            </Tabs>

            <p className="border-t pt-4 text-xs text-muted-foreground">
              Read-only. Closing a row is gated on evidence, a lesson and your own eyeball, and
              that gate lives on the server - a button here that might silently fail it would be
              worse than no button.
            </p>
          </div>
        )}
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
