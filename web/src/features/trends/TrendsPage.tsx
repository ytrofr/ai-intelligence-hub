import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { DataTable, type Column } from "@/components/app/DataTable";
import { NoValue, StateChip } from "@/components/app/StateChip";
import { destinationById } from "@/components/app/nav";
import { BandGroup } from "@/features/items/filters/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { compact } from "@/lib/time";
import type { TrendRow, TrendsPayload, TrendStatus, TrendTheme } from "@/features/types";

/**
 * What is gaining stars now, by theme, ranked by velocity.
 *
 * Built by the same server function as the digest's "Trending by theme"
 * section, so the page and the Monday digest cannot disagree. Three honesty
 * rules shape it:
 *
 *  - A repo with no history is NOT a zero. It is listed apart, under "not
 *    ranked yet", with the reason in words.
 *  - A gain read off the GitHub trending page rather than our own snapshots is
 *    marked as such on the row - it is a different instrument.
 *  - Every number travels with its population line in the footer.
 *
 * The one write is "Add to radar as WATCH": an inline confirm (project + why),
 * then the existing POST /api/radar/row. Nothing is ever added automatically.
 */
export function TrendsPage() {
  const d = destinationById("trends")!;
  const [params, setParams] = useSearchParams();
  const theme = params.get("theme") ?? "";
  const period = params.get("period") === "30" ? "30" : "7";
  const minGain = params.get("min_gain") ?? "";
  const ruled = params.get("include_ruled") === "1";

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const qs = new URLSearchParams({ period });
  if (theme) qs.set("theme", theme);
  if (minGain) qs.set("min_gain", minGain);
  if (ruled) qs.set("include_ruled", "1");
  const q = useApi<TrendsPayload>(`/trends?${qs.toString()}`);

  return (
    <PageShell title={d.label} blurb={d.blurb} width="wide">
      <Async query={q} what="the trends">
        {(t) => (
          <TrendsBody
            t={t} theme={theme} period={period} minGain={minGain} ruled={ruled} set={set}
          />
        )}
      </Async>
    </PageShell>
  );
}

