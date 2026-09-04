const test = require("node:test");
const assert = require("node:assert/strict");
const HuggingFaceModule = require("../modules/huggingface");

const cfg = { id: "huggingface", name: "HuggingFace", type: "huggingface", url: "https://huggingface.co/api/models", config: {} };

// Injected project set - offline, and small enough that a match is checkable by hand.
const PROJECTS = {
  projects: [
    { id: "atlas", name: "Atlas", topics: ["rag", "embeddings", "hebrew-nlp", "gemini"] },
    { id: "orion", name: "Orion", topics: ["voice-assistant", "whatsapp", "llm-agent"] },
    { id: "apollo", name: "Apollo", topics: ["image-generation", "web-scraping", "design-to-code"] },
    { id: "guide", name: "Guide", topics: ["documentation", "claude-code"] },
  ],
};

const mod = () => {
  const m = new HuggingFaceModule(cfg);
  m.loadProjects = () => PROJECTS; // offline injection
  return m;
};

const model = (over = {}) => ({
  id: "dicta-il/neodictabert-bilingual-embed",
  author: "dicta-il",
  downloads: 2856,
  likes: 2,
  pipeline_tag: "sentence-similarity",
  library_name: "sentence-transformers",
  tags: ["sentence-transformers", "sentence-similarity", "he", "en"],
  lastModified: "2026-02-02T23:27:32.000Z",
  ...over,
});

// --- Defect 1: downloads were being written into the `stars` column ---------
test("stars carries LIKES, never downloads", () => {
  const item = mod().modelItem(model({ downloads: 45878934, likes: 7 }));
  assert.equal(item.stars, 7, "stars must be the like count");
  assert.notEqual(item.stars, 45878934, "downloads must not masquerade as stars");
});

test("downloads survive, in metadata where they belong", () => {
  const item = mod().modelItem(model({ downloads: 45878934 }));
  assert.equal(item.metadata.downloads, 45878934);
});

// --- Defect 2: score scale was ~4 orders of magnitude above GitHub ----------
test("score is on the same scale as a GitHub repo, not downloads/100", () => {
  const huge = mod().modelItem(model({ downloads: 45878934, likes: 1360 }));
  assert.ok(huge.score < 1000, `score ${huge.score} must not dwarf GitHub scores (was 458,796)`);
});

test("score still ORDERS models sensibly (a popular model outranks an ignored one)", () => {
  const m = mod();
  const popular = m.modelItem(model({ downloads: 45878934, likes: 1360 }));
  const ignored = m.modelItem(model({ id: "someone/nothing", downloads: 3, likes: 0 }));
  assert.ok(popular.score > ignored.score, "ranking within HF must survive the rescale");
});

// --- Defect 3: HF items carried no project attribution ----------------------
test("a Hebrew retrieval model is attributed to Atlas", () => {
  const item = mod().modelItem(model());
  const ids = (item.metadata.matched_projects || []).map((p) => p.id);
  assert.ok(ids.includes("atlas"), `expected atlas in ${JSON.stringify(ids)}`);
});

test("a Hebrew speech model is attributed to Orion, not Atlas", () => {
  const item = mod().modelItem(
    model({ id: "ivrit-ai/whisper-large-v3-turbo-ct2", pipeline_tag: "automatic-speech-recognition", tags: ["he"], library_name: "ctranslate2" })
  );
  const ids = (item.metadata.matched_projects || []).map((p) => p.id);
  assert.ok(ids.includes("orion"), `expected orion in ${JSON.stringify(ids)}`);
});

// --- The control: a matcher that matches everything is broken ---------------
test("CONTROL: an unrelated model matches NO project", () => {
  const item = mod().modelItem(
    model({ id: "some/protein-folder", pipeline_tag: "tabular-regression", tags: ["biology", "protein"], library_name: "sklearn" })
  );
  assert.deepEqual(item.metadata.matched_projects, [], "the matcher must be able to say no");
});

test("CONTROL: no model is attributed to every project at once", () => {
  const item = mod().modelItem(model());
  assert.ok(item.metadata.matched_projects.length < PROJECTS.projects.length, "matching all projects means the matcher does not discriminate");
});

// --- Regression guard: spaceItem was already correct, leave it alone --------
test("spaceItem keeps likes in stars (it was never the defect)", () => {
  const item = mod().spaceItem({ id: "acme/demo", author: "acme", likes: 42, sdk: "gradio", lastModified: "2026-08-01T00:00:00Z" });
  assert.equal(item.stars, 42);
  assert.equal(item.metadata.type, "space");
});

// --- No fabricated data on failure -----------------------------------------
test("no fallback data: an unreachable API throws, never returns fake models", async () => {
  const m = new HuggingFaceModule({ ...cfg, config: { timeout_ms: 500 } });
  m.buildUrls = () => ["http://127.0.0.1:9/api/models", "http://127.0.0.1:9/api/spaces"];
  await assert.rejects(m.fetch());
  assert.equal(typeof m.fetchFallback, "undefined");
});

