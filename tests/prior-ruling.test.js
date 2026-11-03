/**
 * Prior-ruling lookup (2026-11-03). The defect it exists for: an audit recommended
 * shadcn-ui/cn to the operator as a new find, when the operator had made shadcn the UI
 * base everywhere on 2026-09-04 and one project's own memory records `cn` as a plain join by
 * its reviewer's convention. The check matched exact repo names only, read the first
 * 4 KB of a 367-row ledger, and never looked at standing laws, benches or memory.
 * It also missed that promptfoo had been benched on another project on 2026-09-04.
 *
 * Run: node --test tests/prior-ruling.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { findPrior, searchTerms, parseGrep } = require("../modules/prior-ruling");

const ledgerRows = [
  { repo: "shadcn-ui/ui", verdict: "ADOPT", status: "accepted", projects: ["hub", "project-b", "project-a"], per_project: { hub: { state: "accepted" }, "project-b": { state: "accepted" }, "project-a": { state: "proposed" } } },
  { repo: "promptfoo/promptfoo", verdict: "WATCH", status: "proposed", projects: ["project-c"], per_project: { "project-c": { state: "proposed" } } },
  { repo: "google/adk-js", verdict: "ADOPT", status: "proposed", projects: ["project-a"] },
];
const laws = [
  {
    id: "shadcn-ui-base",
    match: { owners: ["shadcn-ui"] },
    law: "shadcn is the UI base on every front end (operator 2026-09-04)",
    per_project: { "project-a": "cn is a plain join by the reviewer's convention C26" },
  },
];
const mentions = parseGrep(
  [
    "/r/reports/bench-project-c-answer-grading-2026-09-04.md:promptfoo",
    "/r/reports/bench-project-c-answer-grading-2026-09-04.md:promptfoo",
    "/r/projects/-home-x-project-a/memory/cn-is-a-plain-join-so-hidden-loses.md:shadcn-ui",
  ].join("\n")
);
const ctx = { ledgerRows, laws, mentions };

test("CONTROL shadcn-ui/cn: ruled by the standing law, family row shown, per-project note carried", () => {
  const p = findPrior("shadcn-ui/cn", ctx);
  assert.equal(p.verdict, "ruled");
  const kinds = p.hits.map((h) => h.kind);
  assert.ok(kinds.includes("law"), "the 09-04 shadcn law must fire");
  assert.ok(kinds.includes("same-org"), "shadcn-ui/ui must show as the family row");
  const law = p.hits.find((h) => h.kind === "law");
  assert.match(law.per_project["project-a"], /C26/);
});

test("CONTROL promptfoo/promptfoo: the ledger row AND the project-c bench report are found", () => {
  const p = findPrior("promptfoo/promptfoo", ctx);
  assert.equal(p.verdict, "ruled");
  assert.ok(p.hits.some((h) => h.kind === "ledger" && /project-c/.test(h.summary)));
  assert.ok(p.hits.some((h) => h.kind === "report" && /bench-project-c-answer-grading/.test(h.ref)));
});

test("a family row alone is RELATED, not ruled - a sibling repo is not a ruling on this one", () => {
  const p = findPrior("google/adk-python-new", { ...ctx, ledgerRows: [ledgerRows[2]] });
  assert.equal(p.verdict, "related");
});

test("our own notes naming the exact repo is DISCUSSED - a ruling may live only in memory (harness2)", () => {
  const notes = parseGrep("/r/projects/-home-x/memory/harness2-eval.md:google-research/harness2\n/r/reports/x.md:google-research/");
  const p = findPrior("google-research/harness2", { mentions: notes });
  assert.equal(p.verdict, "discussed");
  const fam = findPrior("google-research/ui", { mentions: notes }); // short name: searched by family marker
  assert.equal(fam.verdict, "related", "an owner-only mention is family, not a discussion of this repo");
});

test("nothing anywhere is NEW, and the result says what was searched", () => {
  const p = findPrior("someco/brand-new-thing", { ...ctx, searched: { ledger_rows: 3, laws: 1, files: 6000 } });
  assert.equal(p.verdict, "new");
  assert.deepEqual(p.hits, []);
  assert.equal(p.searched.ledger_rows, 3);
});

test("a law scoped to some projects is a CONSTRAINT, shown, never a ruling for everyone", () => {
  const scoped = [{ id: "project-d-vendor-free", match: { owners: ["anthropics"] }, applies_to: ["project-d"], law: "project-d stays free of this vendor" }];
  const p = findPrior("anthropics/new-sdk", { laws: scoped });
  assert.equal(p.verdict, "related");
  assert.deepEqual(p.hits.map((h) => [h.kind, h.applies_to]), [["constraint", ["project-d"]]]);
});

test("searchTerms: full slug always; bare name only when long and not generic", () => {
  assert.deepEqual(searchTerms("promptfoo/promptfoo"), ["promptfoo/promptfoo", "promptfoo"]);
  assert.deepEqual(searchTerms("shadcn-ui/cn"), ["shadcn-ui/cn", "shadcn-ui/"]);
  assert.deepEqual(searchTerms("anthropics/skills"), ["anthropics/skills", "anthropics/"]);
});

test("parseGrep: counts per file per term, tolerates colons in nothing but the separator", () => {
  const m = parseGrep("/a/b.md:promptfoo\n/a/b.md:promptfoo\n/a/c.md:x/y\n\n");
  assert.equal(m.get("promptfoo").get("/a/b.md"), 2);
  assert.equal(m.get("x/y").get("/a/c.md"), 1);
});
