/**
 * README read for repos that declare nothing (2026-11-03).
 *
 * The theme match reads name, description and topics. On 2026-11-03, 24 of 77 inbox
 * repos had no description, and reading their READMEs found 17 useful repos that the
 * theme pass had filed as "no fit". A blank description is UNKNOWN, not "no match":
 * the sensor now reads a bounded README excerpt for those, and the brief matches on it.
 *
 * Run: node --test tests/company-readme.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applyCompanySchema, CompanyStore } = require("../database/company-store");
const { readmeText, fillReadmes, EXCERPT_MAX } = require("../modules/company-readme");

const NOW = "2026-11-03T10:00:00Z";
function store() {
  const db = new Database(":memory:");
  applyCompanySchema(db);
  return new CompanyStore(db);
}
const gh = (name, over = {}) => ({ full_name: name, created_at: "2026-10-20T00:00:00Z", stargazers_count: 500, topics: [], ...over });
const add = (s, name, over = {}, floor = 10) => s.upsert({ org: name.split("/")[0], company: "c", tier: 1, floor, repo: gh(name, over), baseline: true }, NOW);

test("readmeText keeps the words and drops markup, badges, code and links", () => {
  const raw = [
    "# Single Agent Loop Kit",
    "[![CI](https://x/badge.svg)](https://x)",
    "<p align='center'><img src='a.png'></p>",
    "A starter kit that folds **subagents** into one [skill](https://y)-loading loop.",
    "```bash\nnpm install secret-thing\n```",
  ].join("\n");
  const t = readmeText(raw);
  assert.match(t, /Single Agent Loop Kit/);
  assert.match(t, /folds subagents into one skill-loading loop/);
  assert.doesNotMatch(t, /badge|https?:|<img|npm install/);
});

test("readmeText caps the excerpt", () => {
  assert.equal(readmeText("word ".repeat(5000)).length <= EXCERPT_MAX, true);
});

test("needsReadme picks only unruled, above-floor repos with no description that were not read", () => {
  const s = store();
  add(s, "o/blank");
  add(s, "o/described", { description: "a design agent" });
  add(s, "o/below", { stargazers_count: 1 });
  add(s, "o/ruled");
  s.rule("o/ruled", "noise", null, NOW);
  add(s, "o/spaces", { description: "   " });
  assert.deepEqual(s.needsReadme(10).map((r) => r.repo).sort(), ["o/blank", "o/spaces"]);
});

test("fillReadmes records ok / none / error; an error is retried next run, ok and none are not", async () => {
  const s = store();
  ["o/ok", "o/none", "o/err"].forEach((n) => add(s, n));
  const fetchReadme = async (repo) => {
    if (repo === "o/ok") return "# Ok\nA durable harness for coding agents.";
    if (repo === "o/none") return null; // GitHub answered: no README
    throw new Error("HTTP 502");
  };
  const r = await fillReadmes({ store: s, fetchReadme, limit: 10, nowIso: NOW });
  assert.deepEqual(r, { read: 1, none: 1, errors: 1, population: 3 });
  assert.equal(s.get("o/ok").readme_status, "ok");
  assert.match(s.get("o/ok").readme_excerpt, /durable harness for coding agents/);
  assert.equal(s.get("o/none").readme_status, "none");
  assert.equal(s.get("o/err").readme_status, "error");
  assert.deepEqual(s.needsReadme(10).map((x) => x.repo), ["o/err"]);
});

test("fillReadmes reads at most `limit` repos a run", async () => {
  const s = store();
  for (let i = 0; i < 5; i += 1) add(s, `o/r${i}`);
  let calls = 0;
  const r = await fillReadmes({ store: s, fetchReadme: async () => (calls += 1, "text"), limit: 2, nowIso: NOW });
  assert.equal(calls, 2);
  assert.equal(r.read, 2);
  assert.equal(s.needsReadme(10).length, 3);
});

test("a later description from GitHub does not wipe an excerpt already read", () => {
  const s = store();
  add(s, "o/x");
  s.saveReadme("o/x", "ok", "an excerpt", NOW);
  add(s, "o/x", { description: "now described" });
  assert.equal(s.get("o/x").readme_excerpt, "an excerpt");
});
