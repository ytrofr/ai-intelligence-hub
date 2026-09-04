const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const slotGate = require("../modules/slot-gate");
const HuggingFaceModule = require("../modules/huggingface");

// ---------------------------------------------------------------------------
// Fixtures - one project carrying one slot of every kind the vocabulary
// defines, so a single PROJECTS array exercises every cross-source direction.
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    id: "orion",
    name: "Orion",
    slots: [
      {
        id: "voice-wer", kind: "dataset", task_categories: ["automatic-speech-recognition"],
        language: "he", licence_ok: ["cc0-1.0", "cc-by-4.0"], size_cap_mb: 500,
      },
    ],
  },
  {
    id: "apollo",
    name: "Apollo",
    slots: [
      {
        id: "screenshot-model", kind: "model", task_categories: ["image-to-text"],
        licence_ok: ["apache-2.0", "mit"], size_cap_mb: 500,
      },
      {
        id: "sdk-health", kind: "package", instrument: "scripts/check-sdk.py",
        licence_ok: ["apache-2.0", "mit"], subject_any: ["adk", "agent development kit"],
      },
      {
        id: "runtime-health", kind: "service", instrument: "scripts/check-runtime.py",
        licence_ok: ["apache-2.0", "mit"], language: "python", subject_any: ["fastapi", "runtime"],
      },
      {
        id: "skill-benchmark", kind: "skill-eval", instrument: "scripts/check-skills.py",
      },
    ],
  },
];

const dset = (over = {}) => ({
  id: "fsicoli/common_voice_22_0",
  tags: ["task_categories:automatic-speech-recognition", "language:he", "license:cc0-1.0",
         "size_categories:10k<n<100k"],
  ...over,
});

const repo = (over = {}) => ({
  full_name: "google/adk-python",
  html_url: "https://github.com/google/adk-python",
  description: "Agent Development Kit for building AI agents",
  language: "Python",
  topics: ["adk", "agents"],
  license: { spdx_id: "Apache-2.0" },
  ...over,
});

// ---------------------------------------------------------------------------
// C1 - a GitHub repo fills a `package` slot the same way an HF dataset fills
// a `ground-truth` one. Both directions in one test, so a matcher that only
// works for the source it was written against cannot pass silently.
// ---------------------------------------------------------------------------

test("POSITIVE CONTROL: an HF dataset still matches its ground-truth slot", () => {
  const facts = slotGate.slotFactsFromHf(dset(), "dataset");
  const hits = slotGate.matchSlots(facts, PROJECTS);
  assert.deepEqual(hits.map((h) => `${h.project}/${h.slot}`), ["orion/voice-wer"]);
});

test("a GitHub repo matches a `package` slot", () => {
  const facts = slotGate.slotFactsFromGithub(repo());
  const hits = slotGate.matchSlots(facts, PROJECTS);
  assert.deepEqual(hits.map((h) => `${h.project}/${h.slot}`), ["apollo/sdk-health"]);
});

test("a GitHub repo matches a `service` slot on its own licence+language+subject", () => {
  const facts = slotGate.slotFactsFromGithub(repo({
    full_name: "tiangolo/fastapi", html_url: "https://github.com/tiangolo/fastapi",
    description: "FastAPI framework, high performance, easy to learn, fast to code",
    language: "Python", topics: ["fastapi", "python"], license: { spdx_id: "MIT" },
  }));
  const hits = slotGate.matchSlots(facts, PROJECTS);
  assert.deepEqual(hits.map((h) => `${h.project}/${h.slot}`), ["apollo/runtime-health"]);
});

test("a near miss is logged with the SAME reason vocabulary regardless of source", () => {
  // Same ADK repo, but MIT (sdk-health only allows apache-2.0/mit)... use a
  // licence NOT on the list so it reaches the near-miss path with a real gate.
  const facts = slotGate.slotFactsFromGithub(repo({ license: { spdx_id: "GPL-3.0" } }));
  const reason = slotGate.slotMissReason(facts, PROJECTS);
  assert.equal(reason, "licence-not-allowed");

  const rows = [];
  const store = { record: (r) => rows.push(r) };
  // Same shape modules/huggingface.js's `_recordNearMiss` writes.
  const matched = [{ id: "apollo", name: "Apollo" }];
  const seen_at = new Date().toISOString();
  for (const project of matched) {
    store.record({ item_id: "repo-x", project: project.id, kind: "repo", reason, title: "x", url: "https://x", seen_at });
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "licence-not-allowed");
  assert.equal(rows[0].kind, "repo");
});