function TrendsBody({
  t, theme, period, minGain, ruled, set,
}: {
  t: TrendsPayload; theme: string; period: string; minGain: string; ruled: boolean;
  set: (key: string, value: string) => void;
}) {
  const [adding, setAdding] = useState<TrendRow | null>(null);
  // Rows added this session, so the chip changes without a refetch.
  const [added, setAdded] = useState<Record<string, string>>({});
  const statusOf = (r: TrendRow): TrendStatus =>
    added[r.key] ? { kind: "on-radar", label: `on radar: ${added[r.key]}`, projects: [added[r.key]] } : r.status;

  const themeBands = [
    { label: "all", value: "", hint: theme ? undefined : String(t.population.shown) },
    ...t.themes
      .filter((x) => x.count > 0 || x.id === theme)
      .map((x) => ({ label: x.label, value: x.id, hint: String(x.count) })),
  ];
  const label = (id: string) => t.themes.find((x) => x.id === id)?.label ?? id;
  const gainHeader = `gained (${period}d)`;

  const columns: Column<TrendRow>[] = [
    { key: "rank", header: "#", numeric: true, width: "2.5rem", cell: (r) => r.rank ?? <NoValue /> },
    {
      key: "repo", header: "repo",
      cell: (r) => (
        <div className="min-w-[9rem] max-w-[16rem]">
          <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-link hover:underline">
            {r.repo}
          </a>
          {r.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>}
        </div>
      ),
    },
    {
      key: "themes", header: "themes", secondary: true,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.themes.map(label).join(", ")}</span>,
    },
    { key: "gain", header: gainHeader, numeric: true, cell: (r) => <Gain r={r} /> },
    {
      key: "velocity", header: "velocity", numeric: true, secondary: true,
      cell: (r) => (r.velocity === null ? <NoValue title="no base to divide by" /> : r.velocity.toFixed(1)),
    },
    { key: "stars", header: "stars", numeric: true, cell: (r) => (r.stars === null ? <NoValue /> : compact(r.stars)) },
    {
      key: "age", header: "age", numeric: true, secondary: true,
      cell: (r) => (r.age_days === null
        ? <NoValue title="creation date not fetched for this repo">-</NoValue>
        : `${r.age_days}d`),
    },
    { key: "spark", header: "30d", secondary: true, cell: (r) => <Sparkline points={r.sparkline} /> },
    { key: "status", header: "status", cell: (r) => <StatusChip s={statusOf(r)} /> },
    {
      key: "act", header: "",
      cell: (r) => statusOf(r).kind === "new" ? (
        <Button size="sm" variant="outline" className="h-auto min-h-7 max-w-[6.5rem] whitespace-normal py-1 text-xs leading-tight" onClick={() => setAdding(r)}>
          Add to radar as WATCH
        </Button>
      ) : null,
    },
  ];

  return (
    // w-0 + min-w-full: the page contributes no min-content width upward, so a
    // wide table scrolls inside its own box instead of widening the whole page
    // past the viewport (measured: the 1280px shot cut the filter card's edge).
    <div className="w-0 min-w-full space-y-8">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <BandGroup label="theme" bands={themeBands} value={theme} onChange={(v) => set("theme", v)} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <BandGroup label="window" value={period} onChange={(v) => set("period", v === "7" ? "" : v)}
                     bands={[{ label: "7 days", value: "7" }, { label: "30 days", value: "30" }]} />
          <BandGroup label="min gain" value={minGain} onChange={(v) => set("min_gain", v)}
                     bands={[{ label: "any", value: "" }, { label: "500", value: "500" }, { label: "1k", value: "1000" }, { label: "5k", value: "5000" }]} />
          <BandGroup label="ruled" value={ruled ? "1" : ""} onChange={(v) => set("include_ruled", v)}
                     bands={[{ label: "hide", value: "" }, { label: "show", value: "1", hint: String(t.population.ruled_hidden || "") }]} />
        </div>
      </div>

      {adding && (
        <AddToRadar
          row={adding} themes={t.themes}
          onCancel={() => setAdding(null)}
          onDone={(project) => {
            setAdded((a) => ({ ...a, [adding.key]: project }));
            setAdding(null);
          }}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Ranked by velocity <span className="font-normal text-muted-foreground">{t.rows.length}</span>
        </h2>
        <DataTable
          columns={columns} rows={t.rows} rowKey={(r) => r.key}
          empty={{
            what: "Nothing ranked.",
            reason: t.population.pool === 0
              ? "The trend sources have not stored any repo in the last 14 days - check that gh-trending ran."
              : `${t.population.unranked} repos are in view but none gained ${t.population.gain_floor}+ stars over the window with a base to measure against.`,
          }}
          caption={<>Velocity = gain / sqrt(stars a period ago); a repo needs +{t.population.gain_floor} to rank. <OriginKey /></>}
        />
      </section>

      <Unranked rows={t.unranked} total={t.population.unranked} label={label} />
      <Surged rows={t.surgedThoughKnown} history={t.population.oldest_history_days} />
      <Footer t={t} />
    </div>
  );
}

function Gain({ r }: { r: TrendRow }) {
  if (r.gain === null) return <NoValue title="not enough history yet">no history</NoValue>;
  return (
    <span className="whitespace-nowrap">
      +{r.gain.toLocaleString("en-US")}
      {r.origin === "trending-page" && (
        <span className="ml-1 font-mono text-[10px] text-dim" title="from the GitHub trending page, not our own snapshots">
          ≈page
        </span>
      )}
    </span>
  );
}

function OriginKey() {
  return <span>"≈page" = the gain was read off the GitHub trending page because our own snapshot history is still shorter than the window.</span>;
}

function StatusChip({ s }: { s: TrendStatus }) {
  if (s.kind === "ruled") return <StateChip level="none" glyph="■" word={s.label} />;
  if (s.kind === "on-radar") return <StateChip level="good" glyph="◉" word={s.label} />;
  return <StateChip level="mid" glyph="+" word="new" />;
}

/** Stars over the last 30 days. One reading is a dot, not a line - it says "one day of history". */
function Sparkline({ points }: { points: { day: string; stars: number }[] }) {
  if (points.length === 0) return <NoValue title="no snapshot yet"><span className="whitespace-nowrap text-xs">no history yet</span></NoValue>;
  if (points.length === 1) return <span className="whitespace-nowrap text-xs text-dim" title={`one reading so far: ${points[0].day}`}>1d</span>;
  const w = 64, h = 20;
  const ys = points.map((p) => p.stars);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const x = (i: number) => (i / (points.length - 1)) * (w - 2) + 1;
  const y = (v: number) => (hi === lo ? h / 2 : h - 1 - ((v - lo) / (hi - lo)) * (h - 2));
  return (
    <svg width={w} height={h} role="img" aria-label={`${points.length} readings, ${lo} to ${hi} stars`} className="text-muted-foreground">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points.map((p, i) => `${x(i)},${y(p.stars)}`).join(" ")} />
    </svg>
  );
}

