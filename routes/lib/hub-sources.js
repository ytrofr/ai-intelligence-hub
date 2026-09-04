/**
 * The config reads that four surfaces share.
 *
 * These lived in routes/ledger.js and were re-exported off the end of it, so
 * five callers - two of them DOMAIN modules - had to `require("../routes/ledger")`
 * just to read a config file, constructing an Express router as a side effect of
 * asking for a list of rows. Same reads, same behaviour, no router.
 *
 * It stays under routes/ rather than moving to modules/ because it does IO and
 * knows where the files are. A domain module is pure and takes its rows as an
 * argument; that is why modules/ledger.js does not read a directory and must
 * not start.
 *
 * NOT the fifth reader: modules/inventory.js parses config/radar/*.json again,
 * with the directory injected. That is correct layering for a pure module, not
 * duplication to fold in here - and inventory.html is being retired anyway, so
 * that reader goes with it rather than being rehomed first.
 */

const fs = require("fs");
const path = require("path");
const { RadarStore, benchField, telemetryField, beforeAfterField } = require("./radar-store");

const ROOT = path.join(__dirname, "..", "..");
const RADAR_DIR = path.join(ROOT, "config", "radar");
const DEPS_FILE = path.join(ROOT, "config", "ledger", "deps.json");
const PROJECTS_FILE = path.join(ROOT, "config", "projects.json");

const store = new RadarStore(RADAR_DIR);

/** Every audited row from every radar config, with the reason intact. */
function readAllRadarRows() {
  const rows = [];
  for (const p of store.listProjects()) {
    if (p.id === "example") continue;
    try {
      const cfg = store.load(p.id);
      for (const r of cfg.audit || []) rows.push({ ...r, project: r.project || cfg.project || p.id });
    } catch (err) {
      // A single unreadable config must not empty the whole ledger.
      console.warn(`[hub-sources] unreadable radar config ${p.id}: ${err.message}`);
    }
  }
  return rows;
}

/**
 * Resolved dependencies, flattened to one entry per (repo, project).
 * Absent file is not an error — it means the backfill has not run yet, and the
 * ledger then honestly shows only the decisions.
 */
function readDepRepos() {
  if (!fs.existsSync(DEPS_FILE)) return { depRepos: [], generatedAt: null };
  try {
    const data = JSON.parse(fs.readFileSync(DEPS_FILE, "utf-8"));
    const depRepos = [];
    for (const d of data.deps || []) {
      for (const project of d.projects || []) depRepos.push({ repo: d.repo, project, pkg: d.pkg });
    }
    return { depRepos, generatedAt: data.generated_at || null };
  } catch (err) {
    console.warn(`[hub-sources] unreadable deps file: ${err.message}`);
    return { depRepos: [], generatedAt: null };
  }
}

/**
 * The project profiles.
 *
 * Read fresh each call rather than `require()`d, so a config edit is live
 * without a restart - the same property the radar store has, and the reason a
 * restore from backup needs no service bounce.
 */
function readProjects() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
    return cfg.projects || [];
  } catch (err) {
    console.warn(`[hub-sources] unreadable projects config: ${err.message}`);
    return [];
  }
}

/**
 * How many adoption fields on disk would be REFUSED if they were written
 * today. The store validates before every write, so a field can only get into
 * this state by being hand-edited straight into the JSON - and then it sits
 * there looking like evidence while the gate it was meant to satisfy would
 * reject it.
 *
 * Lives beside the readers rather than in modules/ledger.js because the
 * validators belong to the store, and a domain module must not reach up into
 * routes/ to ask.
 */
function countMalformedAdoptionFields(radarRows) {
  let bad = 0;
  for (const r of radarRows) {
    for (const [value, validate] of [
      [r.bench, benchField],
      [r.telemetry, telemetryField],
      [r.before_after, beforeAfterField],
    ]) {
      if (value === undefined || value === null) continue;
      try {
        validate(value);
      } catch {
        bad += 1;
      }
    }
  }
  return bad;
}

module.exports = {
  readAllRadarRows,
  readDepRepos,
  readProjects,
  countMalformedAdoptionFields,
  RADAR_DIR,
  DEPS_FILE,
  PROJECTS_FILE,
};
