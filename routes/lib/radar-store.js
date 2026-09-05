/**
 * Radar Store - per-project adoption verdicts (config/radar/<project>.json).
 * Row: { repo, topic, verdict: ADOPT|WATCH|SKIP, status: proposed|accepted|done|rejected,
 *        why, project, added_at, updated_at }
 * Hand-curated (Phase B dossiers fill it); writes are atomic (tmp + rename).
 *
 * Optional adoption fields (H3, all fail-closed, all absent-by-default so a
 * legacy row never gains a key it never had):
 *   kind          repo|dataset|model — an answer-key dataset and a dependency
 *                 repo can share a slug, so this cannot be inferred (see ledger.js)
 *   cost_tier     free|free-tier|paid-later
 *   licence       the licence as READ from the artifact (SPDX id, or a short
 *                 phrase when SPDX cannot express it: "Apache-2.0 + src/pro
 *                 carve-out"). Free text on purpose - GitHub answers
 *                 NOASSERTION for every source-available licence, and
 *                 flattening those to one enum is what let a row read
 *                 "cost: free" above a licence that forbids the use.
 *   hardware_fit  fits-gpu|fits-cpu|too-big-here|unmeasured
 *   hardware_mib  non-negative integer, paired with hardware_fit
 *   slot          "project/slot-name" — which ground-truth slot this feeds
 *   features      array of non-empty strings, deduped, order preserved
 *   score         { effort, effect, time, impact, risk: 1-5, basis: estimated|
 *                 measured, note }. ALL of it or none — a partial score is
 *                 refused rather than stored as zeros. basis "measured" needs
 *                 non-empty evidence (this call's or the row's own).
 *
 * Adoption-evidence fields (also H3-shaped: optional, fail-closed, absent by
 * default). Operator ruling 2026-09-04: this evidence lives on the EXISTING
 * ledger row, not on a separate page — so a `done` row is required to carry
 * all three (see setStatus below), the same way it is required to carry
 * evidence + a lesson + an eyeballed pair.
 *   bench         { run, date, result } — the pre-adoption measurement: we ran
 *                 this candidate against our own real data and here is the
 *                 number. `run` is a report file path (same shape as a
 *                 rejection's evidence); `result` is one line, <=200 chars.
 *   telemetry     { project, counters, url } — the LIVE counters that make
 *                 "did it help" a query instead of a claim. `counters` is a
 *                 non-empty array of non-empty counter names.
 *   before_after  { before, after, window, date } — the post-adoption
 *                 comparison, read from those same counters.
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

// H3 adoption fields — see the module doc comment above for what each means.
const KINDS = ["repo", "dataset", "model"];
const COST_TIERS = ["free", "free-tier", "paid-later"];
const HARDWARE_FITS = ["fits-gpu", "fits-cpu", "too-big-here", "unmeasured"];
const SCORE_BASES = ["estimated", "measured"];
const SCORE_DIMS = ["effort", "effect", "time", "impact", "risk"];
const SLOT_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BENCH_RESULT_MAX = 200;
// A live counters endpoint — deliberately just "an http(s) URL", not narrowed
// to :8776/:8772 like PAIR_RE: telemetry lives wherever the project exposes
// its own dashboard, which this store has no fixed list of.
const TELEMETRY_URL_RE = /^https?:\/\/\S+$/i;

const isInt1to5 = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

const enumField = (value, allowed, name) => {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join("|")} — got "${value}"`);
  return value;
};

const hardwareMibField = (value) => {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new Error(`hardware_mib must be a non-negative integer — got ${value}`);
  return value;
};

/** Read from the artifact, never inferred - so it is free text, bounded and
 * trimmed. An empty string is refused: "we did not look" must stay
 * distinguishable from "it has no licence", which is itself a finding. */
const LICENCE_MAX = 120;
const licenceField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error("licence must be a non-empty string - omit the field if it was never read");
  const out = value.trim();
  if (out.length > LICENCE_MAX) throw new Error(`licence must be at most ${LICENCE_MAX} chars - got ${out.length}`);
  return out;
};

const slotField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SLOT_RE.test(value)) {
    throw new Error(`slot must be "project/slot-name" (lowercase, digits, hyphens) — got "${value}"`);
  }
  return value;
};

