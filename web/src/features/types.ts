/** The API payloads this app reads. Narrow on purpose - only what is rendered. */

export interface HubSlot {
  id: string;
  instrument: string | null;
  needs: string | null;
  kind: string | null;
  feature: string | null;
  gap: string | null;
  note: string | null;
  unvetted_caveat: string | null;
  runs: number;
  last_ran_at: string | null;
  age_days: number | null;
  candidates: unknown[];
  scored: MatrixRow[];
  best: number | null;
  state: "scored" | "unscored" | "empty";
}

export interface HubProject {
  id: string;
  name: string;
  slots: HubSlot[];
  unslotted: MatrixRow[];
  borrowed: MatrixRow[];
  orphaned: MatrixRow[];
  counts: {
    slots: number;
    slots_empty: number;
    slots_unscored: number;
    slots_never_run: number;
    slots_with_a_gap: number;
    candidates: number;
    slotted: number;
    unslotted: number;
    borrowed: number;
    orphaned: number;
    estimated: number;
    best: number | null;
  };
}

export interface HubPayload {
  projects: HubProject[];
  population: {
    projects: number;
    slots: number;
    slots_empty: number;
    slots_unscored: number;
    candidates: number;
    unslotted: number;
    borrowed: number;
    orphaned: number;
    unknown_projects: string[];
    matrix_rows: number;
    ledger_rows: number;
    hidden: number;
    in_use: number;
  };
  shared: { repo: string; kind: string; projects: string[]; why: string | null }[];
  filtered_to: string | null;
}

export interface MatrixRow {
  repo: string;
  slot?: string;
  total?: number;
  basis?: string;
  why?: string;
  status?: string;
  verdict?: string;
  licence?: string;
  cost_tier?: string;
  effect?: number;
  effort?: number;
  risk?: number;
  impact?: number;
  time?: number;
  fit?: number;
  kind?: string;
  project?: string;
  state?: string;
  note?: string;
  next_action?: string;
  licence_class?: string;
  hardware_fit?: string;
  hardware_mib?: number | null;
  evidence?: string;
  lesson?: string;
  pair?: string;
  next?: string;
  features?: { id: string; label: string }[];
  eval?: unknown;
  eval_freshness?: { ok: boolean; shape: string; runs: number; age_days: number | null };
}

export interface LedgerRow {
  repo: string;
  pkg: string;
  kind: string;
  unresolved: boolean;
  projects: string[];
  radar_projects: string[];
  why: string;
  topic: string;
  verdict: string;
  status: string;
  outcome: string;
  evidence: string;
  lesson: string;
  pair: string;
  eyeballed: string;
  cost_tier: string;
  licence: string;
  slot: string;
}

export interface LedgerPayload {
  rows: LedgerRow[];
  counts: {
    total: number; explained: number; unexplained: number; unresolved: number;
    inUse: number; closed: number; closedWithLesson: number; done: number;
    byKind: Record<string, number>; projects: string[];
  };
  generated_at: string;
}

/** One row of the per-project adoption scorecard (GET /api/adoption-scorecard). */
export interface ScorecardRow {
  repo: string;
  project: string;
  kind: string;
  slot: string | null;
  verdict: string | null;
  status: string;
  state: string;
  measure: "measured" | "estimated" | "not-run";
  bench: { run: string; date: string; result: string } | null;
  bench_date: string | null;
  bench_result: string | null;
  legacy_unbenched: boolean;
  score_total: number | "unscored";
  score_basis: string | null;
  pair: string | null;
  eyeballed: { verb: string | null; at: string | null; raw: string } | null;
  before_after: { before: string; after: string; window: string; date: string } | null;
  telemetry: { project?: string; counters?: string[]; url?: string } | null;
  evidence: string | null;
  lesson: string | null;
  outcome: string | null;
  why: string | null;
  updated_at: string | null;
  next: string;
}

export interface ScorecardCounts {
  rows: number;
  measured: number;
  estimated: number;
  not_run: number;
  legacy_unbenched: number;
  closed: number;
  with_verdict: number;
}

export interface ScorecardPayload {
  generated_at: string;
  population: ScorecardCounts & { projects: number; repos: number };
  projects: { id: string; name: string; counts: ScorecardCounts; rows: ScorecardRow[] }[];
}
