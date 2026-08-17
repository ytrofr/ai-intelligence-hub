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

// The PAIR the operator actually looked at: a Decision Board card (8776) or a
// Visual Hall batch (8772). A report PATH is deliberately NOT accepted — nobody
// eyeballs a markdown file, and `evidence` already holds that. Operator law
// 2026-08-17: ~/.claude/rules/quality/adoption-needs-an-eyeballed-before-after.md
const PAIR_RE = /^https?:\/\/(localhost|127\.0\.0\.1):(8776|8772)\/\S*$/i;

// Their verdict and when: "adopt 2026-08-17T11:42Z". `not-yet` is a real answer
// the board can return, so it parses here — and is refused for CLOSING below,
// because a row must not close on an undecided one.
const EYEBALLED_RE = /^(adopt|reject|not-yet)\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)$/i;

// Which verdict each closing status is allowed to rest on. A `done` filed against
// a `reject` verdict is not a bookkeeping slip; it is the operator's answer being
// overridden by the session that asked the question.
const VERDICT_FOR = { done: "adopt", rejected: "reject" };

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
   * @param {object} [fields] - { outcome, evidence, lesson, pair, eyeballed }
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
      pair: text(fields.pair) || text(row.pair),
      eyeballed: text(fields.eyeballed) || text(row.eyeballed),
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

      // Evidence and a lesson make a decision REUSABLE. They do not make it the
      // operator's decision — four rows closed with both, on a session's own
      // measurement, that the operator had never been shown.
      if (!next.pair) {
        refuse(
          "missing pair: the board card carrying BOTH ARMS on our own material. " +
            'Build it with `/stack pair <repo>`, then post it (e.g. "http://localhost:8776/?session=…#id")',
        );
      }
      if (!PAIR_RE.test(next.pair)) {
        refuse(
          `pair must be a Decision Board card (:8776) or a Visual Hall batch (:8772) — got "${next.pair}". ` +
            "A report path is evidence, not a pair: nobody eyeballs a markdown file.",
        );
      }
      if (!next.eyeballed) {
        refuse(
          "missing eyeballed: the operator's verdict on that pair — " +
            '"adopt|reject <ISO timestamp>". Read it with `decide.py read --peek`; never write it before they answer.',
        );
      }
      const verdict = EYEBALLED_RE.exec(next.eyeballed);
      if (!verdict) {
        refuse(
          `eyeballed must be "adopt|reject|not-yet <ISO timestamp>" — got "${next.eyeballed}". ` +
            'Example: "adopt 2026-08-17T11:42Z"',
        );
      }
      const verb = verdict[1].toLowerCase();
      if (verb === "not-yet") {
        refuse(
          "the operator has not decided yet (verdict is not-yet) — a row does not close on an undecided pair",
        );
      }
      if (verb !== VERDICT_FOR[status]) {
        refuse(
          `the verdict contradicts the status: they said "${verb}", you are filing "${status}" ` +
            `(which needs "${VERDICT_FOR[status]}"). Their answer wins — change the status, not the verdict.`,
        );
      }
    }

    row.status = status;
    row.updated_at = new Date().toISOString();
    if (next.outcome) row.outcome = next.outcome;

    if (CLOSING.has(status)) {
      row.evidence = next.evidence;
      row.lesson = next.lesson;
      row.pair = next.pair;
      row.eyeballed = next.eyeballed;
      row.done_at = row.updated_at;
    } else {
      // Evidence for a closure that no longer holds is a stale claim, not history.
      // The lesson goes with it: it described an outcome that has been reopened.
      //
      // The PAIR AND THE VERDICT STAY. They used to be deleted here too, on the
      // reasoning that "a verdict is an answer about a closure" — which is wrong,
      // and using the gate for real is what showed it. The operator looked at the
      // trafilatura pair and said ADOPT; acting on that answer moves the row OFF
      // `rejected`, and this branch then erased the answer at the exact moment it
      // was being honoured. The law is explicit that `accepted` needs an eyeballed
      // pair as much as `done` does, so an accepted row with no verdict on it is
      // the state the law exists to forbid.
      row.pair = next.pair;
      row.eyeballed = next.eyeballed;
      if (!row.pair) delete row.pair;
      if (!row.eyeballed) delete row.eyeballed;
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
