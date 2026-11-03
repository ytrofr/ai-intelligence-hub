/**
 * Skill repos since last audit - which SKILL.md files changed in the outside skill
 * repos we follow, counted from the commit we last AUDITED, not from last week.
 *
 * Why: every audit used to start from zero (gstack had 23 skills at the May audit and 60
 * at the October one, and nothing said which were new). Config holds one `base_sha` per
 * repo; after an audit, move it to the audited commit.
 *
 * Why a tree diff and not /compare: compare lists at most 300 files, so a long gap
 * (gstack May -> Oct, 276 commits) showed 5 of the skills that changed. Two tree reads
 * per repo are complete; a truncated tree is an error, never an empty diff.
 *
 * Registered as a SOURCE (like tracked-repos) so a broken run shows in /api/health. It
 * returns NO feed items by design: it writes one snapshot (data/skill-repos-diff.json)
 * that the weekly digest renders for EVERY configured repo, a quiet one included.
 */

const fs = require("fs");
const path = require("path");
const BaseModule = require("./base-module");
const { fetchJson } = require("./http");
const { PartialFetchError } = require("./fetch-runner");

const STATE_PATH = path.join(__dirname, "..", "data", "skill-repos-diff.json");
const DEFAULT_PATH_RE = "(^|/)SKILL\\.md$";
// A SKILL.md under a test or fixture folder is test data, not a skill (gstack ships two)
const NOT_A_SKILL_RE = /(^|\/)(tests?|fixtures|__fixtures__|node_modules)\//;
const LIST_CAP = 12;
const HEADING = "## 🧩 Skill repos since last audit";

function skillMap(tree, re) {
  if (!tree || tree.truncated) {
    throw new Error(`tree ${String(tree && tree.sha).slice(0, 12)} truncated by GitHub - the diff would be incomplete`);
  }
  const map = new Map();
  for (const f of tree.tree || []) {
    if (f.type === "blob" && re.test(f.path) && !NOT_A_SKILL_RE.test(f.path)) map.set(f.path, f.sha);
  }
  return map;
}

const capped = (list, render) =>
  list.slice(0, LIST_CAP).map(render).join(", ") + (list.length > LIST_CAP ? `, +${list.length - LIST_CAP} more` : "");

/** Pure: two recursive trees -> SKILL.md paths added / modified / removed, and the head total. */
function diffSkillTrees(baseTree, headTree, re = new RegExp(DEFAULT_PATH_RE)) {
  const base = skillMap(baseTree, re);
  const head = skillMap(headTree, re);
  const added = [];
  const modified = [];
  const removed = [];
  for (const [p, sha] of head) {
    if (!base.has(p)) added.push(p);
    else if (base.get(p) !== sha) modified.push(p);
  }
  for (const p of base.keys()) if (!head.has(p)) removed.push(p);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort(), total: head.size };
}

const short = (sha) => String(sha || "?").slice(0, 7);
const skillName = (p) => {
  const parts = p.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : p;
};

