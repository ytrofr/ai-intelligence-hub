/**
 * HuggingFace Module - Fetch trending models and spaces
 *
 * Two things here are deliberate and were previously wrong:
 *  1. `stars` carries LIKES. Downloads live in metadata. A download is not a
 *     star, and the digest's `stars >= 1000` floor is a GitHub-scale filter -
 *     feeding it download counts made every HF model clear it automatically.
 *  2. `score` is on the same scale as a GitHub repo score (tens), not
 *     downloads/100 (hundreds of thousands). Both compete in one ORDER BY.
 */

const fs = require("fs");
const path = require("path");
const BaseModule = require("./base-module");
const { fetchJson } = require("./http");
const { formatMatchReason } = require("./match-reason");

const PROJECTS_TTL_MS = 5 * 60 * 1000;
let _sharedProjects = { at: 0, cfg: null };

/**
 * HF task tags -> the project-topic vocabulary in config/projects.json.
 * Deliberately narrow: an unmapped task matches nothing, so the matcher can
 * say "no". A mapping that covered every task would attribute every model.
 */
const PIPELINE_TOPICS = {
  "sentence-similarity": ["embeddings", "rag"],
  "feature-extraction": ["embeddings", "rag"],
  "text-ranking": ["embeddings", "rag"],
  "question-answering": ["rag"],
  "automatic-speech-recognition": ["voice-assistant"],
  "text-to-speech": ["voice-assistant"],
  "audio-classification": ["voice-assistant"],
  "text-to-image": ["image-generation"],
  "image-to-image": ["image-generation"],
  "image-text-to-text": ["image-generation"],
  "text-to-video": ["video-generation"],
  "image-to-video": ["video-generation"],
  "token-classification": ["hebrew-nlp"],
  "translation": ["hebrew-nlp"],
};

/**
 * HuggingFace publishes a dataset's size as a ROW-COUNT bucket; our slots declare
 * a DISK budget in megabytes. Converting between them is an assumption, so it is
 * written down rather than buried: a row of text/JSONL in these corpora runs on
 * the order of 1 KB, so 1 MB is about 1,000 rows.
 *
 * A slot admits a bucket whose LOWER bound is under its budget. Deliberately the
 * lower bound and not the upper: a refusal costs one row in the near-miss log,
 * while a false accept is how `HuggingFaceFW/fineweb` - ten to a hundred BILLION
 * rows - appeared under the design-fidelity instrument on this page's first live
 * render. An unrecognised or absent bucket is refused, like every other unknown
 * in this file.
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
 * The slot gate chain in DEPTH order - later means the slot got further before
 * refusing. `slotMissReason` reads this back to report the CLOSEST slot's verdict
 * rather than the first one tried. Adding a gate means adding it here too, in the
 * position it occupies in `_slotVerdict`.
 */
const SLOT_MISS_DEPTH = [
  "no-slot-of-this-kind",
  "slot-declares-no-tasks",
  "task-not-graded",
  "wrong-language",
  "slot-declares-no-licences",
  "licence-unknown",
  "licence-not-allowed",
  "too-big-for-this-slot",
  "wrong-subject",
];

/** Quantization/format mirrors - re-uploads of someone else's weights. */
const MIRROR_RE = /-(GGUF|AWQ|GPTQ|MLX|EXL2|INT4|INT8|FP8|BF16|W4A16|onnx)\b/i;

/**
 * Dataset task categories -> the same project-topic vocabulary. Kept separate
 * from PIPELINE_TOPICS because a dataset's task means something different from
 * a model's: a model DOES the task, a dataset is the GROUND TRUTH for it. Same
 * narrowness rule - an unmapped task matches nothing, so the matcher can say no.
 */
const DATASET_TOPICS = {
  "image-to-text": ["design-to-code", "web-gen"],
  "text-to-image": ["image-generation"],
  "automatic-speech-recognition": ["voice-assistant"],
  "text-to-speech": ["voice-assistant"],
  "question-answering": ["rag"],
  "sentence-similarity": ["embeddings", "rag"],
  "text-ranking": ["embeddings", "rag"],
  "text-generation": ["agent-framework"],
  "token-classification": ["hebrew-nlp"],
  translation: ["hebrew-nlp"],
};

