/**
 * Slot Gate - which of OUR INSTRUMENTS can a discovered reference actually grade?
 *
 * Factored out of modules/huggingface.js (H4, 2026-09-03). The gate used to be
 * reachable only from the HuggingFace feed, so a slot of kind `package` or
 * `service` - graded by a GitHub REPO, not an HF dataset or model - could never
 * be filled: github-discovery.js built its own items and never called into the
 * matcher at all. This module is the shared gate both feeds call.
 *
 * Slot KIND vocabulary. A slot's `kind` names WHICH SOURCE can ever fill it:
 *
 *   ground-truth  - an HF dataset is the answer key            (legacy: "dataset", the default)
 *   model         - an HF model is the thing under test
 *   package       - a GitHub repo, imported as a dependency
 *   service       - a GitHub repo, run as a service
 *   skill-eval    - recorded for the ground-truth page only; no feed can ever supply it
 *
 * `dataset` is kept as a permanent alias for `ground-truth` - the live
 * config/projects.json shipped 11 slots under that literal string before this
 * vocabulary existed, and a rename that silently stopped matching them would be
 * a regression indistinguishable from "the feed went quiet".
 *
 * FAILS CLOSED on every unknown, same discipline throughout: an unrecognised
 * kind, a missing licence, an absent subject declaration on a package/service
 * slot - all refuse rather than pass, because the cost of a false ACCEPT is the
 * operator being handed something that cannot grade anything, while the cost of
 * a false MISS is one row in the near-miss log - the corpus for the next slot.
 */

// ---------------------------------------------------------------------------
// HF-only tables - the dataset "row count" gate and the "may this be run
// without asking" gate. Verbatim from the original modules/huggingface.js.
// ---------------------------------------------------------------------------

/**
 * HuggingFace publishes a dataset's size as a ROW-COUNT bucket; our slots declare
 * a DISK budget in megabytes. A slot admits a bucket whose LOWER bound is under
 * its budget - a refusal costs one row in the near-miss log, a false accept is
 * how a ten-billion-row corpus gets offered as an answer key. An unrecognised
 * or absent bucket is refused, like every other unknown in this file.
 */
const SIZE_BUCKET_FLOOR = {
  "n<1k": 0,
  "1k<n<10k": 1e3,
  "10k<n<100k": 1e4,
  "100k<n<1m": 1e5,
  "1m<n<10m": 1e6,
  "10m<n<100m": 1e7,
  "100m<n<1b": 1e8,
  "1b<n<10b": 1e9,
  "10b<n<100b": 1e10,
  "100b<n<1t": 1e11,
  "n>1t": 1e12,
};
const ROWS_PER_MB = 1000;
const DEFAULT_SLOT_CAP_MB = 500;

/**
 * Licences under which we may actually USE the data commercially - the
 * "cheap run" gate. Enumerating what is SAFE (not what is forbidden) is what
 * makes an unrecognised or missing licence a refusal instead of a pass.
 */
const PERMISSIVE_LICENSES = new Set([
  "apache-2.0", "mit", "bsd", "bsd-3-clause", "bsd-2-clause",
  "cc-by-4.0", "cc-by-3.0", "cc0-1.0", "odc-by", "odbl", "openrail",
]);

/** The row-count buckets a cheap run may have. An ALLOWLIST, same reason as above. */
const CHEAP_RUN_SIZES = new Set(["n<1k", "1k<n<10k", "10k<n<100k"]);

/**
 * Depth-ranked gate reasons, shared by every slot kind. `slotMissReason` reads
 * this to report the CLOSEST slot's verdict rather than the first one tried -
 * a slot that fails a later gate got further. `wrong-source` is the shallowest
 * entry on purpose: a kind/source mismatch says nothing about the reference's
 * CONTENT, so it must never outrank a real content gate when both are in play.
 */
const SLOT_MISS_DEPTH = [
  "no-slot-of-this-kind",
  "wrong-source",
  "slot-declares-no-tasks",
  "task-not-graded",
  "wrong-language",
  "slot-declares-no-licences",
  "licence-unknown",
  "licence-not-allowed",
  "too-big-for-this-slot",
  "slot-declares-no-subject",
  "wrong-subject",
];

/** `dataset` is the legacy spelling of `ground-truth`; every other kind passes through. */
function normalizeSlotKind(kind) {
  const k = kind || "dataset";
  return k === "dataset" ? "ground-truth" : k;
}

/**
 * Does this slot's normalized kind belong to the SOURCE that produced `facts`?
 * A `ground-truth`/`model` slot can only ever be filled by the HF feed, and a
 * `package`/`service` slot only by the GitHub feed - `skill-eval` by neither.
 */
function isCompatibleKind(normKind, facts) {
  if (facts.source === "hf") {
    if (normKind === "ground-truth") return facts.hfKind === "dataset";
    if (normKind === "model") return facts.hfKind === "model";
    return false;
  }
  if (facts.source === "github") {
    return normKind === "package" || normKind === "service";
  }
  return false;
}

