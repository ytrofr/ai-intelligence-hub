/**
 * Monday brief (2026-11-03): the one page read every week, at the TOP of the digest.
 * The digest it heads was 810 lines on 2026-11-03; nobody reads that, so nothing in it
 * gets adopted. The brief must stay <= 40 lines whatever the week holds, and must never
 * present as new a repo that was already ruled or discussed (the shadcn-ui/cn defect).
 *
 * Run: node --test tests/monday-brief.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { formatBrief, isDeadline, deadlineLine, rankDeadlines, modelTokens, pickTop, grepUses, fitRepo, assembleBrief, MAX_LINES } = require("../modules/monday-brief");

const WINDOW = { since: "2026-11-03T17:17:00.000Z", until: "2026-11-10T07:00:00.000Z", days: 6.6 };
const row = (repo, over = {}) => ({ repo, company: repo.split("/")[0], stars: 100, baseline: 0, floor_crossed_at: "2026-11-05T00:00:00Z", description: "", topics: "[]", ...over });
const prior = (verdict, hits = []) => ({ verdict, hits });

test("isDeadline: an end named in the title, or in the body of a dated release note", () => {
  assert.ok(isDeadline({ title: "Google Ads API v22 sunset reminder", description: "" }));
  assert.ok(isDeadline({ title: "Retiring GPT-4o, GPT-4.1 in ChatGPT", description: "" }));
  assert.ok(isDeadline({ title: "October 09, 2026", description: "Announcement Sale of Gemini Code Assist subscriptions is ending. Starting October 9" }));
  assert.ok(!isDeadline({ title: "Dependabot now supports Python 3.15", description: "You can now upgrade" }));
  assert.ok(!isDeadline({ title: "October 10, 2026", description: "a".repeat(900) + " deprecated" }), "only the head of the body counts");
  assert.ok(!isDeadline({ title: "Q3 2026 Internet disruption summary", description: "power failures, natural disasters, and government shutdowns" }), "a blog body never counts");
});

test("deadlineLine: a dated release note shows the sentence that names the end", () => {
  assert.equal(deadlineLine({ title: "Google Ads API v22 sunset reminder", description: "x" }), "Google Ads API v22 sunset reminder");
  assert.equal(
    deadlineLine({ title: "October 09, 2026", description: "  Announcement Sale of Gemini Code Assist subscriptions is ending. Starting October 9, new ones can no longer be bought." }),
    "October 09, 2026: Announcement Sale of Gemini Code Assist subscriptions is ending."
  );
});

test("rankDeadlines: touching our code first, then a title-named end, then newest", () => {
  const d = (id, over) => ({ title: id, uses: [], titleMatch: false, date: "2026-10-01", ...over });
  const order = rankDeadlines([
    d("body-new", { date: "2026-11-01" }),
    d("title-old", { titleMatch: true, date: "2026-09-01" }),
    d("ours", { uses: [{ project: "Apollo", files: 3 }], date: "2026-08-01" }),
    d("unknown-use", { uses: [{ project: "Apollo", files: null }], date: "2026-10-30" }),
  ]).map((x) => x.title);
  assert.deepEqual(order, ["ours", "title-old", "body-new", "unknown-use"]);
});

test("modelTokens: model ids from vendor prose, lower-cased, unique", () => {
  assert.deepEqual(modelTokens("Retiring GPT-4o, GPT-4.1, GPT-4.1 mini and gemini-3.5-flash-lite; Gemini 2.5 Flash."), ["gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gemini-3.5-flash-lite", "gemini-2.5-flash"]);
  assert.deepEqual(modelTokens("Structured Data Files v9"), []);
});

test("pickTop: never a ruled or discussed repo, never one a project's constraint forbids", () => {
  const inbox = [row("a/ruled", { stars: 900 }), row("b/discussed", { stars: 800 }), row("anthropics/kit", { stars: 700 }), row("c/fresh", { stars: 50 }), row("d/family", { stars: 40 })];
  const priors = new Map([
    ["a/ruled", prior("ruled")],
    ["b/discussed", prior("discussed")],
    ["anthropics/kit", prior("related", [{ kind: "constraint", applies_to: ["atlas"] }])],
    ["c/fresh", prior("new")],
    ["d/family", prior("related", [{ kind: "same-org" }])],
  ]);
  const fits = new Map(inbox.map((r) => [r.repo, fitRepo(["agentic-ai"], new Map([["agentic-ai", ["atlas", "apollo"]]]))]));
  const atlas = pickTop("atlas", inbox, { priors, fits, n: 5 });
  assert.deepEqual(atlas.picks.map((r) => r.repo), ["c/fresh", "d/family"]);
  assert.deepEqual(atlas.held, { ruled: 1, discussed: 1, constraint: 1 });
  assert.deepEqual(pickTop("apollo", inbox, { priors, fits, n: 5 }).picks.map((r) => r.repo), ["anthropics/kit", "c/fresh", "d/family"]);
});

test("fitRepo + pickTop: a theme only this project declares outranks a theme every project shares", () => {
  // agentic-ai is declared by four projects, so it says little about any one of them.
  const projectsOf = new Map([["agentic-ai", ["a", "b", "c", "atlas"]], ["chat-bots-whatsapp", ["a", "atlas"]], ["web-ui-generation", ["apollo"]]]);
  const generic = row("x/agent-framework", { stars: 16000 });
  const specific = row("y/whatsapp-bot", { stars: 300 });
  const fits = new Map([[generic.repo, fitRepo(["agentic-ai"], projectsOf)], [specific.repo, fitRepo(["agentic-ai", "chat-bots-whatsapp"], projectsOf)]]);
  assert.deepEqual(fits.get(specific.repo).themesFor.atlas, ["agentic-ai", "chat-bots-whatsapp"]);
  assert.equal(fits.get(generic.repo).score.apollo, undefined, "apollo declares neither theme");
  const priors = new Map();
  const top = pickTop("atlas", [generic, specific], { priors, fits, n: 5 });
  assert.deepEqual(top.picks.map((r) => r.repo), ["y/whatsapp-bot", "x/agent-framework"]);
  assert.deepEqual(top.picks[0].themes, ["agentic-ai", "chat-bots-whatsapp"], "only the themes that count for this project are shown");
});

test("formatBrief: a huge week still renders in <= MAX_LINES, and says what it cut", () => {
  const companies = Array.from({ length: 20 }, (_, i) => ({ id: `co${i}`, name: `Company ${i}`, newRepos: Array.from({ length: 30 }, (_, j) => row(`co${i}/r${j}`)), posts: 40, deadlines: 3 }));
  const deadlines = Array.from({ length: 20 }, (_, i) => ({ title: `Thing ${i} sunset`, url: `https://x/${i}`, source: "s", tokens: ["gemini-3.5-flash"], uses: [{ project: "Apollo", files: 3 }] }));
  const top = { id: "apollo", name: "Apollo", picks: Array.from({ length: 5 }, (_, i) => ({ ...row(`z/p${i}`), themes: ["evals"], verdict: "new" })), held: { ruled: 2, discussed: 1, constraint: 0 } };
  const md = formatBrief({ window: WINDOW, inbox: { waiting: 83, baseline: 83, oldestDays: 0 }, companies, deadlines, tops: [top, { ...top, id: "atlas", name: "Atlas" }, { ...top, id: "third", name: "Third" }] });
  const lines = md.trimEnd().split("\n");
  assert.ok(lines.length <= MAX_LINES, `brief is ${lines.length} lines`);
  assert.match(md, /\+\d+ more deadline/);
  assert.match(md, /held back: 2 already ruled, 1 discussed/);
});

test("formatBrief: a deadline whose model id we could not look up says unknown, never 0 files", () => {
  const md = formatBrief({
    window: WINDOW,
    inbox: { waiting: 0, baseline: 0, oldestDays: 0 },
    companies: [],
    deadlines: [{ title: "Gemini 2.5 Flash retirement", url: "https://x", source: "google-ai", tokens: ["gemini-2.5-flash"], uses: [{ project: "Apollo", files: null }, { project: "Atlas", files: 0 }] }],
    tops: [],
  });
  assert.match(md, /Apollo \?/);
  assert.match(md, /Atlas 0/);
});

test("formatBrief: the recall line says when the check never ran, and shouts when it is red", () => {
  const args = { window: WINDOW, inbox: { waiting: 0, baseline: 0, oldestDays: 0 }, companies: [], deadlines: [], tops: [] };
  assert.match(formatBrief({ ...args, recall: null }), /Recall check: has not run yet/);
  const red = { ran_at: "2026-11-10T06:00:00Z", status: "red", reasons: ["tier-1 a/b (400 stars, created 2026-11-05) was never recorded"], byTier: { 1: { population: 5, found: 4 } }, controls: [{ state: "FIRED" }], negative: "PASSED" };
  assert.match(formatBrief({ ...args, recall: red }), /tier 1 4\/5 .* \*\*RED\*\*: tier-1 a\/b/);
});

test("formatBrief: baseline rows are inbox backlog, not this week's news", () => {
  const md = formatBrief({
    window: WINDOW,
    inbox: { waiting: 83, baseline: 83, oldestDays: 1 },
    companies: [{ id: "google", name: "Google", newRepos: [], baselineRepos: 20, posts: 2, deadlines: 0 }],
    deadlines: [],
    tops: [],
  });
  assert.match(md, /83 waiting for a ruling \(83 from the first read\)/);
  assert.match(md, /Google: 0 new repos \(\+20 on the first read\)/);
});

test("grepUses: files on origin/main naming the model; 0 when none; null when it cannot look", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-git-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "llm.ts"), 'export const MODEL = "Gemini-2.5-Flash";\n');
  fs.writeFileSync(path.join(dir, "other.ts"), "export const x = 1;\n");
  git("add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x");
  assert.equal(grepUses(dir, ["gemini-2.5-flash"]), null, "no origin/main yet: unknown, not 0");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  assert.equal(grepUses(dir, ["gemini-2.5-flash"]), 1);
  assert.equal(grepUses(dir, ["gpt-4o"]), 0);
  assert.equal(grepUses(path.join(dir, "missing"), ["gpt-4o"]), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("assembleBrief: feed POSTS (0 stars) are counted and a sunset post reaches Deadlines with its project usage", () => {
  const asked = [];
  const db = {
    companies: { crossedSince: () => [row("google/new-thing", { stars: 50, company: "google", floor_crossed_at: "2026-11-05T00:00:00Z" })], inbox: () => [] },
    getFeedItemsSince: (sources) => {
      asked.push(sources);
      return [
        { source: "google-ads-dev", title: "Google Ads API v22 sunset reminder", url: "https://ads/1", description: "v22 sunsets", stars: 0 },
        { source: "google-ads-dev", title: "Launching Structured Data Files v11", url: "https://ads/2", description: "", stars: 0 },
        { source: "openai", title: "Retiring GPT-4o in ChatGPT", url: "https://oa/1", description: "", stars: 0 },
      ];
    },
  };
  const md = assembleBrief({
    db,
    window: WINDOW,
    deps: {
      registry: { companies: [{ id: "google", name: "Google", tier: 1, feeds: ["google-ads-dev"], orgs: [] }, { id: "openai", name: "OpenAI", tier: 1, feeds: ["openai"], orgs: [] }] },
      projects: [{ id: "apollo", brief_label: "Apollo", repoPath: "/x" }],
      priors: new Map(),
      themes: [],
      grepUses: (repoPath, tokens) => (tokens.includes("gpt-4o") ? 2 : 0),
      recall: null,
    },
  });
  assert.deepEqual(asked, [["google-ads-dev", "openai"]], "asks for posts from every company feed");
  assert.match(md, /Google: 1 new repo \(top google\/new-thing 50★\) · 2 posts · 1 deadline/);
  assert.match(md, /Google Ads API v22 sunset reminder\]\(https:\/\/ads\/1\) \(google-ads-dev\) - no model id in the post/);
  assert.match(md, /Retiring GPT-4o in ChatGPT.*gpt-4o: Apollo 2/);
});