// ---------------------------------------------------------------------------
// C2 - wrong-source, both directions. A slot's KIND must gate the match
// before anything about the reference's content is even read.
// ---------------------------------------------------------------------------

test("wrong-source: a ground-truth slot never matches a GitHub item", () => {
  const groundTruthSlot = PROJECTS[0].slots[0]; // orion/voice-wer, kind: dataset
  const githubFacts = slotGate.slotFactsFromGithub(repo());
  assert.equal(slotGate.slotVerdict(groundTruthSlot, githubFacts), "wrong-source");
});

test("wrong-source: a package slot never matches an HF dataset", () => {
  const packageSlot = PROJECTS[1].slots[1]; // apollo/sdk-health, kind: package
  const hfFacts = slotGate.slotFactsFromHf(dset(), "dataset");
  assert.equal(slotGate.slotVerdict(packageSlot, hfFacts), "wrong-source");
});

test("wrong-source: a model slot never matches a GitHub item", () => {
  const modelSlot = PROJECTS[1].slots[0]; // apollo/screenshot-model, kind: model
  const githubFacts = slotGate.slotFactsFromGithub(repo());
  assert.equal(slotGate.slotVerdict(modelSlot, githubFacts), "wrong-source");
});

test("wrong-source: a service slot never matches an HF model", () => {
  const serviceSlot = PROJECTS[1].slots[2]; // apollo/runtime-health, kind: service
  const hfModelFacts = slotGate.slotFactsFromHf({ id: "x", pipeline_tag: "image-to-text", tags: ["license:mit"] }, "model");
  assert.equal(slotGate.slotVerdict(serviceSlot, hfModelFacts), "wrong-source");
});

test("skill-eval matches nothing from any feed", () => {
  const skillSlot = PROJECTS[1].slots[3]; // apollo/skill-benchmark, kind: skill-eval
  assert.equal(slotGate.slotVerdict(skillSlot, slotGate.slotFactsFromGithub(repo())), "wrong-source");
  assert.equal(slotGate.slotVerdict(skillSlot, slotGate.slotFactsFromHf(dset(), "dataset")), "wrong-source");
});

test("matchSlots never crosses kind/source in either direction (full sweep)", () => {
  const hfHits = slotGate.matchSlots(slotGate.slotFactsFromHf(dset(), "dataset"), PROJECTS);
  assert.deepEqual(hfHits.map((h) => h.slot), ["voice-wer"], "an HF dataset must never fill a package/service/model slot");
  const ghHits = slotGate.matchSlots(slotGate.slotFactsFromGithub(repo()), PROJECTS);
  assert.deepEqual(ghHits.map((h) => h.slot), ["sdk-health"], "a repo must never fill a ground-truth/model slot");
});

// ---------------------------------------------------------------------------
// C3 - the legacy `kind: "dataset"` spelling. The live config/projects.json
// shipped 11 slots under this literal string before `ground-truth` existed;
// a rename that stopped matching them would be a silent regression.
// ---------------------------------------------------------------------------

test("a `kind: dataset` slot matches an HF dataset exactly as before - byte-identical reasons", () => {
  const legacySlot = { id: "legacy", kind: "dataset", task_categories: ["automatic-speech-recognition"],
    language: "he", licence_ok: ["cc0-1.0"], size_cap_mb: 500 };
  const spelledOutSlot = { ...legacySlot, id: "spelled-out", kind: "ground-truth" };
  const facts = slotGate.slotFactsFromHf(dset(), "dataset");
  assert.equal(slotGate.slotVerdict(legacySlot, facts), null, "the legacy spelling must still match");
  assert.equal(
    slotGate.slotVerdict(legacySlot, facts),
    slotGate.slotVerdict(spelledOutSlot, facts),
    "`dataset` and `ground-truth` must be indistinguishable to the gate"
  );
  // Wrong licence: both spellings must report the identical reason string.
  const wrongLicence = slotGate.slotFactsFromHf(dset({ tags: dset().tags.map((t) => t.replace("license:cc0-1.0", "license:mit")) }), "dataset");
  assert.equal(slotGate.slotVerdict(legacySlot, wrongLicence), "licence-not-allowed");
  assert.equal(slotGate.slotVerdict(legacySlot, wrongLicence), slotGate.slotVerdict(spelledOutSlot, wrongLicence));
});

