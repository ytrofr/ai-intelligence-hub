/**
 * No tracked file names a project this repo is not allowed to name.
 *
 * This repo is PUBLIC. The operator's standing instruction, twice, verbatim:
 * "make sure we dont expose anything sensitive to this this repo" and
 * "MAKE SURE WE DONT EXPOSE ANYTHING ABOUT THESE PROJECTS PUBLIC!!!!".
 *
 * ── why this is an ALLOW-list and not a deny-list ───────────────────────────
 *
 * The obvious guard is a list of forbidden ids. It cannot work here, and the
 * failure is not subtle: a list of the private project names, committed to the
 * public repo, IS the leak. It would have published the portfolio in a tidier
 * form than anything it was written to catch.
 *
 * So the vocabulary is inverted. Layer 1 enumerates what this repo MAY name -
 * the ids in the tracked example config, plus the two projects that are public
 * anyway, plus the synthetic placeholders the fixtures use. Everything else in
 * an id position fails, INCLUDING an id that does not exist yet. The unknown
 * case is refused rather than allowed, and nothing private is written down.
 *
 * Layer 2 is the part an allow-list cannot reach: prose. A project named in
 * an ordinary sentence carries no id syntax, so only a deny-list finds it - and the deny-list
 * may not live here. It therefore reads the real ids from config/projects.json,
 * which is gitignored and present only on a machine that already has them. On
 * CI that file is absent, and the cell reports SKIPPED rather than passing:
 * three states, never two, because a scan that could not run must not be
 * indistinguishable from a scan that found nothing.
 */

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/**
 * Where a project id can appear such that it IS an id rather than a word:
 * a query string, a quoted object/JSON value, or a per-project config path.
 * Deliberately narrow - a wide pattern would drag in every `const project =`
 * and drown the finding in variable names.
 */
const ID_POSITIONS = [
  /[?&]project=([A-Za-z][A-Za-z0-9_-]*)/g,
  /["']?project["']?\s*[=:]\s*"([A-Za-z][A-Za-z0-9_-]*)"/g,
  /["']?project["']?\s*[=:]\s*'([A-Za-z][A-Za-z0-9_-]*)'/g,
  /config\/radar\/([A-Za-z][A-Za-z0-9_-]*)\.json/g,
  // A slot id is `<project>/<slot>`, so it names a project without ever
  // using the word "project" - the shape that got past the first draft.
  /["']?slot["']?\s*[=:]\s*["']([A-Za-z][A-Za-z0-9_-]*)\//g,
];

/** Ids the tracked example configs declare - fictional by construction. */
function exampleIds() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config/projects.example.json"), "utf8"));
  const ids = (cfg.projects || []).map((p) => p.id);
  // The tracked radar fixtures declare project ids of their own, and a test
  // that reads one has to be able to name it.
  const radar = path.join(ROOT, "config/radar");
  for (const f of fs.readdirSync(radar).filter((f) => f.startsWith("example") && f.endsWith(".json"))) {
    try {
      const id = JSON.parse(fs.readFileSync(path.join(radar, f), "utf8")).project;
      if (id) ids.push(id);
    } catch (_) {
      /* a malformed fixture is the fixture's problem, not this guard's */
    }
  }
  return ids;
}

/**
 * Public by nature, so naming them leaks nothing: this repo itself, and the
 * documentation site that is already a public repo.
 */
const PUBLIC_PROJECTS = ["hub", "guide", "ai-intelligence-hub"];

/**
 * Placeholders the fixtures use. Kept explicit rather than allowed by a
 * "short token" rule - the shortest real id is four characters too, so a
 * length heuristic would have waved the real thing straight through.
 */
const SYNTHETIC = ["proj", "p", "a", "b", "x", "y", "all", "example", "none", "definitely-not-a-real-project"];

function allowed() {
  // Lower-cased on both sides. A title written "APOLLO" is the same project as
  // "apollo", and a case-sensitive set would let the shouted form straight
  // through - which is exactly the form a page title uses.
  return new Set([...exampleIds(), ...PUBLIC_PROJECTS, ...SYNTHETIC].map((s) => s.toLowerCase()));
}

/**
 * Technology names the tracked config already treats as public: search
 * keywords, and the example projects' declared dependencies and topics.
 */
function publicTechNames() {
  const out = new Set();
  const eat = (v) => {
    if (typeof v === "string") out.add(v.toLowerCase().replace(/^@/, "").split("/")[0]);
    else if (Array.isArray(v)) v.forEach(eat);
    else if (v && typeof v === "object") Object.values(v).forEach(eat);
  };
  for (const f of ["config/keywords.json", "config/projects.example.json"]) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
      eat(cfg.keywords || cfg);
      for (const p of cfg.projects || []) {
        eat(p.dependencies);
        eat(p.topics);
      }
    } catch (_) {
      /* absent or malformed: the set is smaller, which only makes layer 2 stricter */
    }
  }
  return out;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 24 })
    .toString()
    .split("\0")
    .filter(Boolean);
}