// --- Quantization mirrors: re-uploads of someone else's weights ------------
// NOTE: the plan proposed a `keyword_gate` in config/sources.json. Implemented
// in-module instead: HF descriptions are two words ("sentence-similarity
// model"), so a keyword gate would have scored the whole source to zero.
test("a GGUF re-upload is demoted below the model it mirrors", () => {
  const m = mod();
  const original = m.modelItem(model({ id: "yam-peleg/Hebrew-Mistral-7B", downloads: 288, likes: 73 }));
  const mirror = m.modelItem(model({ id: "mradermacher/Hebrew-Mistral-7B-GGUF", downloads: 656, likes: 0 }));
  assert.ok(mirror.score < original.score, "a mirror with MORE downloads must still rank below the original");
  assert.equal(mirror.metadata.mirror, true);
  assert.equal(original.metadata.mirror, false);
});

// === Datasets: HF's ground-truth half ======================================
// Every scoring instrument across the four repos was found (2026-09-02) to have
// zero external ground truth. Datasets are what close that, and the hub fetched
// models+spaces only - so a dataset could never reach a project's radar.

const dataset = (over = {}) => ({
  id: "SALT-NLP/Design2Code",
  author: "SALT-NLP",
  downloads: 1440,
  likes: 30,
  lastModified: "2026-08-01T00:00:00Z",
  tags: ["task_categories:image-to-text", "license:odc-by", "size_categories:n<1K"],
  cardData: { license: "odc-by" },
  gated: false,
  ...over,
});

test("a dataset item is typed as a dataset and keeps downloads out of stars", () => {
  const item = mod().datasetItem(dataset());
  assert.equal(item.metadata.type, "dataset");
  assert.equal(item.metadata.kind, "dataset");
  assert.equal(item.stars, 30, "stars carries LIKES; a download is not a star");
  assert.equal(item.metadata.downloads, 1440);
  assert.equal(item.metadata.license, "odc-by");
  assert.equal(item.metadata.gated, false);
});

test("buildUrls fetches datasets, not only models and spaces", () => {
  const urls = mod().buildUrls();
  assert.ok(urls.some((u) => u.includes("/api/datasets")), `no datasets endpoint in ${urls}`);
});

// --- The cheap-run gate ----------------------------------------------------
// The operator's ruling: small + permissive + read-only runs without asking;
// anything else waits for a board card. That threshold is CODE, not a habit.
test("cheap-run gate: a small permissive ungated dataset passes", () => {
  assert.equal(mod().isCheapRun(mod().datasetItem(dataset())), true);
});

test("cheap-run gate: a GATED dataset never passes - terms are the operator's to accept", () => {
  const item = mod().datasetItem(dataset({ id: "ivrit-ai/crowd-transcribe-v5", gated: "auto" }));
  assert.equal(item.metadata.gated, "auto");
  assert.equal(mod().isCheapRun(item), false);
});

test("cheap-run gate: an UNDECLARED licence never passes - downloads are not a licence", () => {
  // A genuinely undeclared licence: nothing in cardData AND no `license:` tag,
  // which is exactly how SWE-bench_Verified ships at 327k downloads.
  const item = mod().datasetItem(dataset({
    id: "princeton-nlp/SWE-bench_Verified",
    downloads: 327492,
    cardData: {},
    tags: ["task_categories:text-generation", "size_categories:n<1K"],
  }));
  assert.equal(item.metadata.license, null);
  assert.equal(mod().isCheapRun(item), false);
});

test("cheap-run gate: a NON-COMMERCIAL licence never passes", () => {
  const item = mod().datasetItem(dataset({ cardData: { license: "cc-by-nc-4.0" } }));
  assert.equal(mod().isCheapRun(item), false);
});

test("cheap-run gate: a training-scale dataset never passes - we do not train", () => {
  const item = mod().datasetItem(dataset({ id: "HuggingFaceM4/WebSight", tags: ["size_categories:1M<n<10M", "license:cc-by-4.0"], cardData: { license: "cc-by-4.0" } }));
  assert.equal(mod().isCheapRun(item), false);
});

// --- CONTROLS: a matcher that cannot say "no" is not a matcher -------------
test("CONTROL: a dataset with no declared task matches no project topic", () => {
  const item = mod().datasetItem(dataset({ tags: ["license:mit"], cardData: { license: "mit" } }));
  assert.deepEqual(item.metadata.matched_projects, []);
});

test("CONTROL: no dataset is attributed to every project at once", () => {
  const projects = (mod().loadProjects().projects || []).length;
  const item = mod().datasetItem(dataset());
  assert.ok(
    item.metadata.matched_projects.length < projects,
    `matched all ${projects} projects - the matcher is not discriminating`
  );
});

// === The weekly ground-truth section =======================================
// Three instruments were measured against external data by hand on 2026-09-02.
// This is what makes the fourth one happen without a person remembering to look.
const { formatGroundTruthSection } = require("../modules/weekly-digest");

// C7 rewrote this section to be per INSTRUMENT rather than per project, and to
// read from the same builder the page reads (modules/ground-truth.js) so the two
// surfaces cannot drift into disagreeing about the same week.