function Unranked({ rows, total, label }: { rows: TrendRow[]; total: number; label: (id: string) => string }) {
  if (total === 0) return null;
  const columns: Column<TrendRow>[] = [
    { key: "repo", header: "repo", cell: (r) => <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-link hover:underline">{r.repo}</a> },
    {
      key: "why", header: "why not ranked",
      cell: (r) => r.origin === "insufficient_history"
        ? <StateChip level="none" word="insufficient history" />
        : <StateChip level="poor" word="below the gain floor" />,
    },
    { key: "gain", header: "gained", numeric: true, cell: (r) => <Gain r={r} /> },
    { key: "stars", header: "stars", numeric: true, cell: (r) => (r.stars === null ? <NoValue /> : compact(r.stars)) },
    { key: "themes", header: "themes", secondary: true, cell: (r) => <span className="text-xs text-muted-foreground">{r.themes.map(label).join(", ")}</span> },
  ];
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Not ranked yet <span className="font-normal text-muted-foreground">{total}{rows.length < total ? ` (first ${rows.length} shown)` : ""}</span>
      </summary>
      <div className="mt-3">
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.key}
                   empty={{ what: "Nothing here.", reason: "Every repo in view is ranked." }} />
      </div>
    </details>
  );
}

function Surged({ rows, history }: { rows: TrendRow[]; history: number | null }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">
        Surged this week though known <span className="font-normal text-muted-foreground">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <AbsenceRow
          what="None."
          reason={history === null || history < 7
            ? `This needs 7 days of our own snapshots; the oldest is ${history ?? 0} days old. Until then it cannot fire, and an empty list is not a quiet week.`
            : "No repo the hub has known for more than 7 days gained max(500, 10% of its stars) in our own snapshots."}
        />
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.key}>
              <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs text-link hover:underline">{r.repo}</a>
              <span className="ml-2 text-muted-foreground">+{r.gain7?.toLocaleString("en-US")} in 7d · known {r.first_seen_days}d</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Footer({ t }: { t: TrendsPayload }) {
  const p = t.population;
  const sources = Object.entries(p.sources).map(([k, v]) => `${k} ${v}`).join(" · ");
  return (
    <footer className="border-t pt-3 text-xs text-muted-foreground">
      Population: pool {p.pool} repos · snapshots today {p.snapshots_today} · oldest history{" "}
      {p.oldest_history_days === null ? "none" : `${p.oldest_history_days} days`} · sources: {sources}
      {p.missing_sources.length > 0 && <> · not running yet: {p.missing_sources.join(", ")}</>}
      {p.other_hidden > 0 && <> · {p.other_hidden} with no theme hidden (see the Other tab)</>}
      {p.ruled_hidden > 0 && <> · {p.ruled_hidden} ruled and hidden</>}
      {p.below_min_gain > 0 && <> · {p.below_min_gain} below the min gain</>}
      {" "}· as of {t.today}
    </footer>
  );
}

/**
 * The inline confirm. Projects come from the row's themes; when none of its
 * themes maps to a project, every radar is offered instead and the form says so.
 */
function AddToRadar({
  row, themes, onCancel, onDone,
}: { row: TrendRow; themes: TrendTheme[]; onCancel: () => void; onDone: (project: string) => void }) {
  const fromThemes = [...new Set(themes.filter((x) => row.themes.includes(x.id)).flatMap((x) => x.projects))];
  const all = useApi<{ projects: { id: string; title: string }[] }>(fromThemes.length ? null : "/radar/projects");
  const options = fromThemes.length
    ? fromThemes
    : all.state === "ready" ? all.data.projects.map((p) => p.id).filter((id) => id !== "example") : [];
  const [project, setProject] = useState("");
  const [why, setWhy] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "saving" } | { kind: "error"; msg: string }>({ kind: "idle" });
  const chosen = project || options[0] || "";

  const submit = async () => {
    setState({ kind: "saving" });
    try {
      await api("/radar/row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: chosen, repo: row.repo, topic: row.themes[0] ?? "general", verdict: "WATCH", why: why.trim() }),
      });
      onDone(chosen);
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  };

  return (
    <section aria-label="Add to radar" className="space-y-3 rounded-lg border border-primary/40 bg-card p-4">
      <h2 className="text-sm font-semibold">
        Add <span className="font-mono">{row.repo}</span> to a radar as WATCH
      </h2>
      {!fromThemes.length && (
        <p className="text-xs text-muted-foreground">None of this repo's themes maps to a project, so every radar is offered.</p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          project
          <Select value={chosen} onValueChange={setProject}>
            <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Project radar">
              <SelectValue placeholder="pick a project" />
            </SelectTrigger>
            <SelectContent>
              {options.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          why (required)
          <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="what it could do for this project" aria-label="Why" />
        </label>
        <div className="flex gap-2">
          <Button size="sm" disabled={!chosen || !why.trim() || state.kind === "saving"} onClick={submit}>
            {state.kind === "saving" ? "Adding..." : "Confirm WATCH"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
      {state.kind === "error" && <AbsenceRow tone="loud" what="The radar refused the row." reason={state.msg} />}
      <p className="text-xs text-dim">Writes one row with status proposed. It does not accept, trial or adopt anything.</p>
    </section>
  );
}
