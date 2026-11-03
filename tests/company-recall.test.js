/**
 * Weekly recall check of the company sensor (2026-11-03). The audit that started this
 * measured 34% recall on big-company repos and none reaching a digest; the sensor fixed
 * the cause, and this check is what would notice if it ever stopped working.
 *
 * Independence: the population comes from GitHub SEARCH (org:X created:>=D), a different
 * endpoint from the org listing the sensor reads. A check built on the sensor's own read
 * would agree with it by construction.
 *
 * Run: node --test tests/company-recall.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { judgeRecall, PLANTED } = require("../modules/company-recall");

const NOW = new Date("2026-11-10T07:00:00Z");
const repo = (name, over = {}) => ({ repo: name, org: name.split("/")[0], company: "c", tier: 1, stars: 100, created_at: "2026-11-05T00:00:00Z", ...over });
const base = (over = {}) => ({
  now: NOW,
  windowDays: 60,
  alarmDays: 14,
  alarmStars: 50,
  orgErrors: [],
  controls: [{ repo: "google-research/harness2", created_at: "2026-10-06T00:00:00Z" }],
  ...over,
});

test("all found, a named control fired, the planted absent repo was judged missing: GREEN", () => {
  const population = [repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z", stars: 22000 }), repo("vercel-labs/fx0")];
  const r = judgeRecall({ ...base(), population, recorded: new Set(["google-research/harness2", "vercel-labs/fx0"]) });
  assert.equal(r.status, "green", JSON.stringify(r.reasons));
  assert.equal(r.population, 2, "the planted repo never enters the reported numbers");
  assert.deepEqual(r.byTier[1], { population: 2, found: 2 });
  assert.equal(r.negative, "PASSED");
  assert.deepEqual(r.controls.map((c) => [c.repo, c.state]), [["google-research/harness2", "FIRED"]]);
});

test("a recent tier-1 repo above the alarm floor that the sensor never recorded is RED, and named", () => {
  const population = [repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z" }), repo("anthropics/new-thing", { stars: 400 })];
  const r = judgeRecall({ ...base(), population, recorded: new Set(["google-research/harness2"]) });
  assert.equal(r.status, "red");
  assert.deepEqual(r.missing.map((m) => m.repo), ["anthropics/new-thing"]);
  assert.match(r.reasons.join(" "), /anthropics\/new-thing/);
});

test("an old or small tier-1 miss, or any tier-2 miss, is reported but not RED", () => {
  const population = [
    repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z" }),
    repo("google/old-one", { created_at: "2026-10-01T00:00:00Z", stars: 900 }),
    repo("google/small", { stars: 20 }),
    repo("NVIDIA/t2", { tier: 2, stars: 5000 }),
  ];
  const r = judgeRecall({ ...base(), population, recorded: new Set(["google-research/harness2"]) });
  assert.equal(r.status, "green", JSON.stringify(r.reasons));
  assert.equal(r.missing.length, 3);
});

test("an org the search could not read makes the week ERROR, never green", () => {
  const population = [repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z" })];
  const r = judgeRecall({ ...base({ orgErrors: [{ org: "openai", error: "HTTP 502" }] }), population, recorded: new Set(["google-research/harness2"]) });
  assert.equal(r.status, "error");
  assert.match(r.reasons.join(" "), /openai/);
});

test("controls: EXPIRED outside the window, ABSENT when search did not return it; no live control is RED", () => {
  const population = [repo("vercel-labs/fx0")];
  const r = judgeRecall({
    ...base({ controls: [{ repo: "google-research/harness2", created_at: "2026-08-01T00:00:00Z" }, { repo: "vercel-labs/json-render", created_at: "2026-10-20T00:00:00Z" }] }),
    population,
    recorded: new Set(["vercel-labs/fx0", "vercel-labs/json-render"]),
  });
  assert.deepEqual(r.controls.map((c) => c.state), ["EXPIRED", "ABSENT"]);
  assert.equal(r.status, "red");
  assert.match(r.reasons.join(" "), /no positive control fired/);
});

test("the planted repo must be judged missing - if the matcher calls everything found, RED", () => {
  const population = [repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z" })];
  const everything = { has: () => true };
  const r = judgeRecall({ ...base(), population, recorded: everything });
  assert.equal(r.negative, "FAILED");
  assert.equal(r.status, "red");
  assert.ok(PLANTED.startsWith("zz-"), "the planted owner can never be a real org");
});

test("names compare case-insensitively (GitHub logins are)", () => {
  const population = [repo("Google-Research/Harness2", { created_at: "2026-10-06T00:00:00Z" })];
  const r = judgeRecall({ ...base(), population, recorded: new Set(["google-research/harness2"]) });
  assert.equal(r.status, "green", JSON.stringify(r.reasons));
});

test("a repo search returns from the window's first DAY but before its exact start is outside, not a miss", () => {
  // windowStart = 2026-11-10T07:00Z - 60 d = 2026-09-11T07:00Z
  const population = [repo("google-research/harness2", { created_at: "2026-10-06T00:00:00Z" }), repo("anthropics/edge", { created_at: "2026-09-11T03:00:00Z", stars: 1300 })];
  const r = judgeRecall({ ...base({ alarmDays: 90 }), population, recorded: new Set(["google-research/harness2"]) });
  assert.equal(r.status, "green", JSON.stringify(r.reasons));
  assert.equal(r.population, 1);
  assert.equal(r.outside_window, 1);
  assert.deepEqual(r.missing, []);
});