test("digest: a cheap-runnable dataset is listed under the INSTRUMENT it can grade", () => {
  const m = slotMod();
  const out = formatGroundTruthSection([m.datasetItem(dset())], SLOT_PROJECTS.projects);
  assert.match(out, /voice-wer/, "the row is the instrument, not the project");
  assert.match(out, /common_voice_22_0/);
  assert.match(out, /RUNNABLE/);
});

test("digest: a GATED dataset is listed as needing the operator, never as runnable", () => {
  const m = slotMod();
  const out = formatGroundTruthSection(
    [m.datasetItem(dset({ gated: "auto" }))], SLOT_PROJECTS.projects);
  assert.match(out, /NEEDS YOU/);
  assert.doesNotMatch(out, /RUNNABLE/);
});

test("CONTROL: a section built from zero datasets still lists every instrument", () => {
  // The old section vanished when nothing matched. That is the failure this page
  // and this section exist to prevent: an instrument nothing checks must be the
  // loudest row in the digest, not an absent one.
  const out = formatGroundTruthSection([], SLOT_PROJECTS.projects);
  assert.match(out, /voice-wer/);
  assert.match(out, /never checked/i);
  assert.doesNotMatch(out, /RUNNABLE/);
});

test("digest: a slot that HAS run reports its number AND the caveat that bounds it", () => {
  const withRun = { projects: [{ ...SLOT_PROJECTS.projects[0],
    slots: [{ ...SLOT_PROJECTS.projects[0].slots[0],
      ran: [{ reference: "fsicoli/common_voice_22_0", n: 40, number: "WER 0.170",
              caveat: "point estimate; variance unmeasured", at: "2026-09-03" }] },
      SLOT_PROJECTS.projects[0].slots[1]] }] };
  const out = formatGroundTruthSection([], withRun.projects);
  assert.match(out, /WER 0\.170/);
  assert.match(out, /variance unmeasured/, "a number without its caveat is what gets quoted wrong");
});

test("digest: a declared GAP reads as a finding, not as an instrument nobody got to", () => {
  const out = formatGroundTruthSection([], SLOT_PROJECTS.projects);
  assert.match(out, /skill-evals/);
  assert.doesNotMatch(out, /skill-evals.*never checked/i);
});

test("digest: near misses are reported with the gate that refused them", () => {
  const out = formatGroundTruthSection([], SLOT_PROJECTS.projects, [
    { item_id: "dataset-a/b", project: "orion", kind: "dataset",
      reason: "licence-not-allowed", title: "a/b", url: "u", seen_at: "2026-09-03T00:00:00Z" },
  ]);
  assert.match(out, /near miss/i);
  assert.match(out, /licence-not-allowed/);
});

test("CONTROL: the digest's headline counts come from the SAME builder as the page", () => {
  // Two renderers, one builder. If the section grew its own tally, the page and
  // the Monday email could report different weeks and both look right.
  const { buildGroundTruth } = require("../modules/ground-truth");
  const m = slotMod();
  const items = [m.datasetItem(dset())];
  const { counts } = buildGroundTruth({
    projects: SLOT_PROJECTS.projects, items,
    classify: (i) => (m.isCheapRun(i) ? "runnable" : "needs-you"),
  });
  const out = formatGroundTruthSection(items, SLOT_PROJECTS.projects);
  assert.match(out, new RegExp(`${counts.slots} instruments`));
  assert.match(out, new RegExp(`${counts.slots_never_run} never checked`));
});

// --- Slot-driven dataset search --------------------------------------------
// A global "top 40 datasets by downloads" surfaces wikitext, c4, FineFineWeb -
// famous TRAINING corpora. The sets that are actually ground truth for our
// instruments (Design2Code 1,440 downloads, HaluEval 8,835) are nowhere near
// the global top and never will be. Query per TASK, or the section is decorative.
test("buildUrls asks per task category, not one global top-N", () => {
  const urls = mod().buildUrls().filter((u) => u.includes("/api/datasets"));
  assert.ok(urls.length > 1, `expected several per-task dataset queries, got ${urls.length}`);
  assert.ok(
    urls.some((u) => u.includes("task_categories")),
    "no task_categories filter - this is still a global popularity query"
  );
});

test("CONTROL: every dataset query is scoped - none is an unfiltered top-N", () => {
  const urls = mod().buildUrls().filter((u) => u.includes("/api/datasets"));
  const unscoped = urls.filter((u) => !u.includes("filter="));
  assert.equal(unscoped.length, 0, `unscoped dataset queries: ${unscoped}`);
});

// ---------------------------------------------------------------------------
// C2 - matchSlots: which of OUR INSTRUMENTS can this reference actually grade?
//
// `matched_projects` answers "is this about something the project does". That is
// a topic overlap, and it is why the feed could be full of plausible rows that
// grade nothing. A SLOT is one instrument of ours plus the shape of data that can
// grade it, so `matched_slots` answers a different and much narrower question.
// Fail CLOSED everywhere: an unknown licence, an absent language, or a slot that
// declares no task categories matches NOTHING, because a false match here sends
// the operator to download something that cannot grade anything.
// ---------------------------------------------------------------------------