const featuresField = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("features must be an array of non-empty strings");
  const seen = new Set();
  const out = [];
  for (const f of value) {
    if (typeof f !== "string" || !f.trim()) throw new Error("features must be non-empty strings");
    if (!seen.has(f)) {
      seen.add(f);
      out.push(f);
    }
  }
  return out;
};

// A partial score is refused rather than stored as zeros — see the module doc.
// `evidenceText` is what the row will carry once this write lands (this call's
// evidence, falling back to the row's own) — the only thing "measured" may rest on.
const scoreField = (value, evidenceText) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("score must be an object with effort, effect, time, impact, risk, basis, note");
  }
  const out = {};
  for (const dim of SCORE_DIMS) {
    if (!isInt1to5(value[dim])) throw new Error(`score.${dim} must be an integer 1-5 — got ${JSON.stringify(value[dim])}`);
    out[dim] = value[dim];
  }
  out.basis = enumField(value.basis, SCORE_BASES, "score.basis");
  if (out.basis === undefined) throw new Error(`score.basis must be one of ${SCORE_BASES.join("|")}`);
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (!note) throw new Error("score.note is required — the reasoning behind the numbers, never blank");
  out.note = note;
  if (out.basis === "measured" && !evidenceText) {
    throw new Error('score.basis "measured" needs evidence — set evidence on this row first (this call\'s or already on the row)');
  }
  return out;
};

/** "we ran this candidate against our own real data and here is the number" —
 * `run` is a report file path, same shape as a rejection's evidence (REPORT_RE),
 * never a URL or a commit: a bench is a measurement, not a build. All three
 * subfields are required together — a bench missing its result is not a bench,
 * it is a run nobody read. */
const benchField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("bench must be an object with run, date, result");
  }
  const run = typeof value.run === "string" ? value.run.trim() : "";
  if (!run) throw new Error("bench.run must be a non-empty path to a report file — omit bench if it was never run");
  if (!REPORT_RE.test(run)) {
    throw new Error(`bench.run must be a report file path (…/name.md|json|txt|csv|log) — got "${run}"`);
  }
  const date = typeof value.date === "string" ? value.date.trim() : "";
  if (!DATE_RE.test(date)) throw new Error(`bench.date must be YYYY-MM-DD — got "${date}"`);
  const result = typeof value.result === "string" ? value.result.trim() : "";
  if (!result) throw new Error("bench.result must be a non-empty string — one line, what the run measured");
  if (result.length > BENCH_RESULT_MAX) {
    throw new Error(`bench.result must be at most ${BENCH_RESULT_MAX} chars — got ${result.length}`);
  }
  return { run, date, result };
};

/**
 * "This dataset is not something we shipped - it is something that RUNS on a
 * cadence and grades an instrument." Operator ruling 2026-09-04: for a
 * benchmark, ADOPTED means wired as a recurring eval.
 *
 * Deliberately NOT a sixth status. A dataset moves through the same five
 * states; what differs is which evidence `done` demands of it, and that is a
 * property of the row, not of the funnel.
 *
 * The run LOG is not here either - it lives in the slot's own `ran[]` in
 * config/projects.json, and freshness is derived from it at READ time
 * (modules/eval-freshness.js). That is what makes a green eval unforgeable:
 * you cannot make this row look fresh by writing to this row, you have to
 * actually append a run.
 *
 * All five subfields are required together, same reasoning as bench: an eval
 * with no cadence is a run that happened once, and an eval with no metric is a
 * job whose output nobody reads.
 */
const evalField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("eval must be an object with slot, cadence_days, runner, metric, first_run");
  }
  const slot = typeof value.slot === "string" ? value.slot.trim() : "";
  if (!SLOT_RE.test(slot)) {
    throw new Error(`eval.slot must be "<project>/<slot>" - it names the instrument whose ran[] proves this runs, got "${slot}"`);
  }
  // A NUMBER, never "weekly". Staleness has to be computable, and a word is
  // not a comparison anyone can make.
  const cadence = value.cadence_days;
  if (!Number.isInteger(cadence) || cadence < 1 || cadence > 365) {
    throw new Error(`eval.cadence_days must be an integer 1-365 - got ${JSON.stringify(cadence)}`);
  }
  const runner = typeof value.runner === "string" ? value.runner.trim() : "";
  if (!runner) throw new Error("eval.runner must say where the recurring job is defined - omit eval if nothing runs it");
  if (runner.length > 120) throw new Error(`eval.runner must be at most 120 chars - got ${runner.length}`);
  const metric = typeof value.metric === "string" ? value.metric.trim() : "";
  if (!metric) throw new Error("eval.metric must name the ONE number this eval gates - it is what before_after compares");
  if (metric.length > 200) throw new Error(`eval.metric must be at most 200 chars - got ${metric.length}`);
  const firstRun = typeof value.first_run === "string" ? value.first_run.trim() : "";
  if (!REPORT_RE.test(firstRun)) {
    throw new Error(`eval.first_run must be a report file path (…/name.md|json|txt|csv|log) - a measurement, not a commit - got "${firstRun}"`);
  }
  return { slot, cadence_days: cadence, runner, metric, first_run: firstRun };
};

