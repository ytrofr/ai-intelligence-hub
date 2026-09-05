import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { SourceBadge } from "@/components/app/SourceBadge";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { compact } from "@/lib/time";
import { BandGroup, SourcePicker } from "@/features/items/filters/parts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  applyFilters, countBy, starBands, useDiscoveryFilters, WHY_LABEL, type Filterable,
} from "./useDiscoveryFilters";

interface Rec extends Filterable {
  id: string; source: string; title: string; url: string;
  description: string | null; stars: number | null; score: number | null;
  match_reason?: string;
  relevance?: { strategy?: string; matchReason?: string };
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
  const { f, set, toggleSource, clear, active } = useDiscoveryFilters();
  const project = f.project;
  const projects = useApi<{ projects: { id: string; name: string }[] }>("/recommendations/projects");
  // A POOL, not a page. The filters run client-side over what the server
  // ranked, so narrowing cannot change WHICH rows the server considered best -
  // re-querying per filter would silently alter the recommendation rather than
  // narrow it. 120 is the pool; the server still decides the order.
  const q = useApi<RecPayload>(
    `/recommendations?limit=120${project ? `&project=${encodeURIComponent(project)}` : ""}`,
  );
  const d = destinationById("discovery")!;

  return (
    <PageShell title="Discovery" blurb={d.blurb} width="wide">
      {/* Outside <Async> deliberately: whether these are project matches is
          settled by the URL, not by the fetch, so the reader is told before
          the rows land rather than after they have started reading them. */}
      {!project && (
        <div className="mb-6">
          <AbsenceRow
            what="These are the highest-scoring items, not matches for a project."
            reason="No project is selected, so nothing has been compared against a stack. Pick one in the sidebar and every row gains a reason."
          />
        </div>
      )}
      <Async query={q} what="the recommendations">
        {(r) => (
          <div className="space-y-10">
            <Worth all={r.recommendations}
                   projects={projects.state === "ready" ? projects.data.projects : []}
                   f={f} set={set} toggleSource={toggleSource} clear={clear} active={active} />

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

/**
 * The suggestions, and the controls over them.
 *
 * The honest-mode line is not decoration. With no project selected the API
 * falls back to the top-scored feed (routes/recommendations.js:22), so every
 * row comes back with strategy "unknown" and no match reason - 20 of 20,
 * measured. Rendering that under the word "recommendations" with a "why"
 * filter that can only say "no reason recorded" would be a control that lies
 * about what it is filtering.
 */
function Worth({
  all, projects, f, set, toggleSource, clear, active,
}: {
  all: Rec[];
  projects: { id: string; name: string }[];
  f: ReturnType<typeof useDiscoveryFilters>["f"];
  set: ReturnType<typeof useDiscoveryFilters>["set"];
  toggleSource: ReturnType<typeof useDiscoveryFilters>["toggleSource"];
  clear: ReturnType<typeof useDiscoveryFilters>["clear"];
  active: number;
}) {
  const shown = applyFilters(all, f);
  // Counts over the UNFILTERED pool - a hint that moved with the selection
  // would only tell the reader what they just picked.
  const byWhy = countBy(all, (r) => r.relevance?.strategy ?? "unknown");
  const bySource = countBy(all, (r) => r.source);
  const sources = Object.entries(bySource)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  const whyBands = [
    { label: "any", value: "" },
    ...Object.keys(WHY_LABEL)
      .filter((k) => byWhy[k])
      .map((k) => ({ label: WHY_LABEL[k], value: k, hint: String(byWhy[k]) })),
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">
        Worth a look{" "}
        <span className="font-normal text-muted-foreground">
          {active ? `${shown.length} of ${all.length}` : all.length}
        </span>
      </h2>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-card p-3">
        {/* The lens comes first because it decides what the other three are
            filtering. Changing it re-ranks; the rest only narrow. */}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">for</span>
          <Select value={f.project || "__none"}
                  onValueChange={(v) => set("project", v === "__none" ? "" : v)}>
            <SelectTrigger className="h-8 w-52" aria-label="Rank against a project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">no project - top scores</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <BandGroup label="why" bands={whyBands} value={f.why} onChange={(v) => set("why", v)} />
        {/* Bands counted over THIS pool. The feed's STARS constant carries its
            own hints ("1,380" items above 500), and a feed count under a
            Discovery control is a number that is real and about something
            else. */}
        <BandGroup label="stars" bands={starBands(all)} value={f.starsMin} onChange={(v) => set("starsMin", v)} />
        <SourcePicker sources={sources} selected={f.sources} onToggle={toggleSource}
                      onClear={() => set("sources", [])} />
        {active > 0 && (
          <button onClick={clear} className="text-xs text-link hover:underline">
            clear {active}
          </button>
        )}
      </div>

      {all.length === 0 ? (
        <AbsenceRow
          what="Nothing to suggest."
          reason="No stored item scored above the threshold for any project's declared interests."
        />
      ) : shown.length === 0 ? (
        <AbsenceRow
          what="No suggestion matches those filters."
          reason={`${all.length} were found; the filters above hide all of them. This is a filter result, not an empty pool.`}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((x) => <RecCard key={x.id} rec={x} />)}
        </div>
      )}
    </section>
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
      {(rec.relevance?.matchReason || rec.match_reason) && (
        <p className="mt-2 border-t pt-2 text-[11px] text-dim">
          {rec.relevance?.strategy && WHY_LABEL[rec.relevance.strategy] && (
            <span className="mr-1.5 font-medium text-muted-foreground">
              {WHY_LABEL[rec.relevance.strategy]} -
            </span>
          )}
          {rec.relevance?.matchReason || rec.match_reason}
        </p>
      )}
    </a>
  );
}