const SLOT_PROJECTS = {
  projects: [
    {
      id: "orion", name: "Orion", topics: ["voice-assistant", "whatsapp"],
      slots: [
        { id: "voice-wer", kind: "dataset", task_categories: ["automatic-speech-recognition"],
          language: "he", licence_ok: ["cc0-1.0", "cc-by-4.0"], size_cap_mb: 500 },
        { id: "tool-calling", kind: "dataset", task_categories: ["text-generation"],
          licence_ok: ["apache-2.0"], size_cap_mb: 500 },
      ],
    },
    {
      id: "lyra", name: "CC Stack", topics: ["claude-code"],
      // A slot that records an ABSENCE: HF cannot supply this. It declares no task
      // categories on purpose, and must therefore match nothing.
      // `gap` is the authored reason the absence is permanent, and it is what
      // makes this row a FINDING rather than an instrument nobody got to yet.
      slots: [{ id: "skill-evals", kind: "dataset", task_categories: [], licence_ok: [], size_cap_mb: 0,
                gap: "HuggingFace cannot supply this" }],
    },
  ],
};

const slotMod = () => {
  const m = new HuggingFaceModule(cfg);
  m.loadProjects = () => SLOT_PROJECTS;
  return m;
};

const dset = (over = {}) => ({
  id: "fsicoli/common_voice_22_0",
  author: "fsicoli",
  likes: 12,
  tags: ["task_categories:automatic-speech-recognition", "language:he", "license:cc0-1.0",
         "size_categories:10K<n<100K"],
  ...over,
});

test("matchSlots names the instrument a reference can grade (POSITIVE CONTROL)", () => {
  const hit = slotMod().matchSlots(dset(), "dataset");
  assert.deepEqual(hit.map((s) => `${s.project}/${s.slot}`), ["orion/voice-wer"]);
});

test("matchSlots refuses a reference in the wrong language (NEGATIVE CONTROL)", () => {
  // Same task, same licence, same size - only the language differs. A matcher that
  // ignored `language` would pass this and send the operator a Portuguese corpus
  // to grade a Hebrew transcriber.
  const hit = slotMod().matchSlots(
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:pt",
                  "license:cc0-1.0", "size_categories:10K<n<100K"] }), "dataset");
  assert.deepEqual(hit, []);
});

test("matchSlots refuses a licence the slot does not allow", () => {
  const hit = slotMod().matchSlots(
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he",
                  "license:cc-by-nc-4.0", "size_categories:10K<n<100K"] }), "dataset");
  assert.deepEqual(hit, []);
});

test("matchSlots fails CLOSED on an unknown licence", () => {
  // No `license:` tag at all. Silence is not permission.
  const hit = slotMod().matchSlots(
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he"] }), "dataset");
  assert.deepEqual(hit, []);
});

test("a slot that records a GAP matches nothing, however plausible the reference", () => {
  // lyra/skill-evals declares no task categories because HF cannot supply it.
  // An empty declaration must read as "matches nothing", never as "matches all".
  const hit = slotMod().matchSlots(
    dset({ tags: ["task_categories:text-classification", "license:mit"] }), "dataset");
  assert.deepEqual(hit.filter((s) => s.slot === "skill-evals"), []);
});

test("matchSlots does not hand a dataset to a model slot", () => {
  const m = slotMod();
  const hit = m.matchSlots(dset(), "model");
  assert.deepEqual(hit, [], "kind must gate the match, or every slot grades everything");
});

// ---------------------------------------------------------------------------
// C3 - the near-miss write. A row that matched a PROJECT but no INSTRUMENT is
// the corpus for the next slot, and this is the only moment it exists.
//
// The store is INJECTED, so these run with no database at all. A near-miss path
// that could only be exercised against data/hub.db would be untested in practice.
// ---------------------------------------------------------------------------

const recorder = () => {
  const rows = [];
  return { rows, record: (r) => rows.push(r) };
};

const slotModWith = (store) => {
  const m = new HuggingFaceModule(cfg);
  m.loadProjects = () => SLOT_PROJECTS;
  m.nearMissStore = store;
  return m;
};

test("POSITIVE CONTROL: a reference that DOES grade an instrument records no near miss", () => {
  const store = recorder();
  slotModWith(store).datasetItem(dset());
  assert.deepEqual(store.rows, [], "a hit is not a gap");
});

test("a dataset that matches a project but no instrument is recorded, with the gate that refused it", () => {
  // Same ASR corpus, wrong licence. It still matches Orion on topic, so it
  // reaches the operator's feed - and grades nothing. That is exactly the row
  // the log exists to hold.
  const store = recorder();
  slotModWith(store).datasetItem(dset({
    tags: ["task_categories:automatic-speech-recognition", "language:he",
           "license:cc-by-nc-4.0", "size_categories:10K<n<100K"],
  }));
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].project, "orion");
  assert.equal(store.rows[0].kind, "dataset");
  assert.equal(store.rows[0].reason, "licence-not-allowed");
});

