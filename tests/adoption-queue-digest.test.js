const test = require("node:test");
const assert = require("node:assert/strict");

const { buildScorecard } = require("../modules/adoption-scorecard");
const { formatAdoptionQueueSection, HEADING } = require("../modules/adoption-queue-digest");
const { BENCH_OK } = require("./fixtures/adoption");

/**
 * The weekly digest's ADOPTION QUEUE: per project, what to run next, read off
 * the scorecard so the digest and the page cannot disagree.
 */

const PROJECTS = [
  { id: "apollo", name: "Apollo" },
  { id: "hermes", name: "Hermes" },
];
const measured = { effort: 2, effect: 3, time: 1, impact: 2, risk: 2, basis: "measured", note: "ran" };
const row = (over) => ({ repo: "x/y", topic: "t", verdict: "ADOPT", status: "proposed", why: "w", ...over });
const section = (radarRows, opts) => formatAdoptionQueueSection(buildScorecard({ radarRows, projects: PROJECTS }), opts);

test("the three buckets, in attention order, each carrying its own row", () => {
  const md = section([
    row({ repo: "a/debt", project: "apollo", status: "accepted", updated_at: "2026-08-17T10:00:00Z" }),
    row({ repo: "a/measured", project: "apollo", status: "trial", bench: BENCH_OK, score: measured, evidence: "apollo@1234567" }),
    row({ repo: "a/ready", project: "apollo", why: "cheap palette on the screenshot branch" }),
    row({ repo: "a/watch", project: "apollo", verdict: "WATCH" }),
  ]);
  const at = (s) => md.indexOf(s);
  assert.ok(at("⛔ Run it or drop it") < at("👀 Measured"), "debt before measured");
  assert.ok(at("👀 Measured") < at("▶ Ready to bench"), "measured before ready");
  assert.match(md, /a\/debt — accepted · ADOPT · last touched 2026-08-17/);
  assert.match(md, new RegExp(`a/measured — bench ${BENCH_OK.date}: `));
  assert.match(md, /a\/ready — cheap palette/);
  assert.match(md, /1 more proposed \(WATCH\/SKIP or unscored\): backlog, not queued/);
  assert.doesNotMatch(md, /a\/watch/, "a WATCH row with nothing run is a count, never a line");
});

test("one bench per project: apollo's bench is never quoted under hermes", () => {
  const md = section([
    row({ project: "apollo", status: "trial", bench: BENCH_OK, score: measured, evidence: "apollo@1234567" }),
    row({ project: "hermes", status: "proposed" }),
  ]);
  const hermes = md.slice(md.indexOf("### Hermes"));
  assert.match(md.slice(md.indexOf("### Apollo"), md.indexOf("### Hermes")), /👀 Measured/);
  assert.doesNotMatch(hermes, /👀 Measured/);
  assert.match(hermes, /▶ Ready to bench[\s\S]*x\/y — w/);
});

test("a project with nothing on its radar, and one with everything closed, both say so", () => {
  const md = section([
    row({ project: "apollo", status: "rejected", evidence: "reports/x.md", lesson: "skills/adopt/SKILL.md" }),
  ]);
  assert.match(md, /### Apollo[\s\S]*_nothing open — 1 closed_/);
  assert.match(md, /### Hermes[\s\S]*_no candidates on this project's radar_/);
});

test("long lists are capped and the cap is stated; the heading and population line are always present", () => {
  const rows = Array.from({ length: 9 }, (_, i) => row({ repo: `a/r${i}`, project: "apollo", status: "accepted" }));
  const md = section(rows, { perList: 3 });
  assert.ok(md.startsWith(`\n${HEADING}\n`));
  assert.match(md, /> 9 rows across 2 projects · 0 measured on their own data/);
  assert.match(md, /⛔ Run it or drop it[^\n]*\(9\)/);
  assert.equal((md.match(/^- a\/r\d/gm) || []).length, 3);
  assert.match(md, /… 6 more on the scorecard/);
});

test("a repo name cannot open its own link", () => {
  const md = section([row({ repo: "evil/x](http://bad", project: "apollo", status: "accepted" })]);
  assert.doesNotMatch(md, /\]\(http:\/\/bad/);
});
