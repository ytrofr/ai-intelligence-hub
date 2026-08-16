/**
 * Radar Store - per-project adoption verdicts (config/radar/<project>.json).
 * Row: { repo, topic, verdict: ADOPT|WATCH|SKIP, status: proposed|accepted|done|rejected,
 *        why, project, added_at, updated_at }
 * Hand-curated (Phase B dossiers fill it); writes are atomic (tmp + rename).
 */

const fs = require("fs");
const path = require("path");

const VERDICTS = ["ADOPT", "WATCH", "SKIP"];
const STATUSES = ["proposed", "accepted", "trial", "done", "rejected"];
// Closing a row is the moment a decision has to become knowledge — see setStatus.
const CLOSING = new Set(["done", "rejected"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

// What counts as evidence that something was BUILT: a bare or project-qualified
// commit sha, an issue/PR reference, or a URL. Deliberately narrow — "we did this
// ages ago" is exactly the unverifiable click this gate exists to replace.
const EVIDENCE_RE = /^(https?:\/\/\S+|[\w.-]+[@#][\w.\/-]+|[0-9a-f]{7,40})$/i;

// A REJECTION built nothing, so it can have no commit. Its evidence is the
// measurement that settled it — a report file. Requiring a sha here would make
// rejections unclosable, and an unclosable rejection is the row that never gets
// written at all, which is the one another project most needs to read.
const REPORT_RE = /^(~|\.{0,2}\/)[\w.\/@ -]+\.(md|json|txt|csv|log)$/i;

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
   * Set a row's status. CLOSING a row (`done` or `rejected`) requires EVIDENCE
   * and a LESSON.
   *
   * Accepting is a decision and needs no backing. Closing is a claim about the
   * world, and an unbacked one turns the adoption count into a count of clicks:
   * every row can be marked finished by whoever is looking at the page, and
   * nothing afterwards can tell a real integration from an intention.
   *
   * `rejected` is gated for the same reason and takes a different SHAPE of
   * evidence: a rejection built nothing, so it has no commit — what settles it
   * is the measurement, i.e. a report file. Demanding a sha there would make
   * rejections unclosable, and the rejection is the row another project most
   * needs to read ("we measured this and got 3.58%").
   *
   * `lesson` is what turns the decision into knowledge the rest of the stack can
   * use. Without it, "why did we stop using that?" is answerable only by whoever
   * was in the session, and they are gone. `none - <why not>` is a legitimate
   * answer: it is a sentence someone chose to write, which a blank field is not.
   *
   * The validation runs BEFORE anything is written, so a refusal leaves the row
   * exactly as it was. A half-applied refusal would be worse than no gate at
   * all — the row would read `done` with nothing behind it. The refusal is also
   * logged, so a session that quietly gives up on closing a row leaves a trace.
   *
   * @param {object} [fields] - { outcome, evidence, lesson }
   */
  setStatus(project, repo, status, fields = {}) {
    if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join("|")}`);

    const text = (v) => (typeof v === "string" ? v.trim() : "");
    const cfg = this.load(project);
    const row = cfg.audit.find((r) => r.repo === repo);
    if (!row) throw new Error(`repo not in radar: ${repo}`);

    // Fall back to what the row already carries, so re-closing a documented row
    // does not demand the fields again.
    const next = {
      outcome: text(fields.outcome) || text(row.outcome),
      evidence: text(fields.evidence) || text(row.evidence),
      lesson: text(fields.lesson) || text(row.lesson),
    };

    if (CLOSING.has(status)) {
      const refuse = (msg) => {
        console.warn(`[radar] refused to close ${project}/${repo} as ${status}: ${msg}`);
        throw new Error(`cannot set status="${status}" on ${repo}: ${msg}`);
      };
      if (!next.evidence) {
        refuse(
          status === "done"
            ? 'missing evidence: the commit, PR or URL that did it (e.g. "apollo@3f9a12c")'
            : 'missing evidence: the report or measurement that settled it (e.g. "~/.claude/reports/spike.md")',
        );
      }
      const shapeOk =
        EVIDENCE_RE.test(next.evidence) || (status === "rejected" && REPORT_RE.test(next.evidence));
      if (!shapeOk) {
        refuse(
          `evidence must name a commit, PR or URL${status === "rejected" ? " or a report file" : ""} — got "${next.evidence}". ` +
            `Examples: apollo@3f9a12c · hermes#123 · https://github.com/o/r/pull/7` +
            (status === "rejected" ? ` · ~/.claude/reports/spike.md` : ""),
        );
      }
      if (!next.lesson) {
        refuse('missing lesson: the rule path, skill, or "none - <why not>" this taught us');
      }
    }

    row.status = status;
    row.updated_at = new Date().toISOString();
    if (next.outcome) row.outcome = next.outcome;

    if (CLOSING.has(status)) {
      row.evidence = next.evidence;
      row.lesson = next.lesson;
      row.done_at = row.updated_at;
    } else {
      // Evidence for a closure that no longer holds is a stale claim, not history.
      // The lesson goes with it: it described an outcome that has been reopened.
      delete row.evidence;
      delete row.lesson;
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
      Object.assign(row, {
        topic: input.topic ?? row.topic,
        verdict: input.verdict,
        why: input.why ?? row.why,
        outcome: input.outcome ?? row.outcome,
        evidence: input.evidence ?? row.evidence,
        lesson: input.lesson ?? row.lesson,
        updated_at: now,
      });
    } else {
      row = {
        repo: input.repo, topic: input.topic || "general", verdict: input.verdict, status: "proposed",
        why: input.why || "", outcome: input.outcome || "", evidence: input.evidence || "", lesson: input.lesson || "",
        project, added_at: now, updated_at: now,
      };
      cfg.audit.push(row);
    }
    this.save(project, cfg);
    return row;
  }
}

module.exports = { RadarStore, VERDICTS, STATUSES, EVIDENCE_RE, REPORT_RE };