test("the reason names the DEEPEST gate reached, not the first slot tried", () => {
  // The slot that refuses FIRST is not the informative one. Here `voice-wer` is
  // tried first and dies on task; `tool-calling` is tried second, clears task,
  // and dies on the licence - one licence away from usable, which is a different
  // finding and the only actionable one.
  //
  // The item order matters and is the point: an earlier fixture had the deepest
  // slot listed first, so reporting the first verdict and reporting the deepest
  // gave the same answer and this assertion could not fail. Mutation-checked.
  const reason = slotMod().slotMissReason({
    id: "someone/instructions",
    tags: ["task_categories:text-generation", "language:he", "license:cc-by-nc-4.0"],
  }, "dataset");
  assert.equal(reason, "licence-not-allowed");
});

test("CONTROL: the ladder still reports a shallow gate when that IS the deepest", () => {
  // The mirror of the test above - if "deepest" silently became "last tried",
  // this one would report `slot-declares-no-tasks` from the lyra gap slot.
  const reason = slotMod().slotMissReason({
    id: "someone/tabular",
    tags: ["task_categories:tabular-regression", "license:mit"],
  }, "dataset");
  assert.equal(reason, "task-not-graded");
});

test("slotMissReason returns null when something DID grade it - there is no miss", () => {
  assert.equal(slotMod().slotMissReason(dset(), "dataset"), null);
});

test("a MODEL near miss is recorded as kind=model with a real reason", () => {
  // M7: this log's FIRST population is 15 model rows and zero dataset rows. A
  // reason vocabulary that only spoke dataset would render two months of real
  // gaps as "no near misses".
  const store = recorder();
  const m = slotModWith(store);
  m.modelItem({ id: "openai/whisper-large-v3", author: "openai", likes: 9,
                pipeline_tag: "automatic-speech-recognition",
                tags: ["automatic-speech-recognition", "license:apache-2.0"] });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].kind, "model");
  assert.ok(store.rows[0].reason, "a recorded gap with no reason is not a corpus");
  assert.notEqual(store.rows[0].reason, "", "empty reason");
});

test("a reference matching NO project records nothing - the log is about instruments, not everything", () => {
  const store = recorder();
  slotModWith(store).datasetItem(dset({
    tags: ["task_categories:tabular-regression", "license:mit"],
  }));
  assert.deepEqual(store.rows, []);
});

test("with no store injected the item still builds - the log is never load-bearing", () => {
  const m = new HuggingFaceModule(cfg);
  m.loadProjects = () => SLOT_PROJECTS;
  const item = m.datasetItem(dset({
    tags: ["task_categories:automatic-speech-recognition", "language:he",
           "license:cc-by-nc-4.0"],
  }));
  assert.ok(item.id, "a fetch must not fail because the near-miss log is absent");
});

// ---------------------------------------------------------------------------
// C4 - the cheap-run size guard, proved against its NEGATIVE SPACE.
//
// The guard was written as a denylist: a regex naming the buckets to REFUSE.
// An unrecognised bucket therefore failed OPEN, which is the one direction this
// gate must never fail - the operator's ruling is that anything big waits for a
// board card. Three real HF buckets slipped through, including the largest one
// that exists. The remedy is the one that removes the whole class: enumerate the
// SAFE buckets, so a bucket nobody has seen yet is a refusal by construction.
// ---------------------------------------------------------------------------

const sized = (bucket) => {
  const tags = ["task_categories:image-to-text", "license:odc-by"];
  if (bucket) tags.push(`size_categories:${bucket}`);
  return mod().datasetItem(dataset({ tags }));
};

test("POSITIVE CONTROL: the buckets at or under the 100K cap still run without asking", () => {
  for (const ok of ["n<1K", "1K<n<10K", "10K<n<100K"]) {
    assert.equal(mod().isCheapRun(sized(ok)), true, `${ok} should be a cheap run`);
  }
});

test("cheap-run gate: `n>1T` - the LARGEST bucket HF has - is refused", () => {
  // It was accepted. The denylist anchored on the bucket's first character and
  // this one begins with "n", so the biggest corpus on the site read as small.
  assert.equal(mod().isCheapRun(sized("n>1T")), false);
});

test("cheap-run gate: `100K<n<1M` is refused - it is above the declared 100K cap", () => {
  // Accepted before: the denylist started its ladder at 1M, so the bucket that
  // straddles the cap was never named and passed by omission.
  assert.equal(mod().isCheapRun(sized("100K<n<1M")), false);
});

test("cheap-run gate: a dataset declaring NO size is refused, like every other unknown", () => {
  // Silence is not smallness. Every other clause in this gate already fails
  // closed on an unknown; size was the one that failed open.
  assert.equal(mod().isCheapRun(sized(null)), false);
});

test("cheap-run gate: an unrecognised size bucket is refused, not waved through", () => {
  // The point of the safe-set rewrite: a bucket HF has not invented yet.
  assert.equal(mod().isCheapRun(sized("42Q<n<43Q")), false);
});

