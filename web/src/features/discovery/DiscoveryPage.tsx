import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { SourceBadge } from "@/components/app/SourceBadge";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { compact } from "@/lib/time";

interface Rec {
  id: string; source: string; title: string; url: string;
  description: string | null; stars: number | null; score: number | null;
  match_reason?: string;
}
interface RecPayload {
  recommendations: Rec[];
  stackHealth: { repo: string; reason: string }[];
  discoveries: Rec[];
  count: number;
}

/**
 * What to look at next, and why.
 *
 * `stackHealth` is rendered as its OWN section, never mixed into the
 * recommendation list. A stale dependency of ours is not a suggestion to adopt
 * anything - it is a problem with something we already run, and merging the two
 * lists turns "this is rotting" into "consider this", which is the opposite
 * claim.
 */
export function DiscoveryPage() {
  const q = useApi<RecPayload>("/recommendations");
  const d = destinationById("discovery")!;

  return (
    <PageShell title="Discovery" blurb={d.blurb} width="wide">
      <Async query={q} what="the recommendations">
        {(r) => (
          <div className="space-y-10">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Worth a look <span className="font-normal text-muted-foreground">{r.recommendations.length}</span>
              </h2>
              {r.recommendations.length === 0 ? (
                <AbsenceRow
                  what="Nothing to suggest."
                  reason="No stored item scored above the threshold for any project's declared interests."
                />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {r.recommendations.map((x) => <RecCard key={x.id} rec={x} />)}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold">
                Things we already run that need attention{" "}
                <span className="font-normal text-muted-foreground">{r.stackHealth.length}</span>
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">
                Kept separate on purpose. A dependency going stale is a problem with something we
                run, not a suggestion to adopt anything - listing the two together would turn
                "this is rotting" into "consider this".
              </p>
              {r.stackHealth.length === 0 ? (
                <AbsenceRow
                  what="Nothing flagged."
                  reason="No dependency we run crossed the staleness threshold on the last read."
                />
              ) : (
                <ul className="space-y-2">
                  {r.stackHealth.map((h) => (
                    <li key={h.repo} className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
                      <span aria-hidden className="mr-2 font-mono text-warning">▲</span>
                      <span className="font-mono text-xs">{h.repo}</span>
                      <span className="ml-3 text-muted-foreground">{h.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Async>
    </PageShell>
  );
}

function RecCard({ rec }: { rec: Rec }) {
  return (
    <a href={rec.url} target="_blank" rel="noreferrer"
       className="block rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent">
      <div className="flex items-center gap-2">
        <SourceBadge source={rec.source} />
        {rec.stars !== null && <span className="font-mono text-[11px] text-dim">★ {compact(rec.stars)}</span>}
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-medium">{rec.title}</div>
      {rec.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{rec.description}</p>
      )}
      {rec.match_reason && (
        <p className="mt-2 border-t pt-2 text-[11px] text-dim">{rec.match_reason}</p>
      )}
    </a>
  );
}
