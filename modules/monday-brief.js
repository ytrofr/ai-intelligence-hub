/**
 * Monday brief (2026-11-03) - the one page at the TOP of the weekly digest.
 *
 * The digest it heads ran 810 lines on 2026-11-03; a page nobody finishes adopts
 * nothing. The brief is capped at MAX_LINES whatever the week holds and answers four
 * questions only:
 *   1. What did each tracked company ship? (new repos above floor, posts, deadlines)
 *   2. Which vendor ENDS touch code we run? (model ids from the post, counted in files
 *      on each project's main - "?" when the lookup failed, never 0)
 *   3. Per project that asked (profile.brief_top), the top N repos waiting for a ruling.
 *      A repo already ruled or discussed (modules/prior-ruling.js) or forbidden for
 *      that project by a standing constraint is HELD BACK and counted, never shown as new.
 *   4. How big is the inbox, and how old is the oldest unruled item?
 *
 * formatBrief/pickTop/isDeadline/modelTokens are pure; assembleBrief does the reading.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { DEADLINE_TITLE } = require("./news-triage");

const MAX_LINES = 40;
const COMPANY_LINES = 8;
const DEADLINE_LINES = 4;
const BODY_HEAD = 600; // a dated release note names the end in its first sentences
// A release note titled only by its date carries the end in its body; a blog post's body
// does not count ("government shutdowns" in an outage report is not a sunset).
const DATED_TITLE = /^\s*(?:[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})\s*$/;
const BODY_END = /\bis ending\b|\bno longer (?:be )?(?:available|supported|purchas\w*)\b/i;
const MODEL_RE = /\b(gpt|gemini|claude|imagen|veo|text-embedding)[\s-]?(\d[\w.]*)((?:[\s-](?:flash|pro|lite|mini|nano|ultra|haiku|sonnet|opus|preview|image|live|exp)\b)*)/gi;
const ROOT = path.join(__dirname, "..");

/** A vendor post announcing an end: in its title, or - for a date-titled release note only - in the head of its body. */
function isDeadline(item) {
  if (DEADLINE_TITLE.test(item.title || "")) return true;
  if (!DATED_TITLE.test(item.title || "")) return false;
  const head = String(item.description || "").slice(0, BODY_HEAD);
  return DEADLINE_TITLE.test(head) || BODY_END.test(head);
}

/**
 * What to print for a deadline: the title when it names the end, else the sentence in
 * the body that does - a dated release note is titled "September 04, 2026".
 */
function deadlineLine(item) {
  if (DEADLINE_TITLE.test(item.title || "")) return item.title;
  const head = String(item.description || "").slice(0, BODY_HEAD).replace(/\s+/g, " ").trim();
  const sentence = head.split(/(?<=[.!?])\s+/).find((x) => DEADLINE_TITLE.test(x) || BODY_END.test(x));
  return sentence ? `${String(item.title || "").slice(0, 20)}: ${sentence}` : item.title;
}

/**
 * Most actionable first: an end touching files we run, then one named in a title (a
 * body match is weaker), then newest.
 */
function rankDeadlines(ds) {
  const w = (d) => (d.uses.some((u) => u.files > 0) ? 2 : 0) + (d.titleMatch ? 1 : 0);
  return [...ds].sort((a, b) => w(b) - w(a) || String(b.date || "").localeCompare(String(a.date || "")));
}