test("CONTROL: normalize() emits no `tags`, so no guard may read item.tags", () => {
  // The training-scale guard read `item.tags` on a NORMALIZED item for months.
  // normalize() never copies tags, so it could not fire once. This test is the
  // reason it cannot come back - it fails the moment someone reaches for tags
  // on the wrong side of normalize().
  const item = mod().datasetItem(dataset());
  assert.equal(item.tags, undefined, "normalize() started carrying tags - re-read the guards");
  // Comment lines are stripped first: the source EXPLAINS this trap, and a grep
  // that cannot tell an explanation from a use reports the warning as the bug.
  const code = require("fs")
    .readFileSync(require.resolve("../modules/huggingface"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  assert.equal(
    /item\.tags/.test(code),
    false,
    "a guard is reading item.tags again; on a normalized item that is always empty"
  );
});

test("cheap-run gate: a licence of the wrong SHAPE fails closed", () => {
  // HF cardData occasionally carries a list. A Set lookup on an array is false,
  // which is the right answer - this pins that it stays the right answer.
  const item = mod().datasetItem(dataset({ cardData: { license: ["mit", "apache-2.0"] } }));
  assert.equal(mod().isCheapRun(item), false, "an array licence must not be read as permissive");
});

// ---------------------------------------------------------------------------
// C8 - what the page showed the moment it was real.
//
// The first live render put `HuggingFaceFW/fineweb` (10-100 BILLION rows) under
// the design-fidelity instrument. Two separate defects, both invisible until the
// artifact existed:
//
//  1. every slot declares `size_cap_mb` and NOTHING read it - a lever armed in
//     config with no call site, which reads as a guarantee and enforces nothing;
//  2. `design-fidelity` listed `text-generation` among its task categories, so
//     every training corpus on HuggingFace qualified to grade a screenshot.
//
// (2) is a config fix. (1) is this gate.
// ---------------------------------------------------------------------------

const SIZED_PROJECTS = {
  projects: [{
    id: "apollo", name: "Apollo", topics: ["design-to-code"],
    slots: [{ id: "design-fidelity", kind: "dataset", task_categories: ["image-to-text"],
              licence_ok: ["odc-by"], size_cap_mb: 500 }],
  }],
};
const sizedMod = () => {
  const m = new HuggingFaceModule(cfg);
  m.loadProjects = () => SIZED_PROJECTS;
  return m;
};
const imgSet = (bucket) => ({
  id: "someone/pairs",
  tags: ["task_categories:image-to-text", "license:odc-by",
         ...(bucket ? [`size_categories:${bucket}`] : [])],
});

test("POSITIVE CONTROL: a corpus inside the slot's budget still matches", () => {
  for (const ok of ["n<1K", "10K<n<100K", "100K<n<1M"]) {
    assert.equal(sizedMod().matchSlots(imgSet(ok), "dataset").length, 1, `${ok} should fit 500 MB`);
  }
});

test("a corpus far above the slot's declared budget is refused", () => {
  // fineweb, verbatim from the first live render.
  for (const big of ["1M<n<10M", "10B<n<100B", "n>1T"]) {
    assert.deepEqual(sizedMod().matchSlots(imgSet(big), "dataset"), [], `${big} fits in 500 MB?`);
  }
});

test("a corpus declaring NO size is refused - the budget cannot be checked", () => {
  assert.deepEqual(sizedMod().matchSlots(imgSet(null), "dataset"), []);
});

test("the size refusal is nameable, so the near-miss log can say what happened", () => {
  assert.equal(sizedMod().slotMissReason(imgSet("10B<n<100B"), "dataset"), "too-big-for-this-slot");
});

test("CONTROL: the design instrument no longer accepts a plain text corpus", () => {
  // Reads the REAL config, not a fixture: the defect was in the data, and a
  // fixture would have passed while the page kept showing fineweb.
  const real = liveProjectsOrSkip("design instrument");
  if (!real) return;
  const design = real.flatMap((p) => p.slots || []).find((s) => s.id === "design-fidelity");
  assert.ok(design, "design-fidelity slot missing from config/projects.json");
  assert.equal(
    (design.task_categories || []).includes("text-generation"),
    false,
    "text-generation qualifies every training corpus on HF to grade a screenshot"
  );
});

// ---------------------------------------------------------------------------
// C8 - the cheap-run gate must SAY which clause refused.
//
// The digest printed "licence is not on the permissive list" beside
// `nyu-visionx/VSI-590K`, whose licence is apache-2.0 and IS on that list. The
// row was refused for its SIZE. The explanation was a small re-implementation of
// the gate that checked two of its clauses and guessed the rest - the same
// matcher/explanation drift `_slotVerdict` exists to prevent, one layer up.
// ---------------------------------------------------------------------------

test("the refusal names the clause that actually refused - size, not a guessed licence", () => {
  const item = mod().datasetItem(dataset({
    id: "nyu-visionx/VSI-590K",
    tags: ["task_categories:image-to-text", "license:apache-2.0", "size_categories:100K<n<1M"],
    cardData: { license: "apache-2.0" },
  }));
  assert.equal(mod().isCheapRun(item), false);
  assert.match(mod().cheapRunRefusal(item), /size|rows|100K/i);
  assert.doesNotMatch(mod().cheapRunRefusal(item), /licence|license/i);
});

test("a gated dataset's refusal names the terms, not the size", () => {
  const item = mod().datasetItem(dataset({ gated: "auto" }));
  assert.match(mod().cheapRunRefusal(item), /gated|terms/i);
});

test("CONTROL: a dataset that DOES pass has no refusal to report", () => {
  assert.equal(mod().cheapRunRefusal(mod().datasetItem(dataset())), null);
});

// ---------------------------------------------------------------------------
// /deep-test C2 (2026-09-03) - the SUBJECT gate.
//
// Every gate above this one proves a reference has the right SHAPE. None of them
// proves it is ABOUT what the instrument does, and HuggingFace's task_categories
// is a shape signal only: `image-to-text` covers OCR, captioning and VQA as well
// as screenshot->code; `text-generation` covers nearly everything. Measured on the
// live page: 22 of 23 candidates could not grade the instrument they were filed
// under - Arabic Islamic book scans and an 1770-1810 newspaper archive offered as
// answer keys for a screenshot grader, gsm8k and truthful_qa for a function-calling
// harness - each carrying the reason "grades apollo/design-fidelity", which is an
// assertion and not evidence.
//
// These read the REAL config. A fixture would pass while the page kept showing
// book scans, which is exactly how the fineweb defect survived its own test run.
// ---------------------------------------------------------------------------

/**
 * These cells assert on the LIVE config, not on a fixture, and deliberately so:
 * the defects they guard were in the DATA - a slot declaring a task category
 * that qualifies every training corpus on the hub to grade a screenshot. A
 * fixture would have stayed green while the page kept showing the wrong answer
 * key.
 *
 * That makes them unrunnable on a checkout with no config of its own, which is
 * every clone and every CI run. They must SKIP there, and say so. A silent pass
 * would be the worse outcome by far: it is the same shape as the defect - an
 * instrument reporting clean when it never looked.
 */
function liveProjectsOrSkip(label) {
  const f = require("path").join(__dirname, "..", "config", "projects.json");
  if (!require("fs").existsSync(f)) {
    console.log(`SKIPPED (${label}): no config/projects.json - this cell asserts on live data, not on a fixture`);
    return null;
  }
  return new HuggingFaceModule(cfg).loadProjects().projects || [];
}

const realMod = () => new HuggingFaceModule(cfg);
const ds = (id, tags) => ({ id, tags });

test("a book-scan OCR corpus is no longer offered as an answer key for a screenshot grader", () => {
  if (!liveProjectsOrSkip("a book-scan OCR corpus is no longe")) return;
  const hits = realMod().matchSlots(
    ds("ieasybooks-org/waqfeya-library",
       ["task_categories:image-to-text", "license:mit", "size_categories:10k<n<100k"]),
    "dataset"
  );
  assert.deepEqual(hits, [], `still filed under: ${hits.map((h) => h.slot).join(", ")}`);
});

test("grade-school maths is no longer offered as an answer key for tool-calling", () => {
  if (!liveProjectsOrSkip("grade-school maths is no longer of")) return;
  const hits = realMod().matchSlots(
    ds("openai/gsm8k", ["task_categories:text-generation", "license:mit", "size_categories:1k<n<10k"]),
    "dataset"
  );
  assert.deepEqual(hits, [], `still filed under: ${hits.map((h) => h.slot).join(", ")}`);
});

test("CONTROL: every answer key we actually use still matches its own slot", () => {
  if (!liveProjectsOrSkip("CONTROL: every answer key we actua")) return;
  // The vocabulary half of the fix is a hand-written list, and a hand-written list
  // is proven complete only by the cases where it MUST fire. This control caught
  // `halluc` vs `HaluEval` - the corpus spells it with one l - and nothing else
  // would have: the wrong-subject cells above all stayed green while the one
  // reference the groundedness instrument is built on was being dropped.
  const cases = [
    ["SALT-NLP/Design2Code", ["task_categories:image-to-text", "license:odc-by", "size_categories:n<1k"], "design-fidelity"],
    ["gorilla-llm/Berkeley-Function-Calling-Leaderboard", ["task_categories:text-generation", "license:apache-2.0", "size_categories:1k<n<10k"], "tool-calling"],
    ["NousResearch/hermes-function-calling-v1", ["task_categories:text-generation", "license:apache-2.0", "size_categories:1k<n<10k"], "tool-calling"],
    ["pminervini/HaluEval", ["task_categories:text-classification", "license:apache-2.0", "size_categories:10k<n<100k"], "groundedness"],
    ["bltlab/open-ner-standardized", ["task_categories:token-classification", "language:he", "license:cc-by-4.0", "size_categories:1k<n<10k"], "contact-name-ner"],
    ["fsicoli/common_voice_22_0", ["task_categories:automatic-speech-recognition", "language:he", "license:cc0-1.0", "size_categories:10k<n<100k"], "voice-wer"],
    ["gretelai/synthetic_text_to_sql", ["task_categories:text2text-generation", "license:apache-2.0", "size_categories:10k<n<100k"], "text-to-sql"],
  ];
  const lost = cases.filter(([id, tags, want]) =>
    !realMod().matchSlots(ds(id, tags), "dataset").some((h) => h.slot === want));
  assert.deepEqual(lost.map((c) => c[0]), [], "a subject vocabulary that drops our own references is worse than none");
});

test("CONTROL: a slot that declares no subject is NOT narrowed - absence must not empty the page", () => {
  const m2 = new HuggingFaceModule(cfg);
  m2.loadProjects = () => ({ projects: [{ id: "p", slots: [{
    id: "no-subject", kind: "dataset", task_categories: ["image-to-text"],
    licence_ok: ["mit"], size_cap_mb: 500,
  }] }] });
  const hits = m2.matchSlots(
    ds("anyone/anything", ["task_categories:image-to-text", "license:mit", "size_categories:n<1k"]),
    "dataset"
  );
  assert.equal(hits.length, 1, "an undeclared subject must leave the slot exactly as it was");
});

test("the subject refusal is nameable, and it is the DEEPEST gate", () => {
  const m2 = new HuggingFaceModule(cfg);
  m2.loadProjects = () => ({ projects: [{ id: "p", slots: [{
    id: "subj", kind: "dataset", task_categories: ["image-to-text"],
    licence_ok: ["mit"], size_cap_mb: 500, subject_any: ["screenshot"],
  }] }] });
  assert.equal(
    m2.slotMissReason(ds("someone/book-scans", ["task_categories:image-to-text", "license:mit", "size_categories:n<1k"]), "dataset"),
    "wrong-subject"
  );
});

test("every gate _slotVerdict can emit is rankable in SLOT_MISS_DEPTH", () => {
  // A gate name missing from the depth list is ranked -1, loses every comparison,
  // and if it were the only verdict slotMissReason would return null - which means
  // "something matched". A new gate would then make its own misses invisible AND
  // report them as hits. This is the guard that makes adding a gate safe.
  // The gate chain lives in slot-gate.js since the H4 extraction (2026-09-03);
  // huggingface.js only delegates, so its source carries no `return "<gate>"`.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "modules", "slot-gate.js"), "utf8");
  const body = src.slice(src.indexOf("function hfSlotVerdict("), src.indexOf("function matchSlots("));
  const emitted = [...body.matchAll(/return "([a-z-]+)"/g)].map((x) => x[1]);
  const depthSrc = src.slice(src.indexOf("const SLOT_MISS_DEPTH"));
  const ranked = depthSrc.slice(depthSrc.indexOf("["), depthSrc.indexOf("];") + 1);
  assert.ok(emitted.length >= 8, `expected the gate chain, found ${emitted.length} returns`);
  const missing = [...new Set(emitted)].filter((g) => !ranked.includes(`"${g}"`));
  assert.deepEqual(missing, [], "a gate that cannot be ranked makes its own misses read as matches");
});

test("a term appearing in the card PROSE is not a subject claim", () => {
  if (!liveProjectsOrSkip("a term appearing in the card PROSE")) return;
  // nyu-visionx/VSI-590K, a spatial-reasoning VQA set, was admitted to the
  // screenshot-grading slot because its README carries the link bar
  // "website | paper | github | models" and the gate was reading the card body.
  // Free-form prose will eventually contain every term any slot declares, so the
  // gate reads DECLARED fields only: id, pretty name, tags.
  const raw = {
    id: "nyu-visionx/VSI-590K",
    title: "nyu-visionx/VSI-590K",
    description: "VSI-590K\n\nwebsite | paper | github | models\n\nspatial reasoning instruction tuning",
    tags: ["task_categories:image-to-text", "license:apache-2.0", "size_categories:10k<n<100k"],
  };
  assert.deepEqual(realMod().matchSlots(raw, "dataset"), []);
  assert.equal(realMod().slotMissReason(raw, "dataset"), "wrong-subject");
});

test("CONTROL: a declared pretty_name still counts as a subject claim", () => {
  // Narrowing must not go so far that a publisher's own title stops counting.
  const m2 = new HuggingFaceModule(cfg);
  m2.loadProjects = () => ({ projects: [{ id: "p", slots: [{
    id: "s", kind: "dataset", task_categories: ["image-to-text"],
    licence_ok: ["mit"], size_cap_mb: 500, subject_any: ["screenshot"],
  }] }] });
  const raw = {
    id: "someone/opaque-id-123",
    cardData: { pretty_name: "Screenshot to HTML pairs" },
    tags: ["task_categories:image-to-text", "license:mit", "size_categories:n<1k"],
  };
  assert.equal(m2.matchSlots(raw, "dataset").length, 1);
});
