const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { RadarStore } = require("../routes/lib/radar-store");

/**
 * The PAIR half of the close gate — operator law, 2026-08-17.
 *
 * `evidence` + `lesson` make a decision reusable by other projects. They do not
 * make it the operator's decision. Four Apollo adoption rows closed on a session's
 * own measurement, with evidence and a lesson attached to every one, and the
 * operator had seen none of them. Verbatim: "i want to see each adoption before
 * and after, to understand its capabilites. this is a must before we adopt
 * anything."
 *
 * So closing now also requires:
 *   pair       the board card carrying BOTH ARMS, which the operator looked at
 *   eyeballed  their verdict + when — `adopt|reject <ISO>`
 *
 * Law: ~/.claude/rules/quality/adoption-needs-an-eyeballed-before-after.md
 *
 * The two tests that carry the most weight are the last two: `not-yet` is not a
 * verdict you may close on, and a verdict that CONTRADICTS the status is refused.
 * Without those, the field is a string a session can write to satisfy itself.
 *
 * Throwaway directory per test — the real radar configs are gitignored and
 * local-only, so a test writing to them would be unrecoverable.
 */
const SHA = "apollo@3f9a12c";
const REPORT = "~/.claude/reports/hub-audit-2026-08-16/spike-trafilatura.md";
const CARD = "http://localhost:8776/?session=216964-1933114#eedef9082c";
const HALL = "http://localhost:8772/batch/design-md-tokens";
const ADOPT = "adopt 2026-08-17T11:42Z";
const REJECT = "reject 2026-08-17T11:42Z";

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-pair-"));
  fs.writeFileSync(
    path.join(dir, "proj.json"),
    JSON.stringify({
      project: "proj",
      audit: [
        { repo: "a/one", topic: "t", verdict: "ADOPT", status: "accepted", why: "a reason", project: "proj" },
        { repo: "a/two", topic: "t", verdict: "SKIP", status: "proposed", why: "another", project: "proj" },
      ],
    }),
  );
  return { store: new RadarStore(dir), dir };
}

const full = (over = {}) => ({ evidence: SHA, lesson: "none - nothing general", pair: CARD, eyeballed: ADOPT, ...over });

// --- the new requirement, both directions ------------------------------------

test("done is REFUSED when evidence and lesson are there but no pair", () => {
  const { store } = tmpStore();
  assert.throws(
    () => store.setStatus("proj", "a/one", "done", { evidence: SHA, lesson: "none - x" }),
    /pair/i,
  );
  assert.equal(store.load("proj").audit[0].status, "accepted", "a refused close must not mutate the row");
});

test("done is REFUSED with a pair but no operator verdict", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ eyeballed: undefined })), /eyeballed/i);
  assert.equal(store.load("proj").audit[0].status, "accepted");
});

test("done WITH all four is accepted, stored and persisted", () => {
  const { store } = tmpStore();
  const row = store.setStatus("proj", "a/one", "done", full());
  assert.equal(row.status, "done");
  assert.equal(row.pair, CARD);
  assert.equal(row.eyeballed, ADOPT);
  const onDisk = store.load("proj").audit[0];
  assert.equal(onDisk.pair, CARD, "and persisted");
  assert.equal(onDisk.eyeballed, ADOPT, "and persisted");
});

// --- shape: a sentence is not a pair -----------------------------------------

test("a sentence is not a pair — it must be a card the operator could open", () => {
  const { store } = tmpStore();
  assert.throws(
    () => store.setStatus("proj", "a/one", "done", full({ pair: "I showed them the numbers" })),
    /pair must be/i,
  );
});

test("a report path is not a pair either — that is what evidence is for", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ pair: REPORT })), /pair must be/i);
});

test("a Visual Hall batch counts as a pair", () => {
  const { store } = tmpStore();
  const row = store.setStatus("proj", "a/one", "done", full({ pair: HALL }));
  assert.equal(row.pair, HALL);
});

test("whitespace satisfies neither new field", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ pair: "   " })), /pair/i);
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ eyeballed: "  " })), /eyeballed/i);
});

// --- shape: the verdict must be a verdict, with a date ------------------------

test("a bare yes is not a verdict — the verb and the timestamp are both required", () => {
  const { store } = tmpStore();
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ eyeballed: "yes" })), /eyeballed must be/i);
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ eyeballed: "adopt" })), /eyeballed must be/i);
});

// --- the two that stop the field being a string a session writes to itself ----

test("not-yet is a real answer but NOT one you may close on", () => {
  const { store } = tmpStore();
  assert.throws(
    () => store.setStatus("proj", "a/one", "done", full({ eyeballed: "not-yet 2026-08-17T11:42Z" })),
    /has not decided/i,
  );
  assert.equal(store.load("proj").audit[0].status, "accepted");
});

test("a verdict that contradicts the status is refused, both ways round", () => {
  const { store } = tmpStore();
  // they said reject; you cannot file that as done
  assert.throws(() => store.setStatus("proj", "a/one", "done", full({ eyeballed: REJECT })), /contradicts/i);
  // and they said adopt; you cannot file that as rejected
  assert.throws(
    () => store.setStatus("proj", "a/one", "rejected", full({ evidence: REPORT, eyeballed: ADOPT })),
    /contradicts/i,
  );
});

test("rejected closes on a reject verdict, with a report as its evidence", () => {
  const { store } = tmpStore();
  const row = store.setStatus("proj", "a/one", "rejected", {
    evidence: REPORT,
    lesson: "quality/measure-impact-not-existence.md",
    pair: CARD,
    eyeballed: REJECT,
  });
  assert.equal(row.status, "rejected");
  assert.equal(row.eyeballed, REJECT);
});

// --- only CLOSING is gated, and re-opening lets go of the verdict -------------

test("accepted and proposed need no pair — only CLOSING does", () => {
  const { store } = tmpStore();
  assert.equal(store.setStatus("proj", "a/two", "accepted").status, "accepted");
  assert.equal(store.setStatus("proj", "a/two", "trial").status, "trial");
});

test("re-opening a closed row drops the verdict with the lesson", () => {
  const { store } = tmpStore();
  store.setStatus("proj", "a/one", "done", full());
  const reopened = store.setStatus("proj", "a/one", "trial");
  assert.equal(reopened.status, "trial");
  assert.ok(!reopened.eyeballed, "a verdict describes a closure that has been reopened");
  assert.ok(!reopened.pair, "and so does the pair it was given on");
});