/** Pure: snapshot -> markdown. Every repo gets a line; a stale or missing snapshot says so. */
function formatSkillReposSection(state, { now = Date.now(), maxAgeDays = 8 } = {}) {
  const lines = ["", HEADING, ""];
  if (!state || !Array.isArray(state.repos)) {
    lines.push("- _No snapshot yet: the `skill-repos` source has never fetched._", "");
    return lines.join("\n");
  }
  const ageDays = (now - Date.parse(state.fetched_at)) / 86400000;
  if (!(ageDays <= maxAgeDays)) {
    lines.push(`- _Snapshot is ${Math.floor(ageDays)} days old - the \`skill-repos\` source stopped fetching; every line below is stale._`, "");
  }
  // T1 = vendor-official, T2 = vetted practitioner; a repo with no tier lists last.
  const repos = [...state.repos].sort((a, b) => (a.tier || "T9").localeCompare(b.tier || "T9"));
  for (const r of repos) {
    const tag = r.tier ? `${r.tier} · ` : "";
    if (r.error) {
      lines.push(`- ${tag}**${r.repo}** - ⛔ could not diff from ${short(r.base)}: ${r.error}`);
      continue;
    }
    const n = r.added.length + r.modified.length + r.removed.length;
    const since = r.audited_at ? `the ${r.audited_at} audit` : "the baseline (not audited)";
    const head = `- ${tag}**${r.repo}** ${short(r.base)} → ${short(r.head)} (${r.ahead_by} commits since ${since})`;
    if (!n) {
      lines.push(`${head}: no SKILL.md changed (of ${r.total})`);
      continue;
    }
    lines.push(`${head}: ${r.added.length} added · ${r.modified.length} changed · ${r.removed.length} removed (of ${r.total})`);
    const link = (p) => `[${skillName(p)}](https://github.com/${r.repo}/blob/${r.head}/${p})`;
    if (r.added.length) lines.push(`  - added: ${capped(r.added, link)}`);
    if (r.modified.length) lines.push(`  - changed: ${capped(r.modified, link)}`);
    if (r.removed.length) lines.push(`  - removed: ${capped(r.removed, skillName)}`);
  }
  lines.push(
    "",
    "_Rule on these at the Sunday weekly method review: drop what we already have, test the rest one case, then three, then nine. After an audit, move that repo's `base_sha` (source `skill-repos` in config/sources.json) to the audited commit._",
    "",
  );
  return lines.join("\n");
}

function readState(p = STATE_PATH) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function writeState(state, p = STATE_PATH) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(state, null, 1));
  fs.renameSync(`${p}.tmp`, p);
}

class SkillReposDiffModule extends BaseModule {
  constructor(config, deps = {}) {
    super(config);
    this.deps = deps;
  }

  headers() {
    const h = { Accept: "application/vnd.github+json", "User-Agent": "AI-Intelligence-Hub/1.0" };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return h;
  }

  getJson(url) {
    return (this.deps.fetchJson || fetchJson)(url, { headers: this.headers(), timeoutMs: this.config.timeout_ms || 30000 });
  }

  async diffRepo({ repo, tier, base_sha, audited_at }, re) {
    const api = `https://api.github.com/repos/${repo}`;
    const { default_branch } = await this.getJson(api);
    const { sha: head } = await this.getJson(`${api}/commits/${default_branch}`);
    const [baseTree, headTree, cmp] = await Promise.all([
      this.getJson(`${api}/git/trees/${base_sha}?recursive=1`),
      this.getJson(`${api}/git/trees/${head}?recursive=1`),
      this.getJson(`${api}/compare/${base_sha}...${head}`),
    ]);
    return { repo, tier, branch: default_branch, base: base_sha, head, ahead_by: cmp.ahead_by, audited_at, ...diffSkillTrees(baseTree, headTree, re) };
  }

  async fetch() {
    const repos = this.config.repos || [];
    if (!repos.length) throw new Error("skill-repos: no repos configured");
    const re = new RegExp(this.config.path_regex || DEFAULT_PATH_RE);
    const out = [];
    for (const r of repos) {
      try {
        out.push(await this.diffRepo(r, re));
      } catch (err) {
        out.push({ repo: r.repo, tier: r.tier, base: r.base_sha, audited_at: r.audited_at, error: String(err.message).slice(0, 200) });
      }
    }
    (this.deps.writeState || writeState)({ fetched_at: new Date().toISOString(), repos: out });
    const failed = out.filter((r) => r.error);
    this.runReport = { repos: out.length, diffed: out.length - failed.length };
    if (failed.length === out.length) throw new Error(`skill-repos: every repo failed - ${failed[0].error}`);
    if (failed.length) {
      throw new PartialFetchError(`skill-repos: ${failed.length} of ${out.length} repos failed - ${failed.map((f) => f.repo).join(", ")}`, [], this.runReport);
    }
    return [];
  }
}

module.exports = SkillReposDiffModule;
module.exports.SkillReposDiffModule = SkillReposDiffModule;
module.exports.diffSkillTrees = diffSkillTrees;
module.exports.formatSkillReposSection = formatSkillReposSection;
module.exports.readState = readState;
module.exports.STATE_PATH = STATE_PATH;
