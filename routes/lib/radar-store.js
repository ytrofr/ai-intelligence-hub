/**
 * Radar Store - per-project adoption verdicts (config/radar/<project>.json).
 * Row: { repo, topic, verdict: ADOPT|WATCH|SKIP, status: proposed|accepted|done|rejected,
 *        why, project, added_at, updated_at }
 * Hand-curated (Phase B dossiers fill it); writes are atomic (tmp + rename).
 */

const fs = require("fs");
const path = require("path");

const VERDICTS = ["ADOPT", "WATCH", "SKIP"];
const STATUSES = ["proposed", "accepted", "done", "rejected"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// What counts as evidence: a bare or project-qualified commit sha, an issue/PR
// reference, or a URL. Deliberately narrow — "we did this ages ago" is exactly
// the unverifiable click this gate exists to replace.
const EVIDENCE_RE = /^(https?:\/\/\S+|[\w.-]+[@#][\w.\/-]+|[0-9a-f]{7,40})$/i;

class RadarStore {
  constructor(dir) {
    this.dir = dir;
  }

  file(project) {
    if (!ID_RE.test(String(project || ""))) throw new Error(`invalid project id: ${project}`);
    return path.join(this.dir, `${project}.json`);
  }

  listProjects() {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const id = f.replace(/\.json$/, "");
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf-8"));
          return { id, title: cfg.title || cfg.project || id, rows: (cfg.audit || []).length, updated: cfg.updated || null };
        } catch {
          return { id, title: id, rows: 0, updated: null, error: "unparseable" };
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  load(project) {
    const f = this.file(project);
    if (!fs.existsSync(f)) throw new Error(`unknown project: ${project}`);
    const cfg = JSON.parse(fs.readFileSync(f, "utf-8"));
    cfg.project = cfg.project || project;
    cfg.audit = cfg.audit || [];
    return cfg;
  }

  save(project, cfg) {
    const f = this.file(project);
    const tmp = `${f}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
    fs.renameSync(tmp, f);
  }

  /**
   * Set a row's status. `done` additionally requires EVIDENCE — the commit, PR
   * or URL that did it.
   *
   * Accepting is a decision and needs no backing. `done` is a claim about the
   * world, and an unbacked one turns the adoption count into a count of clicks:
   * every row can be marked finished by whoever is looking at the page, and
   * nothing afterwards can tell a real integration from an intention.
   *
   * The validation runs BEFORE anything is written, so a refusal leaves the row
   * exactly as it was. A half-applied refusal would be worse than no gate at
   * all — the row would read `done` with nothing behind it.
   */
  setStatus(project, repo, status, { evidence } = {}) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join("|")}`);
    if (status === "done") {
      const e = String(evidence || "").trim();
      if (!e) throw new Error('status "done" requires evidence: the commit, PR or URL that did it (e.g. "apollo@3f9a12c")');
      if (!EVIDENCE_RE.test(e)) {
        throw new Error(`evidence must name a commit, PR or URL — got "${e}". Examples: apollo@3f9a12c · hermes#123 · https://github.com/o/r/pull/7`);
      }
      evidence = e;
    }

    const cfg = this.load(project);
    const row = cfg.audit.find((r) => r.repo === repo);
    if (!row) throw new Error(`repo not in radar: ${repo}`);

    row.status = status;
    row.updated_at = new Date().toISOString();
    if (status === "done") {
      row.evidence = evidence;
      row.done_at = row.updated_at;
    } else {
      // Evidence for a done-ness that no longer holds is a stale claim, not history.
      delete row.evidence;
      delete row.done_at;
    }
    this.save(project, cfg);
    return row;
  }

  upsertRow(project, input) {
    if (!VERDICTS.includes(input.verdict)) throw new Error(`verdict must be one of ${VERDICTS.join("|")}`);
    if (!input.repo || !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) throw new Error("repo must be owner/name");
    const cfg = this.load(project);
    const now = new Date().toISOString();
    let row = cfg.audit.find((r) => r.repo === input.repo);
    if (row) {
      Object.assign(row, { topic: input.topic ?? row.topic, verdict: input.verdict, why: input.why ?? row.why, updated_at: now });
    } else {
      row = { repo: input.repo, topic: input.topic || "general", verdict: input.verdict, status: "proposed", why: input.why || "", project, added_at: now, updated_at: now };
      cfg.audit.push(row);
    }
    this.save(project, cfg);
    return row;
  }
}

module.exports = { RadarStore, VERDICTS, STATUSES, EVIDENCE_RE };