/**
 * The raw facts an HF dataset or model gate reads, lifted once per item so
 * `matchSlots` and `slotMissReason` cannot drift apart. Verbatim from
 * `HuggingFaceModule#_slotFacts`.
 */
function slotFactsFromHf(raw, kind = "dataset") {
  const tags = (raw.tags || []).map(String);
  const valuesOf = (prefix) =>
    tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length).toLowerCase());

  const tasks = kind === "dataset"
    ? valuesOf("task_categories:")
    : [raw.pipeline_tag].filter(Boolean).map((t) => String(t).toLowerCase());
  // HF writes a language either as `language:he` or as a bare `he` tag.
  const langs = [...valuesOf("language:"), ...tags.filter((t) => /^[a-z]{2,3}$/.test(t))];
  const licenceTag = tags.find((t) => t.toLowerCase().startsWith("license:"));
  const licence = licenceTag ? licenceTag.slice("license:".length).toLowerCase() : null;
  const bucket = valuesOf("size_categories:")[0] || null;
  // Declared fields only - id, pretty name, tags - never the card body/README.
  const text = [raw.id, raw.title, (raw.cardData || {}).pretty_name, ...tags]
    .filter(Boolean).join(" ").toLowerCase();
  return { source: "hf", hfKind: kind, tasks, langs, licence, bucket, text };
}

/**
 * The raw facts a GitHub package/service gate reads. Accepts either the raw
 * GitHub API repo payload (`license.spdx_id`, `full_name`, `topics`) or an
 * already-normalized item (`metadata.license`, `title`) - github-discovery.js
 * calls this from inside `normalizeRepo`, before the raw payload is folded
 * into the normalized shape, but a fixture built either way must work.
 */
function slotFactsFromGithub(item) {
  const raw = item || {};
  const meta = raw.metadata || {};
  const licenseObj = raw.license || {};
  const licenceRaw = meta.license !== undefined ? meta.license : (licenseObj || {}).spdx_id;
  const languageRaw = meta.language !== undefined ? meta.language : raw.language;
  const topics = meta.topics || raw.topics || [];
  const title = raw.title || raw.full_name || meta.full_name || "";
  const description = raw.description || meta.description || "";
  const text = [title, description, ...topics].filter(Boolean).join(" ").toLowerCase();
  return {
    source: "github",
    licence: licenceRaw ? String(licenceRaw).toLowerCase() : null,
    language: languageRaw ? String(languageRaw).toLowerCase() : null,
    text,
    tasks: [],
    bucket: null,
  };
}

/** The HF dataset/model gate chain. Verbatim order from `_slotVerdict`. */
function hfSlotVerdict(slot, facts) {
  const wantTasks = slot.task_categories || [];
  // An empty declaration is a recorded ABSENCE and must match nothing - reading
  // it as "matches everything" is the classic fail-open.
  if (!wantTasks.length) return "slot-declares-no-tasks";
  const want = wantTasks.map((w) => String(w).toLowerCase());
  if (!facts.tasks.some((t) => want.includes(t))) return "task-not-graded";

  if (slot.language && !facts.langs.includes(String(slot.language).toLowerCase())) {
    return "wrong-language";
  }

  const allowed = (slot.licence_ok || []).map((l) => String(l).toLowerCase());
  if (!allowed.length) return "slot-declares-no-licences";
  if (!facts.licence) return "licence-unknown"; // silence is not permission
  if (!allowed.includes(facts.licence)) return "licence-not-allowed";

  const capMb = slot.size_cap_mb === undefined ? DEFAULT_SLOT_CAP_MB : Number(slot.size_cap_mb);
  if (Number.isFinite(capMb) && capMb > 0) {
    const floor = SIZE_BUCKET_FLOOR[String(facts.bucket || "").toLowerCase()];
    if (floor === undefined) return "too-big-for-this-slot"; // unknown or absent: fail closed
    if (floor >= capMb * ROWS_PER_MB) return "too-big-for-this-slot";
  }

  // SUBJECT is UNVETTED, not narrowed, when the slot declares none - see the
  // long rationale on the original `_slotVerdict`. That stays HF-only: a
  // package/service slot fails closed instead (`githubSlotVerdict` below).
  const subject = slot.subject_any || [];
  if (subject.length && !subject.some((w) => facts.text.includes(String(w).toLowerCase()))) {
    return "wrong-subject";
  }
  return null;
}

/**
 * The GitHub package/service gate chain. No task_categories gate (a repo
 * declares no HF task) and no size gate (a repo is not a row-count corpus).
 * Unlike the HF chain, an undeclared subject fails CLOSED: an HF dataset with
 * no subject is offered as an UNVETTED shortlist the page labels as such, but
 * a package/service slot with no subject_any has no shape signal at all to
 * fall back on - `task_categories: image-to-text` at least says "pictures".
 */
