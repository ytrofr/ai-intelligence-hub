const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HEADING,
  routeNews,
  inWindow,
  buildPrompt,
  parseTriage,
  triageProject,
  formatNewsSection,
  buildNewsDigestSection,
} = require("../modules/news-triage");

/**
 * The weekly digest's PLATFORM NEWS section: items from the sources a project
 * declared, sorted for that project into deadline / idea / noise. The failure
 * this guards is the quiet one - an unjudged sunset notice must never fall
 * into "noise" or vanish because the model skipped it.
 */

const APOLLO = { id: "apollo", name: "Apollo", news_sources: ["vendor-blog"], dependencies: ["vendor-sdk"] };
const HERMES = { id: "hermes", name: "Hermes" };
const item = (over) => ({
  source: "vendor-blog",
  title: "t",
  url: "https://example.com/t",
  description: "d",
  published_at: "2026-10-12T00:00:00.000Z",
  ...over,
});

test("routing is declared: only a project's own news_sources reach it", () => {
  const items = [item({ title: "mine" }), item({ title: "other", source: "elsewhere" })];
  const routed = routeNews(items, [APOLLO, HERMES]);
  assert.deepEqual(routed.get("apollo").map((i) => i.title), ["mine"]);
  assert.equal(routed.has("hermes"), false, "a project declaring nothing gets no news list at all");
});

test("window keeps recent dated items, newest first, and drops undated ones", () => {
  const out = inWindow(
    [item({ title: "old", published_at: "2026-09-01T00:00:00Z" }), item({ title: "a", published_at: "2026-10-10T00:00:00Z" }), item({ title: "b" }), item({ title: "nodate", published_at: null })],
    "2026-10-09T00:00:00Z",
  );
  assert.deepEqual(out.map((i) => i.title), ["b", "a"]);
});

test("parse: every item gets exactly one row; gaps and bad rows are CANNOT_JUDGE, never noise", () => {
  const rows = parseTriage(
    JSON.stringify({
      results: [
        { i: 0, verdict: "deadline", so_what: "  v22  sunsets\nsoon " },
        { i: 2, verdict: "maybe", so_what: "x" },
        { i: 9, verdict: "noise", so_what: "out of range" },
      ],
    }),
    3,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { verdict: "deadline", so_what: "v22 sunsets soon" });
  assert.equal(rows[1].verdict, "CANNOT_JUDGE", "a skipped item stays visible");
  assert.equal(rows[2].verdict, "CANNOT_JUDGE", "an invented verdict is not accepted");
});

test("parse: unparseable output marks every item CANNOT_JUDGE with the reason", () => {
  const rows = parseTriage("Sure! Here is the JSON: {", 2);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.verdict === "CANNOT_JUDGE" && /unparseable/.test(r.so_what)));
});

test("a failed model call is CANNOT_JUDGE for every item, carrying the error", async () => {
  const res = await triageProject(APOLLO, [item({}), item({})], {
    callModel: async () => {
      throw new Error("finishReason MAX_TOKENS");
    },
  });
  assert.equal(res.length, 2);
  assert.ok(res.every((r) => r.verdict === "CANNOT_JUDGE" && /MAX_TOKENS/.test(r.so_what)));
});

test("prompt names the project, its deps, every item index, and fences untrusted text", () => {
  const p = buildPrompt(APOLLO, [item({ title: "first" }), item({ title: "second" })]);
  assert.match(p, /Project: Apollo/);
  assert.match(p, /vendor-sdk/);
  assert.match(p, /\[0\] 2026-10-12 \| first/);
  assert.match(p, /\[1\] 2026-10-12 \| second/);
  assert.match(p, /untrusted data/);
  assert.match(p, /date not in excerpt/);
});