/** The live counters that make "did it help" a query, not a claim. `counters`
 * is a non-empty array of non-empty names — an empty array is refused rather
 * than silently meaning "no counters", which is indistinguishable from "we
 * never named them".
 *
 * TWO POINTERS, and they are different facts:
 *
 *   url     WHERE THE COUNTERS ARE READ — something a person can open
 *   source  WHERE THEY ARE EMITTED — `path::symbol`, a log line, a exporter
 *
 * They were one slot until 2026-09-04, and the one live row that filled it had
 * put an emitter there: `app/services/egress_policy.py::counter_snapshot +
 * log '…'`. Widening `url` to accept that would have re-classified "we named
 * the emitter" as "we have a dashboard", which is the whole claim telemetry
 * makes. So the datum was split instead, and the regex is untouched.
 *
 * At least ONE must be present — telemetry with neither names nothing. But the
 * CLOSE GATE demands `url` specifically: an emitter nobody reads cannot answer
 * "did it help", which is the only question `done` is asking.
 */
const telemetryField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("telemetry must be an object with project, counters, and a url and/or a source");
  }
  const project = typeof value.project === "string" ? value.project.trim() : "";
  if (!project) throw new Error("telemetry.project must be a non-empty project id");
  if (!Array.isArray(value.counters) || value.counters.length === 0) {
    throw new Error("telemetry.counters must be a non-empty array of counter names");
  }
  const counters = [];
  for (const c of value.counters) {
    if (typeof c !== "string" || !c.trim()) throw new Error("telemetry.counters must be non-empty strings");
    counters.push(c.trim());
  }
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const source = typeof value.source === "string" ? value.source.trim() : "";
  if (!url && !source) {
    throw new Error(
      "telemetry needs a url (where the counters are READ) or a source (where they are EMITTED) — " +
        "with neither it names nothing. Closing as done still requires the url.",
    );
  }
  if (url && !TELEMETRY_URL_RE.test(url)) {
    throw new Error(
      `telemetry.url must be an http(s) URL — got "${url}". ` +
        "A file path or a symbol is a SOURCE, not a url: put it in telemetry.source. " +
        "Never invent an endpoint nobody serves.",
    );
  }
  if (source.length > 200) throw new Error(`telemetry.source must be at most 200 chars — got ${source.length}`);
  const out = { project, counters };
  if (url) out.url = url;
  if (source) out.source = source;
  return out;
};

/** The post-adoption comparison, read from those same live counters. All four
 * subfields required together, same reasoning as bench: a before/after with
 * no window is not a comparison anyone can trust. */
const beforeAfterField = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("before_after must be an object with before, after, window, date");
  }
  const before = typeof value.before === "string" ? value.before.trim() : "";
  if (!before) throw new Error("before_after.before must be a non-empty string");
  const after = typeof value.after === "string" ? value.after.trim() : "";
  if (!after) throw new Error("before_after.after must be a non-empty string");
  const win = typeof value.window === "string" ? value.window.trim() : "";
  if (!win) throw new Error('before_after.window must be a non-empty string (e.g. "7d")');
  const date = typeof value.date === "string" ? value.date.trim() : "";
  if (!DATE_RE.test(date)) throw new Error(`before_after.date must be YYYY-MM-DD — got "${date}"`);
  return { before, after, window: win, date };
};

/**
 * Validate the H3 optional fields on an upsertRow input. Returns only the keys
 * that were present and valid; an absent key comes back `undefined` so the
 * caller's `??` merge leaves the row untouched. Throws on the first invalid
 * value — nothing is written before this runs.
 */
