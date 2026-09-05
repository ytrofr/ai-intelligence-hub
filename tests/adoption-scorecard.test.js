const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { buildScorecard } = require("../modules/adoption-scorecard");
const { BENCH_OK, TELEMETRY_OK, BEFORE_AFTER_OK } = require("./fixtures/adoption");

/**
 * The per-project ADOPTION SCORECARD: for one project, every candidate it ever
 * ruled on, with what was MEASURED on that project's own data, what was only
 * ESTIMATED, what was never run, the operator's verdict, and the lesson.
 *
 * Operator, 2026-09-05: "measure everything per project before we adopt so we
 * base it on measure and data and insights and not guess." This page is the
 * "insights" half: read off the radar rows, never typed twice.
 *
 * It reads RAW radar rows (one file per project), not the merged ledger row, so
 * a repo benched by project A can never show A's number under project B.
 */

const PROJECTS = [
  { id: "apollo", name: "Apollo" },
  { id: "hermes", name: "Hermes" },
];

const estimated = { effort: 2, effect: 3, time: 1, impact: 2, risk: 2, basis: "estimated", note: "guess" };
const measured = { ...estimated, basis: "measured" };
const PAIR = "http://localhost:8776/?session=t#c1";

const row = (over) => ({ repo: "x/y", topic: "t", verdict: "ADOPT", status: "proposed", why: "w", ...over });
const find = (sc, pid, repo) => sc.projects.find((p) => p.id === pid).rows.find((r) => r.repo === repo);

// --- the law: one bench per project --------------------------------------------

test("a repo benched on apollo and not on hermes reads measured on apollo and not-run on hermes", () => {
  const sc = buildScorecard({
    radarRows: [
      row({ project: "apollo", status: "accepted", bench: BENCH_OK, score: measured, evidence: "apollo@3f9a12c" }),
      row({ project: "hermes", status: "proposed" }),
    ],
    projects: PROJECTS,
  });
  const a = find(sc, "apollo", "x/y");
  const h = find(sc, "hermes", "x/y");
  assert.equal(a.measure, "measured");
  assert.deepEqual(a.bench, BENCH_OK);
  assert.equal(h.measure, "not-run");
  assert.equal(h.bench, null, "hermes never ran it: null, never apollo's bench");
  assert.equal(h.score_total, "unscored", "and never apollo's score");
});

// --- the three measure states, and their population accounting ------------------

test("measured / estimated / not-run partition every row exactly once", () => {
  const sc = buildScorecard({
    radarRows: [
      row({ repo: "a/measured", project: "apollo", bench: BENCH_OK, score: measured, status: "trial", evidence: "apollo@1234567" }),
      row({ repo: "a/estimated", project: "apollo", score: estimated }),
      row({ repo: "a/bare", project: "apollo" }),
      row({ repo: "a/legacy", project: "apollo", status: "accepted" }),
    ],
    projects: PROJECTS,
    project: "apollo",
  });
  const p = sc.projects[0];
  assert.equal(p.rows.length, 4);
  assert.equal(p.counts.measured, 1);
  assert.equal(p.counts.estimated, 1);
  assert.equal(p.counts.not_run, 2);
  assert.equal(p.counts.measured + p.counts.estimated + p.counts.not_run, p.rows.length, "the denominator is the row count");
  assert.equal(sc.population.rows, 4);
  assert.equal(sc.population.measured + sc.population.estimated + sc.population.not_run, sc.population.rows);
});

test("a score claiming basis=measured with NO bench is not measured — the bench is the measurement", () => {
  // The store refuses basis=measured without evidence, but a hand-edited file
  // can carry one. The page must not believe the claim over the artifact.
  const sc = buildScorecard({
    radarRows: [row({ project: "apollo", score: measured })],
    projects: PROJECTS,
  });
  assert.equal(find(sc, "apollo", "x/y").measure, "estimated");
});

// --- the debt the law was written against ---------------------------------------

test("accepted or trial with no bench is flagged legacy_unbenched: 'run it or drop it'", () => {
  const sc = buildScorecard({
    radarRows: [
      row({ repo: "a/legacy-accepted", project: "apollo", status: "accepted" }),
      row({ repo: "a/legacy-trial", project: "apollo", status: "trial" }),
      row({ repo: "a/proposed", project: "apollo", status: "proposed" }),
      row({ repo: "a/benched", project: "apollo", status: "accepted", bench: BENCH_OK }),
    ],
    projects: PROJECTS,
  });
  const p = sc.projects.find((x) => x.id === "apollo");
  assert.equal(p.counts.legacy_unbenched, 2);
  assert.equal(find(sc, "apollo", "a/legacy-accepted").legacy_unbenched, true);
  assert.equal(find(sc, "apollo", "a/legacy-accepted").next, "run it or drop it");
  assert.equal(find(sc, "apollo", "a/legacy-trial").legacy_unbenched, true);
  assert.equal(find(sc, "apollo", "a/proposed").legacy_unbenched, false, "proposing is free; only a taken decision owes a bench");
  assert.equal(find(sc, "apollo", "a/benched").legacy_unbenched, false);
  assert.equal(sc.population.legacy_unbenched, 2);
});

test("legacy rows sort FIRST — the debt is the point of the page", () => {
  const sc = buildScorecard({
    radarRows: [
      row({ repo: "a/zz-benched", project: "apollo", status: "accepted", bench: BENCH_OK }),
      row({ repo: "a/aa-proposed", project: "apollo" }),
      row({ repo: "a/mm-legacy", project: "apollo", status: "accepted" }),
    ],
    projects: PROJECTS,
    project: "apollo",
  });
  assert.equal(sc.projects[0].rows[0].repo, "a/mm-legacy");
});