/** Model ids named in vendor prose, normalised the way code spells them. */
function modelTokens(text) {
  const out = [];
  for (const m of String(text || "").matchAll(MODEL_RE)) {
    const id = `${m[1]}-${m[2]}${m[3] || ""}`.toLowerCase().replace(/\s+/g, "-").replace(/\.+$/, "");
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Theme tags -> per-project fit. A theme counts for a project only if the project
 * declared it, weighted 1 / (projects declaring it): agentic-ai, declared by four
 * projects, put the same five repos at the top of two projects' lists on the
 * first real render (2026-11-03). A theme only one project declares says the most.
 */
function fitRepo(tags, projectsOf) {
  const score = {};
  const themesFor = {};
  for (const t of tags) {
    const ps = projectsOf.get(t) || [];
    for (const p of ps) {
      score[p] = (score[p] || 0) + 1 / ps.length;
      (themesFor[p] = themesFor[p] || []).push(t);
    }
  }
  return { score, themesFor };
}

/** Top `n` inbox rows for one project, and what was held back and why. */
function pickTop(projectId, inbox, { priors, fits, n }) {
  const held = { ruled: 0, discussed: 0, constraint: 0 };
  const candidates = [];
  for (const r of inbox) {
    const fit = fits.get(r.repo);
    const fitScore = fit && fit.score[projectId];
    if (!fitScore) continue;
    const p = priors.get(r.repo) || { verdict: "new", hits: [] };
    if (p.verdict === "ruled") held.ruled += 1;
    else if (p.verdict === "discussed") held.discussed += 1;
    else if (p.hits.some((h) => h.kind === "constraint" && (h.applies_to || []).includes(projectId))) held.constraint += 1;
    else candidates.push({ ...r, themes: fit.themesFor[projectId], verdict: p.verdict, fitScore });
  }
  candidates.sort((a, b) => b.fitScore - a.fitScore || (b.stars || 0) - (a.stars || 0));
  return { picks: candidates.slice(0, n), held };
}

const stars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0)) + "★";
const day = (iso) => String(iso || "").slice(0, 16).replace("T", " ");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function formatBrief({ window, inbox, companies, deadlines, tops }) {
  const L = [];
  L.push("## 📌 This week on one page");
  L.push("");
  const backlog = inbox.baseline ? ` (${inbox.baseline} from the first read)` : "";
  L.push(`> ${day(window.since)} to ${day(window.until)} UTC · inbox: ${inbox.waiting} waiting for a ruling${backlog} · oldest ${inbox.oldestDays} d · rule via POST /api/companies/rule`);
  L.push("");

  const active = companies
    .filter((c) => c.newRepos.length || c.posts || c.deadlines || c.baselineRepos)
    .sort((a, b) => b.newRepos.length - a.newRepos.length || b.posts - a.posts);
  L.push("**Companies** - new repos above floor · posts · deadlines");
  for (const c of active.slice(0, COMPANY_LINES)) {
    const top = [...c.newRepos].sort((a, b) => b.stars - a.stars)[0];
    const lead = top ? ` (top ${top.repo} ${stars(top.stars)})` : "";
    const base = c.baselineRepos ? ` (+${c.baselineRepos} on the first read)` : "";
    L.push(`- ${c.name}: ${plural(c.newRepos.length, "new repo")}${lead}${base} · ${plural(c.posts, "post")} · ${plural(c.deadlines, "deadline")}`);
  }
  if (active.length > COMPANY_LINES) L.push(`- +${active.length - COMPANY_LINES} more companies with activity: /api/companies/week`);
  if (!active.length) L.push("- no tracked company shipped anything this week");
  L.push("");

  L.push("**Deadlines** - an end a vendor named · files on each project's main naming the model");
  for (const d of deadlines.slice(0, DEADLINE_LINES)) {
    const uses = d.tokens.length
      ? `${d.tokens.slice(0, 2).join(", ")}: ${d.uses.map((u) => `${u.project} ${u.files === null ? "?" : u.files}`).join(" · ")}`
      : "no model id in the post - read it";
    L.push(`- [${String(d.title).slice(0, 110)}](${d.url}) (${d.source}) - ${uses}`);
  }
  if (deadlines.length > DEADLINE_LINES) L.push(`- +${deadlines.length - DEADLINE_LINES} more deadlines in the full digest`);
  if (!deadlines.length) L.push("- none named this week");
  L.push("");

  for (const t of tops) {
    const h = t.held;
    L.push(`**Top ${t.picks.length} for ${t.name}** - held back: ${h.ruled} already ruled, ${h.discussed} discussed, ${h.constraint} by a standing constraint`);
    t.picks.forEach((r, i) => L.push(`${i + 1}. [${r.repo}](https://github.com/${r.repo}) ${stars(r.stars)} - ${(r.themes || []).join(", ")} · ${r.verdict}`));
    if (!t.picks.length) L.push("- nothing new in the inbox fits this project");
    L.push("");
  }
  if (L.length > MAX_LINES) {
    L.length = MAX_LINES - 1;
    L.push(`_Cut at ${MAX_LINES} lines; the rest is in the full digest._`);
  }
  return L.join("\n") + "\n";
}

/* ---------------- assembly (reads the db, config and the project repos) ---------------- */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