function adoptionFields(input, existingEvidence) {
  const evidenceText = (typeof input.evidence === "string" ? input.evidence.trim() : "") || existingEvidence || "";
  return {
    kind: enumField(input.kind, KINDS, "kind"),
    cost_tier: enumField(input.cost_tier, COST_TIERS, "cost_tier"),
    licence: licenceField(input.licence),
    hardware_fit: enumField(input.hardware_fit, HARDWARE_FITS, "hardware_fit"),
    hardware_mib: hardwareMibField(input.hardware_mib),
    slot: slotField(input.slot),
    features: featuresField(input.features),
    score: scoreField(input.score, evidenceText),
    bench: benchField(input.bench),
    telemetry: telemetryField(input.telemetry),
    before_after: beforeAfterField(input.before_after),
    eval: evalField(input.eval),
  };
}

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
   * `done` additionally requires `bench`, `telemetry` and `before_after` to
   * already be on the row (operator ruling 2026-09-04: "adopted" means bench +
   * telemetry + before/after, not "merged"). Unlike evidence/lesson/pair/
   * eyeballed, those three are NOT accepted here in `fields` — they are set on
   * the row via `upsertRow`, the same way licence or score are, since they
   * describe the candidate rather than this particular closure. `rejected`
   * does not require them: a rejected candidate was never adopted.
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

    // `evidence` and `lesson` describe a CLOSURE, and the non-closing branch
    // below deletes them for a good reason: a row moving off `done` is reopened,
    // and evidence for a closure that no longer holds is a stale claim. But that
    // branch cannot tell a REOPEN from a caller trying to RECORD one on an open
    // row, so it gave the second case the first case's treatment and returned
    // success. Read the CALL, never the row: a reopen supplies nothing and must
    // still work, which is why this tests `fields` and not `next`.
    if (!CLOSING.has(status)) {
      const supplied = ["evidence", "lesson"].filter((k) => text(fields[k]));
      if (supplied.length) {
        const s = supplied.join(" and ");
        console.warn(`[radar] refused ${s} on ${project}/${repo} at status="${status}"`);
        throw new Error(
          `${s} cannot be set by a status change to "${status}": they are closure fields, ` +
            "and this call would delete them again the moment a row reopens. " +
            "Set them on the row itself - POST /api/radar/row (upsertRow) keeps them at any status.",
        );
      }
    }

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

      // Operator ruling 2026-09-04: "adopted" means bench + telemetry +
      // before/after, not "merged". These are set on the row itself via
      // upsertRow (like licence, kind, ...), never via `fields` here — closing
      // just checks they are already there. Rejected needs none of this: a
      // rejected candidate was never adopted, so a post-adoption comparison
      // does not apply to it.
      //
      // The "did we actually use it" half is ROUTED BY KIND, because the same
      // question has a different answer for different things:
      //
      //   repo (or unset)  telemetry — a library shipping in production is
      //                    observable there, and an eval does not show that
      //   dataset          eval — an answer key has no runtime counters at
      //                    all; adopted means WIRED AS A RECURRING EVAL
      //   model            either — both deployments are real
      //
      // Honest note, correcting this plan's own claim: this is NOT
      // stricter-or-equal in every branch. A dataset carrying telemetry and no
      // eval used to close and no longer does (stricter), but a dataset
      // carrying an eval and no telemetry used to be refused and now closes
      // (looser). That second direction is the point — it is what lets a
      // benchmark be adopted at all — and `eval` is a validated artifact, not
      // a waiver. Saying it plainly beats letting a reader discover it.
      if (status === "done") {
        const requireAdoption = (name, value, validator, hint) => {
          if (value === undefined) refuse(`missing ${name}: ${hint}`);
          try {
            validator(value);
          } catch (e) {
            refuse(`${name} is malformed: ${e.message}`);
          }
        };
        requireAdoption(
          "bench",
          row.bench,
          benchField,
          'the pre-adoption measurement — { run, date, result }. Set it on the row first (`upsertRow`), same as licence or score.',
        );

        const kind = text(row.kind) || "repo";
        const TELEMETRY_HINT =
          'the live counters that make "did it help" a query — { project, counters, url }. ' +
          "The URL is the part that matters here: a source pointer says where the numbers are emitted, " +
          "not where anyone reads them, and nobody can check an adoption against a symbol name.";
        // A telemetry block carrying only a `source` is a real record and a
        // legal field — it is just not an answer to "did it help". The gate
        // says which half is missing rather than "missing telemetry", because
        // the row visibly HAS telemetry and that error would read as a bug.
        const requireReadableTelemetry = () => {
          requireAdoption("telemetry", row.telemetry, telemetryField, TELEMETRY_HINT);
          if (!row.telemetry.url) {
            refuse(
              "telemetry names where the counters are EMITTED " +
                `("${row.telemetry.source}") and not where they are READ. ` +
                "Point telemetry.url at something openable, or leave the row open: " +
                "an emitter with no reader cannot show that this helped.",
            );
          }
        };
        const EVAL_HINT =
          "the recurring eval this is wired into — { slot, cadence_days, runner, metric, first_run }. " +
          "For a benchmark, adopted means it RUNS on a cadence; the runs themselves live in the slot's ran[].";

        if (kind === "dataset") {
          requireAdoption("eval", row.eval, evalField, EVAL_HINT);
        } else if (kind === "model") {
          // Exactly one is enough, but SOMETHING must be there — a deployed
          // model with neither is a claim with no reader.
          const hasEval = row.eval !== undefined;
          const hasTelemetry = row.telemetry !== undefined;
          if (!hasEval && !hasTelemetry) {
            refuse(
              "missing eval or telemetry: a model is adopted either as a recurring eval or as something " +
                `production emits counters for. ${EVAL_HINT} ${TELEMETRY_HINT}`,
            );
          }
          if (hasEval) requireAdoption("eval", row.eval, evalField, EVAL_HINT);
          if (hasTelemetry) requireReadableTelemetry();
        } else {
          requireReadableTelemetry();
        }

        requireAdoption(
          "before_after",
          row.before_after,
          beforeAfterField,
          "the post-adoption comparison, read from those counters — { before, after, window, date }.",
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
    // Validated BEFORE anything is written — a refusal must leave the row (or a
    // not-yet-created row) exactly as it was, same discipline as setStatus.
    const f = adoptionFields(input, row && row.evidence);
    if (row) {
      Object.assign(row, {
        topic: input.topic ?? row.topic,
        verdict: input.verdict,
        why: input.why ?? row.why,
        outcome: input.outcome ?? row.outcome,
        evidence: input.evidence ?? row.evidence,
        lesson: input.lesson ?? row.lesson,
        kind: f.kind ?? row.kind,
        cost_tier: f.cost_tier ?? row.cost_tier,
        licence: f.licence ?? row.licence,
        hardware_fit: f.hardware_fit ?? row.hardware_fit,
        hardware_mib: f.hardware_mib ?? row.hardware_mib,
        slot: f.slot ?? row.slot,
        features: f.features ?? row.features,
        score: f.score ?? row.score,
        bench: f.bench ?? row.bench,
        telemetry: f.telemetry ?? row.telemetry,
        before_after: f.before_after ?? row.before_after,
        eval: f.eval ?? row.eval,
        updated_at: now,
      });
    } else {
      row = {
        repo: input.repo, topic: input.topic || "general", verdict: input.verdict, status: "proposed",
        why: input.why || "", outcome: input.outcome || "", evidence: input.evidence || "", lesson: input.lesson || "",
        kind: f.kind, cost_tier: f.cost_tier, licence: f.licence,
        hardware_fit: f.hardware_fit, hardware_mib: f.hardware_mib,
        slot: f.slot, features: f.features, score: f.score,
        bench: f.bench, telemetry: f.telemetry, before_after: f.before_after, eval: f.eval,
        project, added_at: now, updated_at: now,
      };
      cfg.audit.push(row);
    }
    this.save(project, cfg);
    return row;
  }
}

// The adoption-field validators are exported so a READER can ask the same
// question the writer asks. A row hand-edited into the JSON never passes
// through upsertRow, so without this the ledger cannot tell a field that
// would be refused today from one that was written properly.
module.exports = {
  RadarStore,
  VERDICTS,
  STATUSES,
  EVIDENCE_RE,
  REPORT_RE,
  PAIR_RE,
  benchField,
  telemetryField,
  beforeAfterField,
  evalField,
};
