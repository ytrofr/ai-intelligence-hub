import { Async } from "@/components/app/Loading";
import { DataTable } from "@/components/app/DataTable";
import { StateChip, NoValue } from "@/components/app/StateChip";
import type { Level } from "@/components/app/StateChip";
import { useApi } from "@/lib/useApi";
import { ageDays } from "@/lib/time";

type CellState = "live" | "built" | "absent" | "error" | "unprobed";

interface TrustCell {
  state: CellState;
  reason: string | null;
  note: string | null;
  files: string[];
  prod: { status: string; population?: number; hits?: number; reason?: string; error?: string } | null;
}

interface TrustPayload {
  capabilities: { id: string; name: string; spec: string; control_project: string | null; control_fired: boolean | null }[];
  projects: {
    id: string; trunk: string | null; trunk_sha: string | null; checkout_behind_trunk: string | null;
    prod_status: string | null; probed_at: string | null; cells: Record<string, TrustCell>;
  }[];
  counts: { cells: number; probed: number; by_state: Record<CellState, number> };
  generated_at: string | null;
}

/**
 * Each state has a SHAPE and a WORD, never a colour alone (StateChip enforces it).
 * "error" and "unprobed" share the neutral band but not the word: one means the
 * probe could not judge, the other that it never ran.
 */
const CHIP: Record<CellState, { level: Level; glyph: string; word: string; title: string }> = {
  live: { level: "good", glyph: "●", word: "live", title: "on trunk with a caller, and production rows carry it" },
  built: { level: "mid", glyph: "◐", word: "built", title: "on trunk with a caller; production not proven" },
  absent: { level: "poor", glyph: "○", word: "absent", title: "not on trunk, or nothing calls it" },
  error: { level: "none", glyph: "?", word: "can't tell", title: "the probe could not judge - this is NOT absent" },
  unprobed: { level: "none", glyph: "◇", word: "never probed", title: "no probe has run for this cell" },
};

export function TrustMatrix() {
  const q = useApi<TrustPayload>("/capabilities");
  return (
    <Async query={q} what="the trust matrix">
      {(t) => (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border bg-card p-4">
            <Fig n={t.counts.probed} of={t.counts.cells} label="cells probed" />
            <Fig n={t.counts.by_state.live} label="live" />
            <Fig n={t.counts.by_state.built} label="built, not proven live" />
            <Fig n={t.counts.by_state.absent} label="absent" />
            <Fig n={t.counts.by_state.error} label="can't tell" />
            <div className="self-end text-[11px] text-dim">
              {t.generated_at ? `probed ${ageDays(t.generated_at) ?? 0}d ago` : "never probed"}
            </div>
          </div>

          <DataTable
            columns={[
              {
                key: "capability", header: "Capability", width: "16rem",
                cell: (c) => (
                  <div className="min-w-0">
                    <div className="text-sm">{c.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-dim">
                      {c.id} ·{" "}
                      {c.control_project === null
                        ? "▲ no project has a reference yet"
                        : <>reference {c.control_project} {c.control_fired === false ? "▲ control did not fire" : c.control_fired ? "✓" : ""}</>}
                    </div>
                  </div>
                ),
              },
              ...t.projects.map((p) => ({
                key: p.id,
                header: (
                  <span>
                    <span className="font-mono">{p.id}</span>
                    <span className="mt-0.5 block text-[11px] font-normal text-dim">
                      {p.trunk_sha ? `${p.trunk}@${p.trunk_sha}` : "trunk unknown"}
                    </span>
                  </span>
                ),
                cell: (c: TrustPayload["capabilities"][number]) => {
                  const cell = p.cells[c.id];
                  const chip = CHIP[cell.state];
                  return (
                    <div className="min-w-0">
                      <StateChip level={chip.level} glyph={chip.glyph} word={chip.word}
                                 title={`${chip.title}${cell.reason ? ` - ${cell.reason}` : ""}`} />
                      {cell.reason && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{cell.reason}</div>}
                    </div>
                  );
                },
              })),
            ]}
            rows={t.capabilities}
            rowKey={(c) => c.id}
            empty={{
              what: "No capabilities registered.",
              reason: "~/.claude/capabilities/registry.json lists none, so nothing here could have been probed.",
            }}
            caption={
              <>
                {t.counts.probed} of {t.counts.cells} cells probed. Every cell is read from each
                project's trunk plus, where readable, 7 days of production rows.
              </>
            }
          />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">What each project's cells rest on</h2>
            {t.projects.map((p) => (
              <details key={p.id} className="rounded-lg border bg-card p-3">
                <summary className="cursor-pointer text-sm">
                  <span className="font-mono">{p.id}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    production: {p.prod_status ?? "unknown"} · checkout {p.checkout_behind_trunk ?? "?"} behind trunk (probe reads trunk)
                  </span>
                </summary>
                <ul className="mt-3 space-y-3">
                  {t.capabilities.map((c) => {
                    const cell = p.cells[c.id];
                    return (
                      <li key={c.id} className="text-xs">
                        <div className="font-mono">{c.id} - {CHIP[cell.state].word}</div>
                        {cell.note ? <div className="text-muted-foreground">{cell.note}</div> : <NoValue title="no note">no note</NoValue>}
                        {cell.files.length > 0 && <div className="break-all font-mono text-[11px] text-dim">{cell.files.join(" · ")}</div>}
                        {cell.prod?.status === "ok" && (
                          <div className="text-[11px] text-dim">production 7d: {cell.prod.hits} of {cell.prod.population} rows</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </section>
          <p className="text-xs text-muted-foreground">
            Specs and probes live in ~/.claude/capabilities; re-run with capability-probe.py all.
            "Can't tell" is never read as absent, and a cell nobody probed says so.
          </p>
        </div>
      )}
    </Async>
  );
}

function Fig({ n, of, label }: { n: number; of?: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-lg tabular-nums">{n}{of !== undefined && <span className="text-dim">/{of}</span>}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
    </div>
  );
}