test("section: deadlines first, cannot-judge before ideas, noise collapsed to one line", () => {
  const md = formatNewsSection(
    [
      {
        project: APOLLO,
        results: [
          { item: item({ title: "Idea post" }), verdict: "idea", so_what: "could help" },
          { item: item({ title: "Sunset post" }), verdict: "deadline", so_what: "v22 ends" },
          { item: item({ title: "Event post" }), verdict: "noise", so_what: "n/a" },
          { item: item({ title: "Unclear post" }), verdict: "CANNOT_JUDGE", so_what: "triage call failed" },
        ],
      },
    ],
    { sinceDays: 7, model: "m" },
  );
  assert.ok(md.includes(HEADING));
  assert.match(md, /### Apollo — 1 deadline · 1 idea · 1 noise · 1 cannot judge/);
  const at = (s) => md.indexOf(s);
  assert.ok(at("⛔ Deadlines") < at("❓ Cannot judge") && at("❓ Cannot judge") < at("💡 Ideas"));
  assert.match(md, /\[Sunset post\]\(https:\/\/example.com\/t\) · 2026-10-12 — v22 ends/);
  assert.match(md, /_1 noise: Event post_/);
});

test("no key: the section says triage did not run and still lists every item", async () => {
  const db = { getItems: () => [item({ title: "Sunset post" })] };
  const md = await buildNewsDigestSection({ db, projects: [APOLLO], now: Date.parse("2026-10-16T00:00:00Z"), apiKey: "" });
  assert.match(md, /Triage not run: GEMINI_API_KEY not set/);
  assert.match(md, /Sunset post/);
});

test("not configured: no project declares news_sources -> no section at all", async () => {
  const db = {
    getItems: () => {
      throw new Error("must not query");
    },
  };
  assert.equal(await buildNewsDigestSection({ db, projects: [HERMES], apiKey: "k" }), "");
});

test("end to end with an injected model: routed, windowed, triaged, rendered", async () => {
  const seen = [];
  const db = {
    getItems: ({ sources }) => {
      seen.push(...sources);
      return [item({ title: "Sunset post" }), item({ title: "Ancient", published_at: "2025-01-01T00:00:00Z" })];
    },
  };
  const callModel = async (prompt) => {
    assert.doesNotMatch(prompt, /Ancient/, "out-of-window items never reach the model");
    return JSON.stringify({ results: [{ i: 0, verdict: "deadline", so_what: "v22 ends" }] });
  };
  const md = await buildNewsDigestSection({ db, projects: [APOLLO, HERMES], now: Date.parse("2026-10-16T00:00:00Z"), callModel, model: "m" });
  assert.deepEqual(seen, ["vendor-blog"]);
  assert.match(md, /### Apollo — 1 deadline · 0 idea · 0 noise · 0 cannot judge/);
  assert.doesNotMatch(md, /### Hermes/);
});

test("deadline floor: a title naming an end raises idea and CANNOT_JUDGE to deadline", () => {
  const { applyDeadlineFloor } = require("../modules/news-triage");
  for (const title of ["Google Ads API Release and Sunset Schedules", "v22 sunset reminder", "Deprecating the v1 endpoint", "Shutdown of model X", "Retiring legacy reports", "End-of-life notice"]) {
    for (const verdict of ["idea", "CANNOT_JUDGE"]) {
      assert.equal(applyDeadlineFloor({ title }, { verdict, so_what: "s" }).verdict, "deadline", `${title} / ${verdict}`);
    }
  }
});

test("deadline floor never lowers, and leaves ordinary titles to the model", () => {
  const { applyDeadlineFloor } = require("../modules/news-triage");
  assert.deepEqual(applyDeadlineFloor({ title: "Announcing v26" }, { verdict: "noise", so_what: "s" }), { verdict: "noise", so_what: "s" });
  assert.deepEqual(applyDeadlineFloor({ title: "Announcing v26" }, { verdict: "deadline", so_what: "s" }), { verdict: "deadline", so_what: "s" });
  assert.deepEqual(
    applyDeadlineFloor({ title: "Deprecating Structured Data Files v9" }, { verdict: "noise", so_what: "not our product" }),
    { verdict: "noise", so_what: "not our product" },
    "noise means 'not ours' - a title word cannot overrule it (live miss 2026-10-16)",
  );
});

test("triage applies the floor: the live miss (sunset post filed as idea) comes out deadline", async () => {
  const res = await triageProject(APOLLO, [item({ title: "Google Ads API Release and Sunset Schedules for 2026-2027" })], {
    callModel: async () => JSON.stringify({ results: [{ i: 0, verdict: "idea", so_what: "faster release cadence" }] }),
  });
  assert.equal(res[0].verdict, "deadline");
  assert.match(res[0].so_what, /model said idea/);
});
