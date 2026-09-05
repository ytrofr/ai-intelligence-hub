/**
 * What the sidebar's health pill says, as a pure function.
 *
 * It lives outside the component for one reason: the component read
 * `status === "ok"` for two weeks and the server has only ever emitted
 * "healthy" or "degraded", so a healthy hub wore a warning triangle above the
 * words "0 of 24 sources failing" - a fault marker on top of a sentence saying
 * there is no fault. Nothing caught it because the pill had no test at all,
 * and a string compared against a value it can never equal looks correct on
 * every read.
 *
 * health.test.ts also reads server.js and asserts these two literals are the
 * ones it emits, so a rename on EITHER side reds instead of silently going
 * back to a permanent warning.
 */

/** The server's own vocabulary - server.js's /api/health. */
export const OK_STATUS = "healthy";
export const DEGRADED_STATUS = "degraded";

export interface HealthPayload {
  status?: string;
  sources_failed_last_run?: number;
  sources_total?: number;
}

export type HealthState =
  | { state: "loading" }
  | { state: "error"; error: { message: string } }
  | { state: "ready"; data: HealthPayload };

/**
 * `ok` drives the glyph, `label` the words. Both come from the same read, so
 * the marker and the sentence cannot disagree - which is exactly what they did.
 */
export function healthPill(health: HealthState): { ok: boolean; label: string } {
  if (health.state === "loading") return { ok: false, label: "checking…" };
  if (health.state === "error") return { ok: false, label: "unreachable" };

  const { status, sources_failed_last_run: bad, sources_total: all } = health.data;
  if (status === OK_STATUS) return { ok: true, label: "healthy" };

  // "degraded" on its own sends the reader to the logs, which is where they
  // were going anyway. The count is the whole reason to render this at all.
  const label =
    typeof bad === "number" && typeof all === "number"
      ? `${bad} of ${all} sources failing`
      : (status ?? "unknown");
  return { ok: false, label };
}