/**
 * Licences under which we may actually USE the data commercially. The jina
 * reranker was rejected on cc-by-nc alone and SWE-bench_Verified declares
 * nothing at all despite 327k downloads - so an ABSENT licence must fail
 * closed. Enumerating what is SAFE (rather than what is forbidden) is what
 * makes an unrecognised or missing licence a refusal instead of a pass.
 */
const PERMISSIVE_LICENSES = new Set([
  "apache-2.0", "mit", "bsd", "bsd-3-clause", "bsd-2-clause",
  "cc-by-4.0", "cc-by-3.0", "cc0-1.0", "odc-by", "odbl", "openrail",
]);

/**
 * The row-count buckets a cheap run may have. Past 100K we are looking at
 * TRAINING data, and we do not train.
 *
 * This is an ALLOWLIST on purpose. It used to be a regex naming the buckets to
 * refuse, and a denylist over a vendor's vocabulary fails OPEN on everything it
 * has not heard of - which here meant `n>1T`, the largest bucket HuggingFace
 * has, read as small because the pattern was anchored and that one starts with
 * "n". `100K<n<1M` slipped through the same way: above the cap, never named.
 * Enumerating what is SAFE makes an unseen bucket a refusal by construction.
 */
const CHEAP_RUN_SIZES = new Set(["n<1k", "1k<n<10k", "10k<n<100k"]);

class HuggingFaceModule extends BaseModule {
  buildUrls() {
    const sort = this.config.sort || "trendingScore";
    return [
      `https://huggingface.co/api/models?sort=${sort}&direction=-1&limit=30`,
      `https://huggingface.co/api/spaces?sort=${sort}&direction=-1&limit=20`,
      // Datasets are the half that was missing, and they must be queried PER
      // TASK. A global "top 40 by downloads" returns wikitext, c4, FineFineWeb -
      // famous TRAINING corpora, which we have no use for because we do not
      // train. The sets that are ground truth for our instruments sit far down
      // the global list (Design2Code 1,440 downloads, HaluEval 8,835) and would
      // never surface. Measured live 2026-09-02: the global query matched 7 of
      // 40 to a project and every one of them was a training corpus.
      //
      // Sorted by downloads, not trending: a benchmark earns its value by being
      // measured against for years, so it never trends.
      ...Object.keys(DATASET_TOPICS).map(
        (task) =>
          `https://huggingface.co/api/datasets?filter=task_categories:${task}` +
          `&sort=downloads&direction=-1&limit=12&full=true`
      ),
    ];
  }