// --- honest values -------------------------------------------------------------

test("absent fields are null or 'unscored', never '' or 0 dressed as data", () => {
  const sc = buildScorecard({ radarRows: [row({ project: "apollo" })], projects: PROJECTS });
  const r = find(sc, "apollo", "x/y");
  assert.equal(r.bench, null);
  assert.equal(r.before_after, null);
  assert.equal(r.telemetry, null);
  assert.equal(r.eyeballed, null);
  assert.equal(r.pair, null);
  assert.equal(r.lesson, null);
  assert.equal(r.evidence, null);
  assert.equal(r.score_total, "unscored");
  assert.equal(r.bench_date, null);
});

test("the operator's verdict is parsed into verb + date, and kept verbatim", () => {
  const sc = buildScorecard({
    radarRows: [row({ project: "apollo", status: "accepted", bench: BENCH_OK, pair: PAIR, eyeballed: "adopt 2026-08-17T09:46:07Z" })],
    projects: PROJECTS,
  });
  const r = find(sc, "apollo", "x/y");
  assert.deepEqual(r.eyeballed, { verb: "adopt", at: "2026-08-17T09:46:07Z", raw: "adopt 2026-08-17T09:46:07Z" });
  assert.equal(r.pair, PAIR);
});

// --- state reuses the ledger's derivation, never a second copy -------------------

test("state comes from the ledger's deriveState: done with all three is done, without is done-unseen", () => {
  const full = row({ repo: "a/full", project: "apollo", status: "done", bench: BENCH_OK, telemetry: TELEMETRY_OK, before_after: BEFORE_AFTER_OK, evidence: "apollo@3f9a12c", lesson: "none - x", pair: PAIR, eyeballed: "adopt 2026-09-04T11:42Z" });
  const bare = row({ repo: "a/bare-done", project: "apollo", status: "done", evidence: "apollo@3f9a12c", lesson: "none - x" });
  const acc = row({ repo: "a/acc", project: "apollo", status: "accepted" });
  const sc = buildScorecard({ radarRows: [full, bare, acc], projects: PROJECTS, project: "apollo" });
  assert.equal(find(sc, "apollo", "a/full").state, "done");
  assert.equal(find(sc, "apollo", "a/bare-done").state, "done-unseen");
  assert.equal(find(sc, "apollo", "a/acc").state, "accepted-without-evidence");
});

// --- next action, one per state -----------------------------------------------

test("next names the one physical step, or '-' for a closed row", () => {
  const sc = buildScorecard({
    radarRows: [
      row({ repo: "a/p", project: "apollo", status: "proposed" }),
      row({ repo: "a/benched-no-pair", project: "apollo", status: "accepted", bench: BENCH_OK }),
      row({ repo: "a/paired-no-verdict", project: "apollo", status: "accepted", bench: BENCH_OK, pair: PAIR }),
      row({ repo: "a/rej", project: "apollo", status: "rejected", evidence: "~/.claude/reports/x.md", lesson: "none - y", pair: PAIR, eyeballed: "reject 2026-09-04T11:42Z" }),
    ],
    projects: PROJECTS,
    project: "apollo",
  });
  assert.equal(find(sc, "apollo", "a/p").next, "bench it on apollo");
  assert.equal(find(sc, "apollo", "a/benched-no-pair").next, "pair it");
  assert.equal(find(sc, "apollo", "a/paired-no-verdict").next, "await the verdict");
  assert.equal(find(sc, "apollo", "a/rej").next, "-");
});

// --- project scoping -------------------------------------------------------------

test("project filter keeps only that project; a configured project with no rows is listed EMPTY, not missing", () => {
  const sc = buildScorecard({ radarRows: [row({ project: "apollo" })], projects: PROJECTS, project: "hermes" });
  assert.equal(sc.projects.length, 1);
  assert.equal(sc.projects[0].id, "hermes");
  assert.equal(sc.projects[0].rows.length, 0);
  assert.equal(sc.population.rows, 0);
});

test("a project that only exists in radar rows (not configured) still appears, named by its id", () => {
  const sc = buildScorecard({ radarRows: [row({ project: "b" })], projects: PROJECTS });
  const o = sc.projects.find((p) => p.id === "b");
  assert.ok(o, "rows nobody configured a project for must not vanish");
  assert.equal(o.name, "b");
  assert.equal(o.rows.length, 1);
});

test("a repo ruled by two projects is two rows, one per project, and counted twice in population.rows", () => {
  const sc = buildScorecard({
    radarRows: [row({ project: "apollo", bench: BENCH_OK, status: "accepted" }), row({ project: "hermes" })],
    projects: PROJECTS,
  });
  assert.equal(sc.population.rows, 2);
  assert.equal(sc.population.repos, 1, "and the repo count says it is one thing");
});

// --- the route ----------------------------------------------------------------

test("GET /api/adoption-scorecard serves the scorecard shape and honours ?project=", async () => {
  const app = express();
  app.use("/api/adoption-scorecard", require("../routes/adoption-scorecard"));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = server.address().port;
    const get = (path) =>
      new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        }).on("error", reject);
      });
    const all = await get("/api/adoption-scorecard");
    assert.equal(all.status, 200);
    assert.ok(all.body.population, "population is the denominator, always present");
    assert.ok(Array.isArray(all.body.projects));
    const one = await get("/api/adoption-scorecard?project=apollo");
    assert.equal(one.status, 200);
    assert.ok(one.body.projects.every((p) => p.id === "apollo"));
  } finally {
    server.close();
  }
});