test("a `package` slot never matches an HF item, dataset OR model", () => {
  const packageSlot = { id: "p", kind: "package", licence_ok: ["mit"], subject_any: ["anything"] };
  assert.equal(slotGate.slotVerdict(packageSlot, slotGate.slotFactsFromHf(dset(), "dataset")), "wrong-source");
  assert.equal(
    slotGate.slotVerdict(packageSlot, slotGate.slotFactsFromHf({ id: "m", pipeline_tag: "text-generation", tags: [] }, "model")),
    "wrong-source"
  );
});

// ---------------------------------------------------------------------------
// C4 - the package/service gate chain itself: licence_ok fails closed on an
// unknown licence, language is optional, subject_any fails closed when absent
// (unlike the HF chain's deliberately-UNVETTED pass-through).
// ---------------------------------------------------------------------------

test("unknown licence is refused - silence is not permission", () => {
  const slot = { id: "s", kind: "package", licence_ok: ["mit", "apache-2.0"], subject_any: ["adk"] };
  const facts = slotGate.slotFactsFromGithub(repo({ license: null }));
  assert.equal(facts.licence, null);
  assert.equal(slotGate.slotVerdict(slot, facts), "licence-unknown");
});

test("a licence not on the slot's allowlist is refused by name", () => {
  const slot = { id: "s", kind: "package", licence_ok: ["mit"], subject_any: ["adk"] };
  const facts = slotGate.slotFactsFromGithub(repo({ license: { spdx_id: "GPL-3.0" } }));
  assert.equal(slotGate.slotVerdict(slot, facts), "licence-not-allowed");
});

test("a slot declaring no licences at all matches nothing - same fail-closed shape as the HF chain", () => {
  const slot = { id: "s", kind: "package", licence_ok: [], subject_any: ["adk"] };
  assert.equal(slotGate.slotVerdict(slot, slotGate.slotFactsFromGithub(repo())), "slot-declares-no-licences");
});

test("a package/service slot with NO declared subject fails CLOSED - unlike the HF chain", () => {
  const slot = { id: "s", kind: "package", licence_ok: ["apache-2.0"] }; // no subject_any at all
  assert.equal(slotGate.slotVerdict(slot, slotGate.slotFactsFromGithub(repo())), "slot-declares-no-subject");
});

test("CONTROL: the HF chain stays UNVETTED (matches) when a ground-truth slot declares no subject", () => {
  const slot = { id: "s", kind: "ground-truth", task_categories: ["automatic-speech-recognition"],
    language: "he", licence_ok: ["cc0-1.0"], size_cap_mb: 500 }; // no subject_any
  assert.equal(slotGate.slotVerdict(slot, slotGate.slotFactsFromHf(dset(), "dataset")), null);
});

test("an optional language mismatch on a package/service slot is nameable", () => {
  const slot = { id: "s", kind: "service", licence_ok: ["apache-2.0"], language: "javascript", subject_any: ["adk"] };
  assert.equal(slotGate.slotVerdict(slot, slotGate.slotFactsFromGithub(repo())), "wrong-language");
});

test("subject_any is read from full_name + description + topics", () => {
  const slot = { id: "s", kind: "package", licence_ok: ["apache-2.0"], subject_any: ["agent development kit"] };
  // Term appears only in the description, not the name or topics.
  assert.equal(slotGate.slotVerdict(slot, slotGate.slotFactsFromGithub(repo({ topics: [] }))), null);
  assert.equal(
    slotGate.slotVerdict(slot, slotGate.slotFactsFromGithub(repo({ description: "", topics: [] }))),
    "wrong-subject"
  );
});

// ---------------------------------------------------------------------------
// C5 - the accepted/normalized-item shape works too: slotFactsFromGithub must
// read `metadata.license`/`metadata.language`/`metadata.topics` when given an
// already-normalized item, not only the raw GitHub API payload.
// ---------------------------------------------------------------------------