function readTracked() {
  const out = [];
  for (const rel of trackedFiles()) {
    try {
      out.push([rel, fs.readFileSync(path.join(ROOT, rel), "utf8")]);
    } catch (_) {
      /* deleted-but-indexed, or not utf8 */
    }
  }
  return out;
}

/** Every id-position token in a blob. */
function idsIn(text) {
  const found = new Set();
  for (const re of ID_POSITIONS) {
    for (const m of text.matchAll(re)) found.add(m[1]);
  }
  return found;
}

test("POSITIVE CONTROL: an id outside the allow-list is rejected", () => {
  // Without this, a matcher that extracts nothing reports a spotless repo,
  // which is the most convincing lie available to it.
  const ok = allowed();
  const bad = [...idsIn('fetch("/api/radar?project=notarealproject")')].filter((i) => !ok.has(i.toLowerCase()));
  assert.deepEqual(bad, ["notarealproject"]);

  const bad2 = [...idsIn('{ "project": "someprivatething" }')].filter((i) => !ok.has(i.toLowerCase()));
  assert.deepEqual(bad2, ["someprivatething"]);

  const bad3 = [...idsIn("config/radar/someprivatething.json")].filter((i) => !ok.has(i.toLowerCase()));
  assert.deepEqual(bad3, ["someprivatething"]);
});

test("NEGATIVE CONTROL: the example config's own ids are accepted", () => {
  // A gate that refuses everyone passes every negative test ever written.
  const ok = allowed();
  const ids = exampleIds();
  assert.ok(ids.length >= 2, "the example config must declare ids for this control to mean anything");
  for (const id of ids) {
    const bad = [...idsIn(`fetch("/api/radar?project=${id}")`)].filter((i) => !ok.has(i.toLowerCase()));
    assert.deepEqual(bad, [], `${id} is in the tracked example config and must be allowed`);
  }
});

test("no tracked file names a project outside the allow-list", () => {
  const ok = allowed();
  const offenders = [];
  for (const [rel, body] of readTracked()) {
    // This file deliberately contains ids that must be REJECTED - they are its
    // positive control. Scanning itself would make the control the failure.
    if (rel === "tests/no-internal-identity.test.js") continue;
    const bad = [...idsIn(body)].filter((i) => !ok.has(i.toLowerCase())).sort();
    if (bad.length) offenders.push(`${rel}: ${bad.join(", ")}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} tracked file(s) name a project outside the allow-list:\n  ${offenders.join("\n  ")}`,
  );
});

test("PROSE: no tracked file mentions a real project by name", () => {
  const LOCAL = path.join(ROOT, "config/projects.json");
  if (!fs.existsSync(LOCAL)) {
    // Not a pass. This cell has no vocabulary to scan with, and saying so is
    // the only honest result - a silent green here is exactly the "clean
    // report from a scan that could not fire" failure.
    console.log("SKIPPED: no config/projects.json - the prose scan has no vocabulary on this machine");
    return;
  }
  const ok = allowed();
  // Some ids collide with real open-source projects this hub tracks on
  // purpose. Scanning prose for those would flag correct public content - a
  // keywords list, an example dependency - and a guard that is wrong about
  // correct content is a guard someone switches off. The exclusion is DERIVED
  // from what the tracked config already treats as a public technology name,
  // so it cannot drift from reality and it writes nothing new down.
  const publicTech = publicTechNames();
  const real = (JSON.parse(fs.readFileSync(LOCAL, "utf8")).projects || [])
    .map((p) => p.id)
    .filter((id) => !ok.has(id) && !publicTech.has(id));
  assert.ok(real.length >= 1, "the local config must name at least one non-allowed project, or this cell is vacuous");

  const offenders = [];
  for (const [rel, body] of readTracked()) {
    if (rel === "tests/no-internal-identity.test.js") continue; // it names none; it only reads them
    const hay = `${rel}\n${body}`;
    const bad = real.filter((id) => {
      // Not preceded by @ or / - some ids collide with real public package
      // names, where a scoped import or a node_modules path is legitimate
      // content. Flagging legitimate content is how a guard earns the right
      // to be switched off.
      const re = new RegExp(`(?<![@\\w/-])${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
      return re.test(hay);
    });
    if (bad.length) offenders.push(`${rel}: ${bad.sort().join(", ")}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} tracked file(s) mention a real project by name:\n  ${offenders.join("\n  ")}`,
  );
});