function githubSlotVerdict(slot, facts) {
  const allowed = (slot.licence_ok || []).map((l) => String(l).toLowerCase());
  if (!allowed.length) return "slot-declares-no-licences";
  if (!facts.licence) return "licence-unknown";
  if (!allowed.includes(facts.licence)) return "licence-not-allowed";

  if (slot.language && facts.language && String(slot.language).toLowerCase() !== facts.language) {
    return "wrong-language";
  }

  const subject = slot.subject_any || [];
  if (!subject.length) return "slot-declares-no-subject";
  if (!subject.some((w) => facts.text.includes(String(w).toLowerCase()))) return "wrong-subject";
  return null;
}

/**
 * One slot, one verdict: `null` if it can grade this reference, otherwise the
 * name of the gate that refused. Gate 0 is the kind/source check - a slot
 * whose kind cannot ever be filled by this facts' source refuses here,
 * independent of anything else the slot or the reference declare.
 */
function slotVerdict(slot, facts) {
  const normKind = normalizeSlotKind(slot.kind);
  if (!isCompatibleKind(normKind, facts)) return "wrong-source";
  if (normKind === "ground-truth" || normKind === "model") return hfSlotVerdict(slot, facts);
  if (normKind === "package" || normKind === "service") return githubSlotVerdict(slot, facts);
  // skill-eval, or any kind invented after this file was last touched: no
  // feed can ever satisfy it, so it is recorded for the page and matches
  // nothing here.
  return "wrong-source";
}

/**
 * Which of OUR INSTRUMENTS can this reference actually grade? Kind-incompatible
 * slots are skipped before the gate chain even runs - same as the original
 * per-feed pre-filter, kept so a GitHub-only project's slots never appear as
 * "tried and refused" against an HF item and vice versa.
 */
function matchSlots(facts, projects = []) {
  const out = [];
  for (const project of projects) {
    for (const slot of project.slots || []) {
      const normKind = normalizeSlotKind(slot.kind);
      if (!isCompatibleKind(normKind, facts)) continue;
      if (slotVerdict(slot, facts) !== null) continue;
      out.push({
        project: project.id,
        slot: slot.id,
        instrument: slot.instrument || "",
        why: `grades ${project.id}/${slot.id}${slot.language ? ` (${slot.language})` : ""}`,
      });
    }
  }
  return out;
}

/**
 * Why did nothing grade this? The DEEPEST gate any kind-compatible slot
 * reached. `null` when something DID match - there is no miss to explain.
 * `no-slot-of-this-kind` when no slot compatible with this facts' source
 * exists at all, so there was nothing whose depth could even be measured.
 */
function slotMissReason(facts, projects = []) {
  let deepest = -1;
  let seenAnySlot = false;
  for (const project of projects) {
    for (const slot of project.slots || []) {
      const normKind = normalizeSlotKind(slot.kind);
      if (!isCompatibleKind(normKind, facts)) continue;
      seenAnySlot = true;
      const verdict = slotVerdict(slot, facts);
      if (verdict === null) return null;
      const depth = SLOT_MISS_DEPTH.indexOf(verdict);
      if (depth > deepest) deepest = depth;
    }
  }
  if (!seenAnySlot) return "no-slot-of-this-kind";
  return deepest >= 0 ? SLOT_MISS_DEPTH[deepest] : null;
}

/**
 * WHY did the cheap-run gate refuse? `null` when it did not. One gate, one
 * explanation - `isCheapRun` below is defined in terms of this, so the
 * verdict and the reason can never disagree.
 */
function cheapRunRefusal(item) {
  const m = (item && item.metadata) || {};
  if (m.kind !== "dataset") return "not a dataset";
  if (m.gated !== false) return "gated: accept the terms on huggingface.co";
  if (!m.license) return "licence is UNDECLARED";
  if (!PERMISSIVE_LICENSES.has(m.license)) return `licence \`${m.license}\` is not on the permissive list`;
  if (Array.isArray(m.license_declared) && m.license_declared.length > 1) {
    return `declares several licences (${m.license_declared.join(", ")}) - which one governs is your call`;
  }
  if (!CHEAP_RUN_SIZES.has(String(m.size_category || "").toLowerCase())) {
    return m.size_category
      ? `${m.size_category} rows is above the 100K cheap-run cap`
      : "declares no size, so the cap cannot be checked";
  }
  return null;
}

/** May this be downloaded and run WITHOUT asking first? Fails CLOSED on every unknown. */
function isCheapRun(item) {
  return cheapRunRefusal(item) === null;
}

module.exports = {
  SIZE_BUCKET_FLOOR, ROWS_PER_MB, DEFAULT_SLOT_CAP_MB,
  PERMISSIVE_LICENSES, CHEAP_RUN_SIZES, SLOT_MISS_DEPTH,
  normalizeSlotKind, isCompatibleKind,
  slotFactsFromHf, slotFactsFromGithub,
  slotVerdict, matchSlots, slotMissReason,
  cheapRunRefusal, isCheapRun,
};