test("slotFactsFromGithub also reads an already-normalized item's metadata", () => {
  const item = {
    title: "google/adk-python",
    description: "Agent Development Kit for building AI agents",
    metadata: { license: "apache-2.0", language: "Python", topics: ["adk"] },
  };
  const facts = slotGate.slotFactsFromGithub(item);
  assert.equal(facts.licence, "apache-2.0");
  assert.equal(facts.language, "python");
  assert.match(facts.text, /adk/);
});

// ---------------------------------------------------------------------------
// test_slot_gate_split_identity - the H4 extraction left modules/huggingface.js
// with NO gate logic of its own (the retained dead copy was removed 2026-09-03):
// its `matchSlots`/`slotMissReason` must be pure delegation to this module.
// Across a battery of HF fixtures, the HF module's public answer and this
// module's answer for the same facts + projects must be IDENTICAL, every time.
// ---------------------------------------------------------------------------

test("test_slot_gate_split_identity - the HF module's matchSlots/slotMissReason are pure delegation", () => {
  const hf = new HuggingFaceModule({ id: "huggingface", name: "HuggingFace", type: "huggingface", config: {} });
  const slot = { id: "voice-wer", kind: "dataset", task_categories: ["automatic-speech-recognition"],
    language: "he", licence_ok: ["cc0-1.0", "cc-by-4.0"], size_cap_mb: 500, subject_any: ["voice", "speech"] };
  const gapSlot = { id: "gap", kind: "dataset", task_categories: [], licence_ok: [] };
  const projects = [{ id: "orion", slots: [slot, gapSlot] }];
  hf.loadProjects = () => ({ projects });

  const fixtures = [
    dset(), // clean match
    dset({ tags: ["task_categories:text-generation", "license:cc0-1.0", "size_categories:1k<n<10k"] }), // task-not-graded
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:pt", "license:cc0-1.0", "size_categories:1k<n<10k"] }), // wrong-language
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he", "license:cc-by-nc-4.0", "size_categories:1k<n<10k"] }), // licence-not-allowed
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he", "size_categories:1k<n<10k"] }), // licence-unknown
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he", "license:cc0-1.0", "size_categories:10b<n<100b"] }), // too-big
    dset({ tags: ["task_categories:automatic-speech-recognition", "language:he", "license:cc0-1.0", "size_categories:1k<n<10k"], id: "someone/unrelated-corpus" }), // wrong-subject
  ];

  let matched = 0;
  for (const raw of fixtures) {
    const facts = slotGate.slotFactsFromHf(raw, "dataset");
    assert.deepEqual(hf.matchSlots(raw, "dataset"), slotGate.matchSlots(facts, projects), `matchSlots diverged for ${raw.id}`);
    assert.deepEqual(hf.slotMissReason(raw, "dataset"), slotGate.slotMissReason(facts, projects), `slotMissReason diverged for ${raw.id}`);
    matched += hf.matchSlots(raw, "dataset").length;
  }
  // CONTROL: the battery is not vacuous. Two fixtures match: the clean one, and
  // the "unrelated-corpus" one - its task tag `automatic-speech-recognition`
  // carries the word "speech", and the subject gate reads declared tags, so
  // the id alone cannot make it miss. Measured 2026-09-03, not assumed.
  assert.equal(matched, 2, "expected exactly two matching fixtures (clean + the speech-tagged id)");
});

test("test_slot_gate_split_identity - every gate string this module emits is ranked in its own SLOT_MISS_DEPTH", () => {
  // A reason missing from the depth list ranks -1 and, alone, would make
  // slotMissReason return null - "something matched". Parse THIS module's
  // source: the gate chain lives here and nowhere else now.
  const src = require("fs").readFileSync(path.join(__dirname, "..", "modules", "slot-gate.js"), "utf8");
  const body = src.slice(src.indexOf("function hfSlotVerdict("), src.indexOf("function matchSlots("));
  const emitted = [...new Set([...body.matchAll(/return "([a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(emitted.length >= 8, `expected the full gate chain, found ${emitted.length}`);
  const missing = emitted.filter((r) => !slotGate.SLOT_MISS_DEPTH.includes(r));
  assert.deepEqual(missing, [], "a gate reason absent from SLOT_MISS_DEPTH would silently misrank");
});
