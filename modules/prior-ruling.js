/**
 * "Has this already been ruled?" - asked BEFORE any repo is put in front of the
 * operator (2026-11-03).
 *
 * Origin: an audit recommended shadcn-ui/cn as a new find. The operator had made shadcn
 * the UI base everywhere on 2026-09-04, and one project's memory records `cn` as a plain
 * join by its reviewer's convention. The check that missed it matched exact repo names, read
 * the first 4 KB of the ledger, and never looked at standing laws, benches or memory.
 *
 * Five places a ruling can live, all searched:
 *   ledger   - the full stack ledger, exact repo
 *   same-org - ledger rows from the same owner (a FAMILY, shown, never a ruling by itself)
 *   law      - config/standing-laws.json: the operator's standing decisions by owner/repo
 *              (a law with applies_to binds only those projects: kind "constraint")
 *   report   - ~/.claude/reports/*.md that name the repo (benches, audits)
 *   memory   - ~/.claude/projects/<p>/memory/*.md that name it
 *
 * verdict: ruled (exact ledger row or a law) · discussed (a report or memory note names THIS
 * repo - a ruling can live only there, as harness2's did) · related (family only) · new.
 * Only "new" may be presented as a new find.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const GENERIC = new Set(["skills", "agent", "agents", "tools", "examples", "docs", "server", "client", "python", "typescript", "awesome", "starter", "template", "cookbook", "models"]);

/** Strings to grep for: the slug always; the bare name when it is specific enough; the owner as a family marker. */
function searchTerms(repo) {
  const [owner, name = ""] = repo.split("/");
  const terms = [repo];
  if (name.length >= 5 && !GENERIC.has(name.toLowerCase()) && name.toLowerCase() !== owner.toLowerCase()) terms.push(name);
  else if (name.toLowerCase() === owner.toLowerCase()) terms.push(name);
  else terms.push(`${owner}/`);
  return terms;
}

/** `grep -o -H` output -> Map(term -> Map(file -> count)). */
function parseGrep(out) {
  const m = new Map();
  for (const line of String(out || "").split("\n")) {
    if (!line) continue;
    const i = line.indexOf(".md:");
    if (i < 0) continue;
    const file = line.slice(0, i + 3);
    const term = line.slice(i + 4);
    if (!m.has(term)) m.set(term, new Map());
    const f = m.get(term);
    f.set(file, (f.get(file) || 0) + 1);
  }
  return m;
}

const ownerOf = (r) => String(r).split("/")[0].toLowerCase();

/** Pure. ctx = {ledgerRows, laws, mentions: Map(term->Map(file->n)), searched?} */
function findPrior(repo, { ledgerRows = [], laws = [], mentions = new Map(), searched = null } = {}) {
  const hits = [];
  const lc = repo.toLowerCase();
  const owner = ownerOf(repo);

  for (const r of ledgerRows) {
    const rl = String(r.repo).toLowerCase();
    if (rl === lc) {
      const per = r.per_project ? Object.entries(r.per_project).map(([p, v]) => `${p}:${v.state || v.status || "?"}`).join(", ") : (r.projects || []).join(", ");
      hits.push({ kind: "ledger", ref: r.repo, summary: `${r.verdict || "?"} ${r.status || ""} - ${per}`.trim() });
    } else if (ownerOf(rl) === owner) {
      hits.push({ kind: "same-org", ref: r.repo, summary: `${r.verdict || "?"} ${r.status || ""} - ${(r.projects || []).join(", ")}`.trim() });
    }
  }
  for (const law of laws) {
    const m = law.match || {};
    const byRepo = (m.repos || []).some((x) => x.toLowerCase() === lc);
    const byOwner = (m.owners || []).some((x) => x.toLowerCase() === owner);
    if (!byRepo && !byOwner) continue;
    // A law scoped to some projects (applies_to) binds only them: a constraint to show, not a ruling.
    if (Array.isArray(law.applies_to) && law.applies_to.length) hits.push({ kind: "constraint", ref: law.id, summary: law.law, applies_to: law.applies_to });
    else hits.push({ kind: "law", ref: law.id, summary: law.law, per_project: law.per_project || {} });
  }
  const seenFiles = new Set();
  const familyMarker = `${repo.split("/")[0]}/`;
  let discussed = false;
  for (const term of searchTerms(repo)) {
    const files = mentions.get(term);
    if (!files) continue;
    for (const [file, n] of files) {
      if (seenFiles.has(file)) continue;
      seenFiles.add(file);
      hits.push({ kind: /\/memory\//.test(file) ? "memory" : "report", ref: file, summary: `${n}x "${term}"` });
      if (term !== familyMarker) discussed = true;
    }
  }
  const ruled = hits.some((h) => h.kind === "ledger" || h.kind === "law");
  const verdict = ruled ? "ruled" : discussed ? "discussed" : hits.length ? "related" : "new";
  return { repo, verdict, hits, searched };
}

/* ---------- loading the real context (not used by tests) ---------- */

function homeDir() {
  return process.env.HOME || os.homedir();
}

function loadLaws(file = path.join(__dirname, "..", "config", "standing-laws.json")) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf-8")).laws || [];
}

/** One grep over reports + every project's memory, for all terms of all repos at once. */
function grepMentions(repos, { reportsDir = process.env.HUB_REPORTS_DIR || path.join(homeDir(), ".claude", "reports"), projectsDir = path.join(homeDir(), ".claude", "projects") } = {}) {
  const terms = [...new Set(repos.flatMap(searchTerms))];
  if (!terms.length) return { mentions: new Map(), files: 0 };
  const dirs = [reportsDir];
  if (fs.existsSync(projectsDir)) for (const p of fs.readdirSync(projectsDir)) {
    const m = path.join(projectsDir, p, "memory");
    if (fs.existsSync(m)) dirs.push(m);
  }
  const existing = dirs.filter((d) => fs.existsSync(d));
  const args = ["-rHoF", "--include=*.md", ...terms.flatMap((t) => ["-e", t]), ...existing];
  let out = "";
  try {
    out = execFileSync("grep", args, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
  } catch (err) {
    // grep exits 1 for "no match" - that is an answer. Anything else is an error, never a silent empty.
    if (err.status === 1) out = "";
    else throw new Error(`prior-ruling grep failed: ${err.message}`);
  }
  return { mentions: parseGrep(out), dirs: existing.length };
}

function loadLedgerRows() {
  const { buildLedger } = require("./ledger");
  const { readAllRadarRows, readDepRepos } = require("../routes/lib/hub-sources");
  return buildLedger({ radarRows: readAllRadarRows(), depRepos: readDepRepos().depRepos }).rows;
}

/** Batch lookup for the inbox and the Monday page. */
function priorForMany(repos, deps = {}) {
  const ledgerRows = deps.ledgerRows || loadLedgerRows();
  const laws = deps.laws || loadLaws();
  const { mentions, dirs } = deps.mentions ? { mentions: deps.mentions, dirs: null } : grepMentions(repos);
  const searched = { ledger_rows: ledgerRows.length, laws: laws.length, dirs };
  return new Map(repos.map((r) => [r, findPrior(r, { ledgerRows, laws, mentions, searched })]));
}

module.exports = { findPrior, searchTerms, parseGrep, priorForMany, loadLaws, grepMentions };
