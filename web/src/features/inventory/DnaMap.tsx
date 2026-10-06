import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { DataTable } from "@/components/app/DataTable";
import { NoValue } from "@/components/app/StateChip";
import { useApi } from "@/lib/useApi";
import { timeAgo } from "@/lib/time";

type Axis = "loads" | "used" | "proven";

interface Mark {
  state: string;
  glyph: string;
  word: string;
  title: string;
}

interface DnaCell {
  loads: Mark;
  used: Mark;
  proven: Mark;
  na: string | null;
  wire_next: boolean;
  why: string | null;
}

interface DnaAsset {
  id: string;
  name: string;
  kind: string;
  tier: string | null;
  cells: Record<string, DnaCell>;
}

type DnaPayload =
  | { status: "empty"; message: string; reason: string | null }
  | {
      status: "ok";
      generated_at: string | null;
      population: { assets: number; projects: number; cells: number };
      projects: { id: string; trunk: { state: string; behind: number | null; label: string } }[];
      controls: { name: string; result: string; warning: boolean }[];
      wire_next: { project: string; items: { asset: string; name: string; kind: string | null; why: string | null }[]; count: number }[];
      groups: { kind: string; label: string; assets: DnaAsset[] }[];
      legend: Record<Axis, Record<string, { glyph: string; word: string }>>;
      warnings: string[];
    };

const AXES: { key: Axis; letter: string }[] = [
  { key: "loads", letter: "L" },
  { key: "used", letter: "U" },
  { key: "proven", letter: "P" },
];

/**
 * The DNA map: per project, can each shared piece of AI knowledge load there,
 * was it used there, is it proven there - and what to wire next.
 *
 * Every mark is a SHAPE plus a letter, never a colour: the reader cannot tell
 * red from green. "unknown" (?) and "can't tell" (⚠) never share a shape with
 * "no" (○). The wire-next cards come first because they are the action.
 */
export function DnaMap() {
  const q = useApi<DnaPayload>("/dna-map");
  return (
    <Async query={q} what="the DNA map">
      {(m) =>
        m.status === "empty" ? (
          <AbsenceRow tone="loud" what={m.message} reason={m.reason ?? "the map has not been produced on this machine"} />
        ) : (
          <div className="min-w-0 space-y-6">
            <header className="space-y-2 rounded-lg border bg-card p-4 text-xs">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  generated{" "}
                  {m.generated_at
                    ? <span className="font-mono">{m.generated_at} ({timeAgo(m.generated_at) ?? "age unknown"})</span>
                    : <NoValue title="the map carries no timestamp">time unknown</NoValue>}
                </span>
                <span className="font-mono">
                  {m.population.assets} assets × {m.population.projects} projects = {m.population.cells} cells
                </span>
              </div>
              <ul className="flex flex-wrap gap-x-6 gap-y-1">
                {m.controls.map((c) => (
                  <li key={c.name} className={c.warning ? "font-semibold text-warning" : "text-muted-foreground"}>
                    <span aria-hidden className="font-mono">{c.warning ? "▲ " : "✓ "}</span>
                    {c.result} · {c.name}
                  </li>
                ))}
              </ul>
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                {m.projects.map((p) => (
                  <li key={p.id}>
                    <span className="font-mono text-foreground">{p.id}</span>{" "}
                    {p.trunk.state !== "ok" && <span aria-hidden>▲ </span>}
                    {p.trunk.label}
                  </li>
                ))}
              </ul>
              {m.warnings.length > 0 && (
                <ul className="space-y-1 border-t pt-2 text-warning">
                  {m.warnings.map((w) => <li key={w}><span aria-hidden className="font-mono">▲ </span>{w}</li>)}
                </ul>
              )}
            </header>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Wire next</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {m.wire_next.map((w) => (
                  <div key={w.project} className="min-w-0 rounded-lg border bg-card p-3">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-sm">{w.project}</span>
                      <span className="font-mono text-xs text-dim">{w.count}</span>
                    </div>
                    {w.items.length === 0 ? (
                      <NoValue title="no asset in this project meets a wire-next condition">nothing to wire</NoValue>
                    ) : (
                      <ul className="space-y-2">
                        {w.items.map((i) => (
                          <li key={i.asset} className="text-xs">
                            <div className="break-words font-medium">{i.name}</div>
                            <div className="break-words text-muted-foreground">
                              {i.why ?? <NoValue title="the map gave no reason">no reason given</NoValue>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {m.groups.map((g) => (
              <section key={g.kind} className="min-w-0 space-y-2">
                <h2 className="text-sm font-semibold">
                  {g.label} <span className="font-normal text-muted-foreground">{g.assets.length}</span>
                </h2>
                <DataTable
                  columns={[
                    {
                      key: "asset", header: "Asset", width: "16rem",
                      cell: (a: DnaAsset) => (
                        <div className="min-w-[10rem]">
                          <div className="break-words text-sm">{a.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-dim">{a.tier ?? "tier unknown"}</div>
                        </div>
                      ),
                    },
                    ...m.projects.map((p) => ({
                      key: p.id,
                      header: <span className="font-mono">{p.id}</span>,
                      cell: (a: DnaAsset) => <Marks cell={a.cells[p.id]} />,
                    })),
                  ]}
                  rows={g.assets}
                  rowKey={(a) => a.id}
                  empty={{
                    what: `No ${g.label.toLowerCase()} in the map.`,
                    reason: "The producer found none of this kind, so there is nothing to place here.",
                  }}
                />
              </section>
            ))}

            <p className="text-xs text-muted-foreground">
              <span className="font-mono">L</span> loads · <span className="font-mono">U</span> used ·{" "}
              <span className="font-mono">P</span> proven — ● yes/live · ◐ always/built · ○ no/absent · ? unknown ·
              ⚠ can't tell · ◇ never probed · · no probe · – n/a · → wire next. Hover a mark for counts and reasons.
            </p>
          </div>
        )
      }
    </Async>
  );
}

function Marks({ cell }: { cell: DnaCell }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap font-mono text-sm">
      {AXES.map(({ key, letter }) => (
        <span key={key} title={cell[key].title} aria-label={`${key} ${cell[key].word}`}>
          <span className="text-[10px] text-dim">{letter}</span>
          {cell[key].glyph}
        </span>
      ))}
      {cell.wire_next && <span title={`wire next: ${cell.why ?? "no reason given"}`} aria-label="wire next">→</span>}
      {cell.na && <span title={`not applicable: ${cell.na}`} className="text-[10px] text-dim">n/a</span>}
    </div>
  );
}
