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
// The slot gate (H4, 2026-09-03): matchSlots/slotMissReason/isCheapRun/
// cheapRunRefusal moved OUT of this file and INTO slot-gate.js, so
// github-discovery.js can grade a repo against a `package`/`service` slot the
// same way an HF item is graded against a `ground-truth`/`model` one.
const slotGate = require("./slot-gate");

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

// The size table (`SIZE_BUCKET_FLOOR`/`ROWS_PER_MB`/`DEFAULT_SLOT_CAP_MB`) and
// the cheap-run tables (`PERMISSIVE_LICENSES`/`CHEAP_RUN_SIZES`) moved to
// slot-gate.js, with the gate chain and SLOT_MISS_DEPTH ranking (H4 extraction, 2026-09-03).


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

// The permissive-licence set and the cheap-run size allowlist now live in
// slot-gate.js (`PERMISSIVE_LICENSES`, `CHEAP_RUN_SIZES`) - `cheapRunRefusal`/
// `isCheapRun` below delegate there.

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
   * Which of OUR INSTRUMENTS can this reference actually grade - narrower and
   * far fewer rows than `matchProjects`'s topic overlap. Delegates to
   * slot-gate.js; see its docstring for the fail-closed rationale.
   */
  matchSlots(raw, kind = "dataset") {
    return slotGate.matchSlots(slotGate.slotFactsFromHf(raw, kind), this.loadProjects().projects || []);
  }

  /** Why did nothing grade this - the DEEPEST gate reached. `null` when something matched. */
  slotMissReason(raw, kind = "dataset") {
    return slotGate.slotMissReason(slotGate.slotFactsFromHf(raw, kind), this.loadProjects().projects || []);
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
   * WHY did the cheap-run gate refuse? `null` when it did not. Delegates to
   * slot-gate.js - see its docstring for the "one gate, one explanation" note.
   */
  cheapRunRefusal(item) {
    return slotGate.cheapRunRefusal(item);
  }

  isCheapRun(item) {
    return slotGate.isCheapRun(item);
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