/** Files on the project's main naming any token: a number, 0, or null when it could not be read. */
function grepUses(repoPath, tokens) {
  if (!repoPath || !tokens.length || !fs.existsSync(repoPath)) return null;
  let ref = null;
  for (const r of ["origin/main", "origin/master"]) {
    try {
      execFileSync("git", ["-C", repoPath, "rev-parse", "--verify", "-q", r], { stdio: "ignore", timeout: 10000 });
      ref = r;
      break;
    } catch {
      /* try the next */
    }
  }
  if (!ref) return null;
  try {
    const out = execFileSync("git", ["-C", repoPath, "grep", "-l", "-i", "-F", ...tokens.flatMap((t) => ["-e", t]), ref, "--"], { encoding: "utf-8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    return out.split("\n").filter(Boolean).length;
  } catch (err) {
    return err.status === 1 ? 0 : null; // 1 = no match; anything else = we do not know
  }
}

function assembleBrief({ db, window, deps = {} }) {
  const registry = deps.registry || readJson(path.join(ROOT, "config", "companies.json"), { companies: [] });
  const profilesRaw = deps.projects || readJson(path.join(ROOT, "config", "projects.json"), { projects: [] }).projects;
  const profiles = Array.isArray(profilesRaw) ? profilesRaw : Object.entries(profilesRaw || {}).map(([id, v]) => ({ id, ...v }));
  const label = (p) => p.brief_label || p.name || p.id;
  const inWindow = (iso) => iso >= window.since && iso < window.until;

  const week = db.companies.crossedSince(window.since).filter((r) => inWindow(r.floor_crossed_at));
  const waiting = db.companies.inbox();
  // Posts, not repos: getItemsFirstSeenSince keeps only 200+ star items and so returned
  // no post at all on the first real run (three Ads sunset notices went missing).
  const allFeeds = [...new Set((registry.companies || []).flatMap((c) => c.feeds || []))];
  const items = db.getFeedItemsSince(allFeeds, window.since, window.until);

  const deadlineItems = [];
  const companies = (registry.companies || []).map((c) => {
    const feeds = new Set(c.feeds || []);
    const posts = items.filter((i) => feeds.has(i.source));
    const ends = posts.filter(isDeadline);
    deadlineItems.push(...ends);
    const mine = week.filter((r) => r.company === c.id);
    return { id: c.id, name: c.name, newRepos: mine.filter((r) => !r.baseline), baselineRepos: mine.filter((r) => r.baseline).length, posts: posts.length, deadlines: ends.length };
  });

  const withRepo = profiles.filter((p) => p.repoPath);
  const deadlines = deadlineItems.map((i) => {
    const tokens = modelTokens(`${i.title} ${String(i.description || "").slice(0, BODY_HEAD)}`);
    const grep = deps.grepUses || grepUses;
    return {
      title: deadlineLine(i),
      url: i.url,
      source: i.source,
      date: i.published_at || i.first_seen_at,
      titleMatch: DEADLINE_TITLE.test(i.title || ""),
      tokens,
      uses: tokens.length ? withRepo.map((p) => ({ project: label(p), files: grep(p.repoPath, tokens) })) : [],
    };
  });

  const { priorForMany } = require("./prior-ruling");
  const priors = deps.priors || priorForMany(waiting.map((r) => r.repo));
  const { loadThemes, compileThemes, matchThemes, OTHER } = require("./themes");
  const themes = deps.themes || loadThemes();
  const compiled = compileThemes(themes);
  const projectsOf = new Map(themes.map((t) => [t.id, t.projects || []]));
  const fits = new Map(
    waiting.map((r) => {
      const tags = matchThemes({ name: r.repo, description: r.description, topics: readJsonText(r.topics) }, compiled).filter((t) => t !== OTHER);
      return [r.repo, fitRepo(tags, projectsOf)];
    })
  );
  const tops = profiles.filter((p) => p.brief_top).map((p) => ({ id: p.id, name: label(p), ...pickTop(p.id, waiting, { priors, fits, n: p.brief_top }) }));

  const oldest = waiting.reduce((m, r) => (r.floor_crossed_at < m ? r.floor_crossed_at : m), window.until);
  const inbox = { waiting: waiting.length, baseline: waiting.filter((r) => r.baseline).length, oldestDays: Math.max(0, Math.floor((Date.parse(window.until) - Date.parse(oldest)) / 86400000)) };
  return formatBrief({ window, inbox, companies, deadlines: rankDeadlines(deadlines), tops });
}

function readJsonText(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

module.exports = { formatBrief, pickTop, fitRepo, isDeadline, deadlineLine, rankDeadlines, modelTokens, assembleBrief, grepUses, MAX_LINES };
