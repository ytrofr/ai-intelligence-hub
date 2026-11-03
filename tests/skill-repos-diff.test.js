const test = require("node:test");
const assert = require("node:assert/strict");
const { diffSkillTrees, formatSkillReposSection, SkillReposDiffModule } = require("../modules/skill-repos-diff");

// Fixture trees, shaped like GET /repos/{o}/{r}/git/trees/{sha}?recursive=1
const tree = (sha, files, truncated = false) => ({
  sha, truncated,
  tree: Object.entries(files).map(([path, blob]) => ({ path, type: "blob", sha: blob })),
});
const BASE = tree("b".repeat(40), { "a/SKILL.md": "1", "b/SKILL.md": "2", "gone/SKILL.md": "3", "README.md": "9" });
const HEAD = tree("h".repeat(40), { "a/SKILL.md": "1", "b/SKILL.md": "2x", "new/SKILL.md": "4", "README.md": "10" });

test("diff lists added, changed and removed SKILL.md files and nothing else", () => {
  const d = diffSkillTrees(BASE, HEAD);
  assert.deepEqual(d.added, ["new/SKILL.md"]);
  assert.deepEqual(d.modified, ["b/SKILL.md"]);
  assert.deepEqual(d.removed, ["gone/SKILL.md"]);
  assert.equal(d.total, 3);
});

test("SKILL.md files under test or fixture folders are not skills (gstack's test/fixtures/.../alpha)", () => {
  const head = tree("f".repeat(40), { "a/SKILL.md": "1", "test/fixtures/x/alpha/SKILL.md": "5", "tests/b/SKILL.md": "6" });
  const d = diffSkillTrees(tree("e".repeat(40), { "a/SKILL.md": "1" }), head);
  assert.deepEqual(d.added, []);
  assert.equal(d.total, 1);
});

test("a long gap lists at most 12 skills per kind, then '+N more'", () => {
  const many = Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, "0")}/SKILL.md`);
  const md = formatSkillReposSection({ fetched_at: "2026-10-25T08:00:00Z", repos: [
    { repo: "o/r", base: "0".repeat(40), head: "1".repeat(40), ahead_by: 276, added: [], modified: many, removed: [], total: 20 },
  ] }, { now: Date.parse("2026-10-25T09:00:00Z") });
  assert.equal((md.match(/\]\(https:/g) || []).length, 12);
  assert.match(md, /\+8 more/);
});

test("CONTROL: the same tree on both sides diffs to zero", () => {
  const d = diffSkillTrees(HEAD, HEAD);
  assert.equal(d.added.length + d.modified.length + d.removed.length, 0);
});

test("CONTROL: a truncated tree is an error, never an empty diff", () => {
  assert.throws(() => diffSkillTrees(BASE, tree("t".repeat(40), {}, true)), /truncated/);
});

test("the section gives every repo a line, including one with no change and one that failed", () => {
  const md = formatSkillReposSection({
    fetched_at: "2026-10-25T08:00:00Z",
    repos: [
      { repo: "garrytan/gstack", base: "0".repeat(40), head: "1".repeat(40), ahead_by: 12, audited_at: "2026-10-25",
        added: ["new/SKILL.md"], modified: ["ship/SKILL.md"], removed: [], total: 60 },
      { repo: "mattpocock/skills", base: "2".repeat(40), head: "2".repeat(40), ahead_by: 0, audited_at: "2026-10-25",
        added: [], modified: [], removed: [], total: 38 },
      { repo: "multica-ai/andrej-karpathy-skills", base: "3".repeat(40), audited_at: "2026-10-25", error: "HTTP 404" },
    ],
  }, { now: Date.parse("2026-10-26T07:00:00Z") });
  assert.match(md, /## 🧩 Skill repos since last audit/);
  assert.match(md, /garrytan\/gstack.*1 added · 1 changed · 0 removed \(of 60\)/);
  assert.match(md, /\[ship\]\(https:\/\/github.com\/garrytan\/gstack\/blob\/1{40}\/ship\/SKILL.md\)/);
  assert.match(md, /mattpocock\/skills.*no SKILL.md changed \(of 38\)/);
  assert.match(md, /multica-ai\/andrej-karpathy-skills.*could not diff.*HTTP 404/);
  assert.doesNotMatch(md, /stale/);
});

test("vendor repos (T1) list before vetted ones (T2), and a never-audited repo says so", () => {
  const same = (repo, tier, audited_at) => ({ repo, tier, audited_at, base: "4".repeat(40), head: "4".repeat(40),
    ahead_by: 0, added: [], modified: [], removed: [], total: 5 });
  const md = formatSkillReposSection({
    fetched_at: "2026-10-25T08:00:00Z",
    repos: [same("garrytan/gstack", "T2", "2026-10-25"), same("anthropics/skills", "T1", null)],
  }, { now: Date.parse("2026-10-26T07:00:00Z") });
  assert.ok(md.indexOf("anthropics/skills") < md.indexOf("garrytan/gstack"), "T1 must list first");
  assert.match(md, /T1 · \*\*anthropics\/skills\*\*.*since the baseline \(not audited\)/);
  assert.match(md, /T2 · \*\*garrytan\/gstack\*\*.*since the 2026-10-25 audit/);
});

test("CONTROL: an old or missing snapshot says so instead of reading as 'no change'", () => {
  const old = formatSkillReposSection({ fetched_at: "2026-10-01T00:00:00Z", repos: [] }, { now: Date.parse("2026-10-26T07:00:00Z") });
  assert.match(old, /25 days old.*stale/);
  assert.match(formatSkillReposSection(null), /never fetched/);
});

test("fetch writes one snapshot row per repo and reads 'partial' when one repo fails", async () => {
  const calls = { written: null };
  const answers = {
    "https://api.github.com/repos/ok/r": { default_branch: "main" },
    "https://api.github.com/repos/ok/r/commits/main": { sha: "h".repeat(40) },
    [`https://api.github.com/repos/ok/r/git/trees/${"b".repeat(40)}?recursive=1`]: BASE,
    [`https://api.github.com/repos/ok/r/git/trees/${"h".repeat(40)}?recursive=1`]: HEAD,
    [`https://api.github.com/repos/ok/r/compare/${"b".repeat(40)}...${"h".repeat(40)}`]: { ahead_by: 3 },
  };
  const mod = new SkillReposDiffModule(
    { id: "skill-repos", config: { repos: [{ repo: "ok/r", base_sha: "b".repeat(40) }, { repo: "bad/r", base_sha: "c".repeat(40) }] } },
    {
      fetchJson: async (url) => { if (url in answers) return answers[url]; throw new Error("HTTP 404"); },
      writeState: (s) => { calls.written = s; },
    },
  );
  await assert.rejects(() => mod.fetch(), (err) => err.name === "PartialFetchError" && /1 of 2/.test(err.message));
  assert.equal(calls.written.repos.length, 2);
  assert.equal(calls.written.repos[0].ahead_by, 3);
  assert.deepEqual(calls.written.repos[0].added, ["new/SKILL.md"]);
  assert.match(calls.written.repos[1].error, /404/);
});
