/**
 * Company sensor (2026-11-03). The audit's measurement this guards: of 103 repos big
 * companies created Jul-Nov 2026, the hub ever saw 35, and none of the 13 seen in the
 * last 5 weeks reached a digest. A company's repo list is a COMPLETE population, so
 * reading it directly - not sampling trending/search - is what makes recall 100%.
 *
 * Run: node --test tests/company-orgs.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { applyCompanySchema, CompanyStore } = require("../database/company-store");
const { decideRepo, flattenRegistry, runCompanySensor } = require("../modules/company-orgs");

const NOW = new Date("2026-11-03T12:00:00Z");
const fresh = () => {
  const db = new Database(":memory:");
  applyCompanySchema(db);
  return new CompanyStore(db);
};
const gh = (over = {}) => ({
  full_name: "google-research/harness2",
  created_at: "2026-10-06T10:00:00Z",
  stargazers_count: 22206,
  fork: false,
  archived: false,
  description: "Recursive agent harnessing",
  language: "Python",
  ...over,
});
const ORG = { org: "google-research", company: "google", tier: 1, floor: 10 };

test("decideRepo: records a new repo inside the window, flags the floor", () => {
  const d = decideRepo(gh(), { ...ORG, now: NOW, trackDays: 60 });
  assert.deepEqual(d, { record: true, aboveFloor: true });
  assert.deepEqual(decideRepo(gh({ stargazers_count: 3 }), { ...ORG, now: NOW, trackDays: 60 }), { record: true, aboveFloor: false });
});

test("decideRepo: forks and archived repos are not company releases", () => {
  assert.equal(decideRepo(gh({ fork: true }), { ...ORG, now: NOW, trackDays: 60 }).record, false);
  assert.equal(decideRepo(gh({ archived: true }), { ...ORG, now: NOW, trackDays: 60 }).record, false);
});

test("decideRepo: older than the window is not recorded", () => {
  assert.equal(decideRepo(gh({ created_at: "2026-08-01T00:00:00Z" }), { ...ORG, now: NOW, trackDays: 60 }).record, false);
});

test("store: a repo below the floor is kept, and enters the inbox the day it crosses", () => {
  const s = fresh();
  s.upsert({ ...ORG, repo: gh({ stargazers_count: 4 }), baseline: false }, "2026-10-07T00:00:00Z");
  assert.equal(s.inbox().length, 0, "below the floor: recorded, not in the inbox");
  assert.equal(s.count(), 1);
  s.upsert({ ...ORG, repo: gh({ stargazers_count: 900 }), baseline: false }, "2026-10-08T00:00:00Z");
  const inbox = s.inbox();
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].floor_crossed_at, "2026-10-08T00:00:00Z");
  // crossing is stamped once: later growth never moves it
  s.upsert({ ...ORG, repo: gh({ stargazers_count: 22206 }), baseline: false }, "2026-10-19T00:00:00Z");
  assert.equal(s.inbox()[0].floor_crossed_at, "2026-10-08T00:00:00Z");
  assert.equal(s.inbox()[0].stars, 22206);
});

test("store: an inbox item stays until it is RULED - it never ages out", () => {
  const s = fresh();
  s.upsert({ ...ORG, repo: gh(), baseline: false }, "2026-10-08T00:00:00Z");
  assert.equal(s.inbox().length, 1);
  assert.throws(() => s.rule("google-research/harness2", "maybe"), /state/);
  s.rule("google-research/harness2", "watch", "borrow the blind picker", "2026-10-16T00:00:00Z");
  assert.equal(s.inbox().length, 0);
  assert.equal(s.get("google-research/harness2").state, "watch");
  assert.throws(() => s.rule("no/such", "skip"), /not in the company inbox/);
});

test("store: crossedSince returns what entered the inbox in a window, baseline apart", () => {
  const s = fresh();
  s.upsert({ ...ORG, repo: gh(), baseline: true }, "2026-11-03T00:00:00Z");
  s.upsert({ ...ORG, repo: gh({ full_name: "google-research/new-one" }), baseline: false }, "2026-11-04T00:00:00Z");
  const w = s.crossedSince("2026-11-01T00:00:00Z");
  assert.deepEqual(w.map((r) => [r.repo, r.baseline]), [["google-research/harness2", 1], ["google-research/new-one", 0]]);
});

test("flattenRegistry: every org carries its company, tier and floor; a duplicate org is an error", () => {
  const reg = {
    defaults: { track_days: 60 },
    tiers: { 1: { floor: 10 }, 2: { floor: 25 } },
    companies: [
      { id: "google", tier: 1, orgs: ["google", "google-research"] },
      { id: "nvidia", tier: 2, orgs: ["NVIDIA"] },
    ],
  };
  assert.deepEqual(flattenRegistry(reg).map((o) => [o.org, o.company, o.floor]), [
    ["google", "google", 10],
    ["google-research", "google", 10],
    ["NVIDIA", "nvidia", 25],
  ]);
  assert.throws(() => flattenRegistry({ ...reg, companies: [...reg.companies, { id: "x", tier: 1, orgs: ["google"] }] }), /twice/);
  assert.throws(() => flattenRegistry({ ...reg, companies: [{ id: "y", tier: 9, orgs: ["a"] }] }), /tier 9/);
});

const fakeLister = (pages) => async (org) => {
  if (pages[org] instanceof Error) throw pages[org];
  return pages[org] || [];
};

test("runCompanySensor: first sight of an org is a BASELINE; later new repos are not", async () => {
  const s = fresh();
  const orgs = [ORG];
  await runCompanySensor({ orgs, store: s, listRepos: fakeLister({ "google-research": [gh()] }), now: NOW, trackDays: 60, baselineDays: 60 });
  assert.equal(s.get("google-research/harness2").baseline, 1);
  const later = new Date("2026-11-04T12:00:00Z");
  await runCompanySensor({
    orgs,
    store: s,
    listRepos: fakeLister({ "google-research": [gh({ full_name: "google-research/brand-new", created_at: "2026-11-04T08:00:00Z", stargazers_count: 15 }), gh()] }),
    now: later,
    trackDays: 60,
    baselineDays: 60,
  });
  assert.equal(s.get("google-research/brand-new").baseline, 0);
});

test("runCompanySensor: one org failing is PARTIAL with its name; all failing throws", async () => {
  const s = fresh();
  const orgs = [ORG, { org: "NVIDIA", company: "nvidia", tier: 2, floor: 25 }];
  const r = await runCompanySensor({
    orgs,
    store: s,
    listRepos: fakeLister({ "google-research": [gh()], NVIDIA: new Error("HTTP 502") }),
    now: NOW,
    trackDays: 60,
    baselineDays: 60,
  });
  assert.equal(r.checked, 1);
  assert.deepEqual(r.failed, [{ org: "NVIDIA", error: "HTTP 502" }]);
  await assert.rejects(
    runCompanySensor({ orgs, store: s, listRepos: fakeLister({ "google-research": new Error("x"), NVIDIA: new Error("y") }), now: NOW, trackDays: 60, baselineDays: 60 }),
    /every org failed/
  );
});

test("REPLAY: the audit's missed repos all land in the inbox from their org list", async () => {
  // Real rows from the 2026-11-03 recall probe that the hub never saw.
  const missed = [
    ["shadcn-ui/cn", "2026-08-31T00:00:00Z", 1730, 3],
    ["vercel-labs/fx0", "2026-10-19T00:00:00Z", 422, 1],
    ["NVIDIA/spark-local-inference", "2026-10-20T00:00:00Z", 757, 2],
    ["github/lever", "2026-10-25T00:00:00Z", 255, 2],
    ["anthropics/FlashProve", "2026-10-30T00:00:00Z", 226, 1],
  ];
  const s = fresh();
  const orgs = missed.map(([repo, , , tier]) => ({ org: repo.split("/")[0], company: "c", tier, floor: tier === 1 ? 10 : 25 }));
  const pages = Object.fromEntries(missed.map(([repo, created, stars]) => [repo.split("/")[0], [gh({ full_name: repo, created_at: created, stargazers_count: stars })]]));
  await runCompanySensor({ orgs, store: s, listRepos: fakeLister(pages), now: NOW, trackDays: 75, baselineDays: 75 });
  assert.deepEqual(s.inbox().map((r) => r.repo).sort(), missed.map((m) => m[0]).sort());
});