  loadProjects() {
    if (_sharedProjects.cfg && Date.now() - _sharedProjects.at < PROJECTS_TTL_MS) return _sharedProjects.cfg;
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "projects.json"), "utf-8"));
    _sharedProjects = { at: Date.now(), cfg };
    return cfg;
  }

  /**
   * Models + spaces. Sort param comes from config (HF rejects the old
   * "trending" value with 400). Both endpoints failing -> throw; one -> warn.
   */
  async fetch() {
    const timeoutMs = this.config.timeout_ms || 20000;
    const urls = this.buildUrls();

    const settled = await Promise.allSettled(urls.map((u) => fetchJson(u, { timeoutMs })));
    const failures = settled.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    // ALL endpoints down is an outage and must throw; a partial is a warning.
    // Returning a short list silently would read downstream as "HF had little
    // this week", which is the shape of an outage that never gets noticed.
    if (failures.length === settled.length) throw new Error(`HuggingFace all endpoints failed - ${failures[0]}`);
    if (failures.length) console.warn(`HuggingFace: ${failures.length}/${urls.length} endpoint(s) failed: ${failures[0]}`);

    const payloads = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
    const out = [];
    const seen = new Set();
    urls.forEach((url, i) => {
      const kind = url.includes("/api/models") ? "model" : url.includes("/api/spaces") ? "space" : "dataset";
      for (const raw of payloads[i] || []) {
        // One dataset can answer several task queries (Design2Code is both
        // image-to-text and text-generation). Dedupe on id, or the digest
        // counts it twice and the "N candidates" figure is inflated.
        const key = `${kind}:${raw.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(
          kind === "model" ? this.modelItem(raw) : kind === "space" ? this.spaceItem(raw) : this.datasetItem(raw)
        );
      }
    });
    return out;
  }

  /** Concepts this model speaks to, drawn from its task, tags and library. */
  modelTopics(model) {
    const tags = (model.tags || []).map((t) => String(t).toLowerCase());
    const topics = new Set(PIPELINE_TOPICS[model.pipeline_tag] || []);
    if (tags.includes("he")) topics.add("hebrew-nlp");
    if (tags.includes("sentence-transformers") || model.library_name === "sentence-transformers") {
      topics.add("embeddings");
      topics.add("rag");
    }
    return [...topics];
  }

  /**
   * Project attribution. Same {id,name,overlap,specificTopics,...} shape the
   * GitHub discovery path emits, so formatMatchReason and the radar render it
   * without a second code path.
   */
  matchProjects(model, kind = "model") {
    const modelTopics = kind === "dataset" ? this.datasetTopics(model) : this.modelTopics(model);
    if (!modelTopics.length) return [];
    const matched = [];
    for (const project of this.loadProjects().projects || []) {
      const shared = modelTopics.filter((t) => (project.topics || []).includes(t));
      if (!shared.length) continue;
      matched.push({
        id: project.id,
        name: project.name,
        overlap: shared.length * 3.0,
        specificDeps: [],
        genericDeps: [],
        specificTopics: shared,
        genericTopics: [],
      });
    }
    return matched.sort((a, b) => b.overlap - a.overlap);
  }

  /**
   * Which of OUR INSTRUMENTS can this reference actually grade?
   *
   * `matchProjects` answers "is this about something the project does" - a topic
   * overlap, which is why the feed can fill with plausible rows that grade nothing.
   * A SLOT is one instrument plus the shape of data that can grade it, so this
   * answers a much narrower question and returns far fewer rows on purpose.
   *
   * FAILS CLOSED on every unknown. An absent licence tag, a missing language, or a
   * slot declaring no task categories all match NOTHING - because the cost of a
   * false match is the operator downloading something that cannot grade anything,
   * while the cost of a false miss is one row in the near-miss log, which is
   * exactly the corpus for the next slot.
   */
  /**
   * The raw facts a slot gate reads, lifted once per item. Kept separate from the
   * gates themselves so `matchSlots` and `slotMissReason` cannot drift apart -
   * two implementations of one gate is how a matcher and its explanation start
   * disagreeing, and the explanation is the half nobody re-tests.
   */
  _slotFacts(raw, kind) {
    const tags = (raw.tags || []).map(String);
    const valuesOf = (prefix) =>
      tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length).toLowerCase());

    const tasks = kind === "dataset"
      ? valuesOf("task_categories:")
      : [raw.pipeline_tag].filter(Boolean).map((t) => String(t).toLowerCase());
    // HF writes a language either as `language:he` or as a bare `he` tag, and both
    // appear in the wild on the same day. Read both rather than pick one and be
    // silently wrong for half the corpus.
    const langs = [...valuesOf("language:"), ...tags.filter((t) => /^[a-z]{2,3}$/.test(t))];
    const licenceTag = tags.find((t) => t.toLowerCase().startsWith("license:"));
    const licence = licenceTag ? licenceTag.slice("license:".length).toLowerCase() : null;
    const bucket = valuesOf("size_categories:")[0] || null;
    // What the subject gate is allowed to read: fields the PUBLISHER DECLARED -
    // the id, the pretty name, the tags. Deliberately NOT the card body.
    //
    // The first version included `description`, which on a full payload is the
    // whole README, and `nyu-visionx/VSI-590K` - a spatial-reasoning VQA set -
    // was admitted to the screenshot-grading slot because its card carries the
    // link bar "website | paper | github | models". A subject claim resting on a
    // word that appears in passing is not a subject claim; free-form prose will
    // eventually contain every term any slot declares.
    const text = [raw.id, raw.title, (raw.cardData || {}).pretty_name, ...tags]
      .filter(Boolean).join(" ").toLowerCase();
    return { tasks, langs, licence, bucket, text };
  }

  /**
   * One slot, one verdict: `null` if it can grade this reference, otherwise the
   * name of the gate that refused. The ORDER of the gates is also their depth -
   * a slot that fails a later gate got further - and `SLOT_MISS_DEPTH` reads that
   * order back when several slots refuse for different reasons.
   */
  _slotVerdict(slot, facts) {
    const wantTasks = slot.task_categories || [];
    // A slot with no declared task categories is a recorded ABSENCE (we keep it so
    // the gap stays visible). An empty declaration must read as "matches nothing" -
    // reading it as "matches everything" is the classic fail-open.
    if (!wantTasks.length) return "slot-declares-no-tasks";
    const want = wantTasks.map((w) => String(w).toLowerCase());
    if (!facts.tasks.some((t) => want.includes(t))) return "task-not-graded";

    if (slot.language && !facts.langs.includes(String(slot.language).toLowerCase())) {
      return "wrong-language";
    }

    const allowed = (slot.licence_ok || []).map((l) => String(l).toLowerCase());
    if (!allowed.length) return "slot-declares-no-licences";
    if (!facts.licence) return "licence-unknown";      // silence is not permission
    if (!allowed.includes(facts.licence)) return "licence-not-allowed";

    // The size budget. Every slot declared one from the start and NOTHING read
    // it - a lever armed in config with no call site reads as a guarantee and
    // enforces nothing. This is that call site.
    const capMb = slot.size_cap_mb === undefined ? DEFAULT_SLOT_CAP_MB : Number(slot.size_cap_mb);
    if (Number.isFinite(capMb) && capMb > 0) {
      const floor = SIZE_BUCKET_FLOOR[String(facts.bucket || "").toLowerCase()];
      if (floor === undefined) return "too-big-for-this-slot";   // unknown or absent: fail closed
      if (floor >= capMb * ROWS_PER_MB) return "too-big-for-this-slot";
    }

    // SUBJECT. Everything above proves a reference has the right SHAPE; none of
    // it proves it is ABOUT the thing this instrument does. HuggingFace's
    // `task_categories` is a shape signal only - `image-to-text` covers OCR,
    // captioning and VQA as well as screenshot->code, and `text-generation`
    // covers almost everything - so a slot that stops here offers the operator
    // Arabic book scans as an answer key for a screenshot grader and calls it
    // "grades apollo/design-fidelity". Measured 2026-09-03: 22 of 23 candidates.
    //
    // A slot with no declared subject is NOT narrowed here - that would empty
    // the page on the slots I could not describe. It is marked UNVETTED instead,
    // and the page says so rather than presenting a shortlist as an answer.
    const subject = slot.subject_any || [];
    if (subject.length && !subject.some((w) => facts.text.includes(String(w).toLowerCase()))) {
      return "wrong-subject";
    }
    return null;
  }

  /**
   * Which of OUR INSTRUMENTS can this reference actually grade?
   *
   * `matchProjects` answers "is this about something the project does" - a topic
   * overlap, which is why the feed can fill with plausible rows that grade nothing.
   * A SLOT is one instrument plus the shape of data that can grade it, so this
   * answers a much narrower question and returns far fewer rows on purpose.
   *
   * FAILS CLOSED on every unknown. An absent licence tag, a missing language, or a
   * slot declaring no task categories all match NOTHING - because the cost of a
   * false match is the operator downloading something that cannot grade anything,
   * while the cost of a false miss is one row in the near-miss log, which is
   * exactly the corpus for the next slot.
   */
  matchSlots(raw, kind = "dataset") {
    const facts = this._slotFacts(raw, kind);
    const out = [];
    for (const project of this.loadProjects().projects || []) {
      for (const slot of project.slots || []) {
        if ((slot.kind || "dataset") !== kind) continue;
        if (this._slotVerdict(slot, facts) !== null) continue;
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
   * Why did nothing grade this? The DEEPEST gate any slot of this kind reached.
   *
   * Reporting the first slot's verdict would be true and useless: "task-not-graded"
   * is what every unrelated slot says. The actionable fact is how far the closest
   * slot got - a reference that cleared task and language and died on the licence
   * is one licence away from being usable, and that is a different finding from
   * one nothing could ever grade.
   *
   * Returns `null` when something DID match (there is no miss to explain).
   */
  slotMissReason(raw, kind = "dataset") {
    const facts = this._slotFacts(raw, kind);
    let deepest = -1;
    let seenAnySlot = false;
    for (const project of this.loadProjects().projects || []) {
      for (const slot of project.slots || []) {
        if ((slot.kind || "dataset") !== kind) continue;
        seenAnySlot = true;
        const verdict = this._slotVerdict(slot, facts);
        if (verdict === null) return null;
        const depth = SLOT_MISS_DEPTH.indexOf(verdict);
        if (depth > deepest) deepest = depth;
      }
    }
    // No slot of this kind exists at all. M7: the log's first population is 15
    // MODEL rows, and at that moment one model slot was declared - so this branch
    // is real, and a vocabulary without it would have to invent a gate reason.
    if (!seenAnySlot) return "no-slot-of-this-kind";
    return deepest >= 0 ? SLOT_MISS_DEPTH[deepest] : null;
  }

  /**
   * Record a reference that matched a PROJECT and no INSTRUMENT.
   *
   * Best-effort by construction: the store is injected and may be absent (the
   * offline tests run with none), and a write that throws must never cost the
   * fetch its item. A near-miss log that can break a fetch would be turned off.
   */
  _recordNearMiss({ itemId, raw, kind, matched, slots, title, url }) {
    if (!this.nearMissStore || slots.length || !matched.length) return;
    const reason = this.slotMissReason(raw, kind);
    if (!reason) return;
    const seen_at = new Date().toISOString();
    for (const project of matched) {
      try {
        this.nearMissStore.record({ item_id: itemId, project: project.id, kind, reason, title, url, seen_at });
      } catch (_) {
        // never load-bearing
      }
    }
  }

  modelItem(model) {
    const matched = this.matchProjects(model);
    const slots = this.matchSlots(model, "model");
    const best = matched[0] || null;
    this._recordNearMiss({
      itemId: `model-${model.id}`, raw: model, kind: "model", matched, slots,
      title: model.id, url: `https://huggingface.co/${model.id}`,
    });
    return this.normalize({
      id: `model-${model.id}`,
      title: model.id,
      url: `https://huggingface.co/${model.id}`,
      description: model.pipeline_tag ? `${model.pipeline_tag} model` : "ML Model",
      author: model.author,
      stars: model.likes || 0,
      score: this.calculateScore(model, matched),
      published_at: model.lastModified,
      metadata: {
        type: "model",
        pipeline: model.pipeline_tag,
        library: model.library_name,
        likes: model.likes,
        downloads: model.downloads || 0,
        mirror: MIRROR_RE.test(model.id),
        matched_projects: matched,
        // Same as the dataset path: which INSTRUMENT this can grade.
        matched_slots: slots,
        match_reason: best ? formatMatchReason(best, { projectName: best.name }) : "",
      },
    });
  }

  /** Task categories a dataset declares, from `task_categories:<x>` tags. */
  datasetTopics(ds) {
    const tags = (ds.tags || []).map((t) => String(t).toLowerCase());
    const topics = new Set();
    for (const t of tags) {
      if (t.startsWith("task_categories:")) {
        for (const topic of DATASET_TOPICS[t.slice("task_categories:".length)] || []) topics.add(topic);
      }
      if (t === "language:he") topics.add("hebrew-nlp");
    }
    return [...topics];
  }

  /** Declared licence, or null. `cardData.license` may be a string or a list. */
  datasetLicense(ds) {
    const raw = (ds.cardData || {}).license;
    const one = Array.isArray(raw) ? raw[0] : raw;
    if (one) return String(one).toLowerCase();
    const tag = (ds.tags || []).find((t) => String(t).toLowerCase().startsWith("license:"));
    return tag ? String(tag).slice("license:".length).toLowerCase() : null;
  }

  datasetItem(ds) {
    const matched = this.matchProjects(ds, "dataset");
    const slots = this.matchSlots(ds, "dataset");
    const best = matched[0] || null;
    this._recordNearMiss({
      itemId: `dataset-${ds.id}`, raw: ds, kind: "dataset", matched, slots,
      title: ds.id, url: `https://huggingface.co/datasets/${ds.id}`,
    });
    const tasks = (ds.tags || [])
      .filter((t) => String(t).startsWith("task_categories:"))
      .map((t) => String(t).slice("task_categories:".length));
    return this.normalize({
      id: `dataset-${ds.id}`,
      title: ds.id,
      url: `https://huggingface.co/datasets/${ds.id}`,
      description: tasks.length ? `${tasks[0]} dataset` : "Dataset",
      author: ds.author,
      stars: ds.likes || 0,
      score: this.calculateScore(ds, matched),
      published_at: ds.lastModified,
      metadata: {
        type: "dataset",
        kind: "dataset",
        tasks,
        likes: ds.likes,
        downloads: ds.downloads || 0,
        // `gated` is HF's own field: false, "auto", or "manual". Carried
        // VERBATIM rather than coerced to a boolean - "auto" and "manual" are
        // different asks of the operator, and a boolean would erase that.
        gated: ds.gated === undefined ? false : ds.gated,
        license: this.datasetLicense(ds),
        // What the dataset ACTUALLY declared, before we picked one. A list stays
        // a list here so the cheap-run gate can refuse the ambiguity instead of
        // silently resolving it, and so a card can show the operator all of them.
        license_declared: (ds.cardData || {}).license === undefined
          ? this.datasetLicense(ds)
          : (ds.cardData || {}).license,
        size_category: (ds.tags || [])
          .filter((t) => String(t).startsWith("size_categories:"))
          .map((t) => String(t).slice("size_categories:".length))[0] || null,
        matched_projects: matched,
        // Which INSTRUMENT this can grade, not merely which project it is about.
        // Empty is the common and correct case; a row that matches a project but no
        // slot is a NEAR MISS, and that is the corpus for the next slot rather than
        // a defect (see slot-near-miss-store).
        matched_slots: slots,
        match_reason: best ? formatMatchReason(best, { projectName: best.name }) : "",
      },
    });
  }

  /**
   * May this be downloaded and run WITHOUT asking first? The operator's ruling
   * 2026-09-02: small + permissive + read-only just runs; anything else waits
   * for a board card. Fails CLOSED on every unknown - an unrecognised licence,
   * an absent one, or an unfamiliar gated value is a refusal, not a pass.
   */
  /**
   * WHY did the cheap-run gate refuse? `null` when it did not.
   *
   * Callers used to re-derive this from two of the gate's clauses and guess the
   * rest, which printed "licence is not on the permissive list" next to an
   * apache-2.0 dataset that was actually refused for its size. One gate, one
   * explanation - the same rule `_slotVerdict` follows one layer down.
   */
  cheapRunRefusal(item) {
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

  isCheapRun(item) {
    // Defined as "the gate found nothing to refuse", so the verdict and the
    // reason can never disagree - two implementations of one gate is how a
    // matcher and its explanation drift apart.
    return this.cheapRunRefusal(item) === null;
  }

  spaceItem(space) {
    return this.normalize({
      id: `space-${space.id}`,
      title: `🚀 ${space.id}`,
      url: `https://huggingface.co/spaces/${space.id}`,
      description: space.sdk ? `${space.sdk} Space` : "HuggingFace Space",
      author: space.author,
      stars: space.likes || 0,
      score: (space.likes || 0) * 10,
      published_at: space.lastModified,
      metadata: { type: "space", sdk: space.sdk, likes: space.likes },
    });
  }

  /**
   * GitHub-comparable scale (tens), since both sources share one ORDER BY.
   * Downloads enter logarithmically: 45M downloads is more than 4.5M, but not
   * ten times more interesting.
   */
  calculateScore(model, matched = []) {
    const downloads = model.downloads || 0;
    const likes = Math.min(model.likes || 0, 2000);
    const topicBoost = matched.reduce((n, p) => n + p.specificTopics.length, 0) * 3;
    const raw = Math.log10(downloads + 1) * 4 + likes * 0.05 + topicBoost;
    return Math.round(MIRROR_RE.test(model.id) ? raw * 0.25 : raw);
  }
}

module.exports = HuggingFaceModule;
