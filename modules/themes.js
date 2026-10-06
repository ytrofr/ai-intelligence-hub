/**
 * Theme tagger - pure. Repo (name + description + topics) -> theme ids.
 *
 * Word boundaries are the whole design. A hyphenated compound is ONE word here,
 * because that is how repo names and topics are spelled: `user-agent` is an
 * HTTP header, not an AI agent, and `nosql-lite` is not text-to-SQL. So a
 * single-word keyword matches only a whole token (plus an optional plural
 * "s"). A multi-word keyword ("ai agent") matches its words joined by a space,
 * a hyphen or an underscore, so it still finds `ai-agents` and `ai_agent`.
 * Topics additionally match a theme's `topics[]` by exact equality.
 *
 * Returns every theme that matched (a repo can belong to several), or
 * ['other'] when none did - never an empty list, so a consumer can always
 * group by it.
 */

const fs = require("fs");
const path = require("path");

const THEMES_PATH = path.join(__dirname, "..", "config", "themes.json");
const PROJECTS_PATH = path.join(__dirname, "..", "config", "projects.json");
const OTHER = "other";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex per keyword. Token chars are [a-z0-9] plus '-' '_' '.' inside a word. */
function keywordRegex(keyword) {
  const words = String(keyword).toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escapeRe).join("[\\s_-]+");
  // Not preceded/followed by a word char or a hyphen/underscore: a hyphenated
  // compound is one word. A trailing '.' is allowed (end of a sentence).
  return new RegExp(`(?<![a-z0-9_-])${body}s?(?![a-z0-9_-])`, "i");
}

/** Compile once: themes.json shape -> matcher entries. */
function compileThemes(themes) {
  return (themes || []).map((t) => ({
    id: t.id,
    topics: new Set((t.topics || []).map((x) => String(x).toLowerCase())),
    res: (t.keywords || []).map(keywordRegex).filter(Boolean),
  }));
}

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[‘’]/g, "'");
}

/**
 * repo: {name, description, topics[]} - `name` may be "owner/repo"; only the
 * repo part is matched (an owner called `cursor` says nothing about a repo).
 */
function matchThemes(repo, compiled) {
  const name = String((repo && repo.name) || "").split("/").pop();
  const topics = ((repo && repo.topics) || []).map((t) => String(t).toLowerCase());
  const text = [normText(name), normText(repo && repo.description), topics.join(" ")].join(" \n ");
  const out = [];
  for (const t of compiled) {
    if (topics.some((x) => t.topics.has(x)) || t.res.some((re) => re.test(text))) out.push(t.id);
  }
  return out.length ? out : [OTHER];
}

/**
 * Load the taxonomy. `projects[]` is empty in the PUBLIC themes.json; each
 * theme's project list is built here from an optional `themes: [...]` array
 * on each profile in the gitignored projects.json, so private project ids
 * never enter a tracked file. An unreadable projects.json leaves projects[]
 * empty - the tagger itself does not need it.
 */
function loadThemes({ themesPath = THEMES_PATH, projectsPath = PROJECTS_PATH } = {}) {
  const cfg = JSON.parse(fs.readFileSync(themesPath, "utf-8"));
  const themes = (cfg.themes || []).map((t) => ({ ...t, projects: [...(t.projects || [])] }));
  let profiles = [];
  try {
    const p = JSON.parse(fs.readFileSync(projectsPath, "utf-8")).projects;
    profiles = Array.isArray(p) ? p : Object.entries(p || {}).map(([id, v]) => ({ id, ...v }));
  } catch {
    profiles = [];
  }
  const byId = new Map(themes.map((t) => [t.id, t]));
  for (const prof of profiles) {
    for (const tid of prof.themes || []) {
      const t = byId.get(tid);
      if (t && !t.projects.includes(prof.id)) t.projects.push(prof.id);
    }
  }
  return themes;
}

let cached = null;
/** Convenience for modules: tag with the on-disk taxonomy, compiled once per process. */
function tagRepo(repo) {
  if (!cached) cached = compileThemes(loadThemes());
  return matchThemes(repo, cached);
}

module.exports = { matchThemes, compileThemes, loadThemes, tagRepo, keywordRegex, OTHER };
