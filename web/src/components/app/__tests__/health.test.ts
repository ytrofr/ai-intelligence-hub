/**
 * The health pill, and the cross-file guard that would have caught its bug.
 *
 * The defect: the pill asked `status === "ok"`. The server emits "healthy" or
 * "degraded" and never "ok", so the healthy branch was unreachable and a
 * perfectly well hub rendered a warning triangle beside "0 of 24 sources
 * failing". Two files, each correct on its own read, disagreeing about one
 * word - which is why the last cell here reads server.js rather than trusting
 * a constant this side of the wire.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { healthPill, OK_STATUS, DEGRADED_STATUS } from "../health";

const SERVER = path.resolve(__dirname, "../../../../../server.js");

describe("the health pill", () => {
  it("POSITIVE CONTROL: a healthy payload is the ONLY one that reads ok", () => {
    // Without this the suite below could pass with `ok` hardwired false, which
    // is exactly the state the bug left the app in.
    expect(healthPill({ state: "ready", data: { status: OK_STATUS } }).ok).toBe(true);
    expect(healthPill({ state: "ready", data: { status: DEGRADED_STATUS } }).ok).toBe(false);
  });

  it("a healthy hub says healthy, with no warning glyph", () => {
    const r = healthPill({
      state: "ready",
      data: { status: OK_STATUS, sources_failed_last_run: 0, sources_total: 24 },
    });
    expect(r).toEqual({ ok: true, label: "healthy" });
  });

  it("degraded names the count, never the word 'degraded'", () => {
    const r = healthPill({
      state: "ready",
      data: { status: DEGRADED_STATUS, sources_failed_last_run: 1, sources_total: 25 },
    });
    expect(r.ok).toBe(false);
    expect(r.label).toBe("1 of 25 sources failing");
  });

  it("degraded with no counts falls back to the status word, not to a number", () => {
    // An invented 0 here would claim nothing is failing, which is the one
    // thing we do not know.
    expect(healthPill({ state: "ready", data: { status: DEGRADED_STATUS } }).label)
      .toBe(DEGRADED_STATUS);
  });

  it("loading and error are their own states, neither of them ok", () => {
    expect(healthPill({ state: "loading" })).toEqual({ ok: false, label: "checking…" });
    expect(healthPill({ state: "error", error: { message: "boom" } }))
      .toEqual({ ok: false, label: "unreachable" });
  });

  it("an unknown status is not ok and says so honestly", () => {
    expect(healthPill({ state: "ready", data: { status: "wat" } }))
      .toEqual({ ok: false, label: "wat" });
  });

  it("THE GUARD: server.js emits exactly the two words this file branches on", () => {
    const src = readFileSync(SERVER, "utf8");
    const line = src.split("\n").find((l) => l.includes("status:") && l.includes("degraded"));
    expect(line, "server.js no longer has a health status line this test can read").toBeTruthy();
    // Both literals, on the server's own line. A rename either side reds here
    // rather than silently restoring a permanent warning triangle.
    expect(line).toContain(`"${OK_STATUS}"`);
    expect(line).toContain(`"${DEGRADED_STATUS}"`);
  });
});
