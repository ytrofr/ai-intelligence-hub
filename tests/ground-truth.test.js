const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroundTruth } = require("../modules/ground-truth");

// ---------------------------------------------------------------------------
// C6 - the ground-truth page's data.
//
// One question per row: what checks this instrument, and what did it last say?
// The page exists because the answer for most instruments was "nothing", and a
// board that quietly omits those looks finished and teaches nothing. So an
// absence is a row here, never a missing row.
// ---------------------------------------------------------------------------

const PROJECTS = [
  {
    id: "orion", name: "Orion",
    slots: [
      { id: "voice-wer", instrument: "app/channels/media.py", kind: "dataset",
        language: "he", task_categories: ["automatic-speech-recognition"],
        licence_ok: ["cc0-1.0"],
        ran: [{ reference: "fsicoli/common_voice_22_0", n: 40, number: "WER 0.170",
                caveat: "point estimate; variance unmeasured", at: "2026-09-03" }] },
      { id: "groundedness", instrument: "groundedness/verifier.py", kind: "dataset",
        task_categories: ["question-answering"], licence_ok: ["apache-2.0"], ran: [] },
    ],
  },
  {
    id: "lyra", name: "CC Stack",
    slots: [{ id: "skill-evals", instrument: "-", kind: "dataset", task_categories: [],
              licence_ok: [], ran: [], gap: "HuggingFace cannot supply this" }],
  },
  // A project with NO slots at all. It must still be listed.
  { id: "remotion", name: "Remotion", slots: [] },
];

const item = (over = {}) => ({
  id: "huggingface-dataset-fsicoli/common_voice_22_0",
  title: "fsicoli/common_voice_22_0",
  url: "https://huggingface.co/datasets/fsicoli/common_voice_22_0",
  metadata: {
    kind: "dataset", gated: false, license: "cc0-1.0", size_category: "10K<n<100K",
    matched_projects: [{ id: "orion", name: "Orion" }],
    matched_slots: [{ project: "orion", slot: "voice-wer", instrument: "app/channels/media.py" }],
  },
  ...over,
});

const build = (over = {}) =>
  buildGroundTruth({ projects: PROJECTS, items: [item()], nearMisses: [], classify: () => "runnable", ...over });

test("CONTROL: a project with NO slots is still listed - an absence is a row, not a missing row", () => {
  const { projects } = build();
  const remotion = projects.find((p) => p.id === "remotion");
  assert.ok(remotion, "a project with no instruments vanished; the page now looks finished");
  assert.deepEqual(remotion.slots, []);
  assert.equal(remotion.counts.slots, 0);
});

test("a candidate lands under the slot its matched_slots NAMES, not under every slot of the project", () => {
  const { projects } = build();
  const smith = projects.find((p) => p.id === "orion");
  const wer = smith.slots.find((s) => s.id === "voice-wer");
  const grd = smith.slots.find((s) => s.id === "groundedness");
  assert.equal(wer.candidates.length, 1);
  assert.equal(wer.candidates[0].status, "runnable");
  assert.equal(grd.candidates.length, 0, "a project-level match is not a slot-level one");
});

test("a slot that has never run says so, and reports no number rather than a zero", () => {
  const { projects } = build();
  const grd = projects.find((p) => p.id === "orion").slots.find((s) => s.id === "groundedness");
  assert.equal(grd.last_ran, null, "null means never run; 0 would read as a measured zero");
  assert.equal(grd.runs, 0);
});

test("a slot's last run carries its number AND the caveat that bounds it", () => {
  const { projects } = build();
  const wer = projects.find((p) => p.id === "orion").slots.find((s) => s.id === "voice-wer");
  assert.equal(wer.last_ran.number, "WER 0.170");
  assert.ok(wer.last_ran.caveat, "a number without its caveat is the thing that gets quoted wrong");
});

test("a declared GAP is carried through - it is a finding, not an empty row", () => {
  const { projects } = build();
  const gap = projects.find((p) => p.id === "lyra").slots[0];
  assert.equal(gap.gap, "HuggingFace cannot supply this");
  assert.equal(gap.last_ran, null);
});

test("near misses attach to their project and are counted", () => {
  const { projects, counts } = build({
    nearMisses: [{ item_id: "dataset-a/b", project: "orion", kind: "dataset",
                   reason: "licence-not-allowed", title: "a/b", url: "u", seen_at: "2026-09-03T00:00:00Z" }],
  });
  const smith = projects.find((p) => p.id === "orion");
  assert.equal(smith.near_misses.length, 1);
  assert.equal(smith.near_misses[0].reason, "licence-not-allowed");
  assert.equal(counts.near_misses, 1);
});

test("counts are derived from the rendered rows, so they cannot disagree with the page", () => {
  const { projects, counts } = build();
  assert.equal(counts.projects, projects.length);
  assert.equal(counts.slots, projects.reduce((n, p) => n + p.slots.length, 0));
  assert.equal(counts.slots_with_a_run, 1, "only voice-wer has ever run");
  assert.equal(counts.slots_never_run, 2, "groundedness and the lyra gap");
  assert.equal(counts.candidates, 1);
});

test("CONTROL: an item matching the PROJECT but no slot is never a candidate", () => {
  const stray = item({
    id: "huggingface-dataset-someone/unrelated",
    metadata: { ...item().metadata, matched_slots: [] },
  });
  const { projects, counts } = build({ items: [stray] });
  const smith = projects.find((p) => p.id === "orion");
  assert.equal(smith.slots.reduce((n, s) => n + s.candidates.length, 0), 0);
  assert.equal(counts.candidates, 0);
});

test("a run's date is read whether the config wrote `at` or `date`", () => {
  // The slot config writes `date`. The builder originally read only `at`, so
  // every recorded run rendered undated and nothing failed - the field was
  // simply absent on both sides of a comparison nobody made.
  const withDate = [{ id: "x", name: "X", slots: [{ id: "s", ran: [{ number: "n", date: "2026-09-03" }] }] }];
  const { projects } = buildGroundTruth({ projects: withDate });
  assert.equal(projects[0].slots[0].last_ran.at, "2026-09-03");
});

// /deep-test C2 (2026-09-03): the page must not present a shortlist as an answer.
test("a slot says whether its candidates cleared a SUBJECT gate or only a shape one", () => {
  const built = buildGroundTruth({
    projects: [{ id: "p", slots: [
      { id: "declared", instrument: "a.py", kind: "dataset", task_categories: ["image-to-text"], subject_any: ["screenshot"], ran: [] },
      { id: "shape-only", instrument: "b.py", kind: "dataset", task_categories: ["image-to-text"], ran: [] },
    ] }],
    items: [], nearMisses: [], classify: () => "runnable", refusal: () => null,
  });
  const [a, b] = built.projects[0].slots;
  assert.equal(a.subject_declared, true);
  assert.equal(b.subject_declared, false, "a slot with no subject matches on HF's task category alone");
});

test("the headline splits vetted from shape-only candidates - they are not the same claim", () => {
  const item = (slot) => ({
    id: `x-${slot}`, title: "t", url: "u",
    metadata: { matched_slots: [{ project: "p", slot }], kind: "dataset" },
  });
  const built = buildGroundTruth({
    projects: [{ id: "p", slots: [
      { id: "declared", instrument: "a.py", kind: "dataset", subject_any: ["screenshot"], ran: [] },
      { id: "shape-only", instrument: "b.py", kind: "dataset", ran: [] },
    ] }],
    items: [item("declared"), item("shape-only"), item("shape-only")],
    nearMisses: [], classify: () => "runnable", refusal: () => null,
  });
  assert.equal(built.counts.candidates, 3);
  assert.equal(built.counts.candidates_vetted, 1);
  assert.equal(built.counts.candidates_unvetted, 2);
  assert.equal(built.counts.slots_without_a_subject, 1);
});

test("the unvetted caveat has ONE source - the page and the digest never write their own", () => {
  // Two copies of one claim drift. Same reason matchSlots and slotMissReason share
  // a gate chain, and isCheapRun is defined as cheapRunRefusal(...) === null.
  const { UNVETTED_CAVEAT } = require("../modules/ground-truth");
  const built = buildGroundTruth({
    projects: [{ id: "p", slots: [
      { id: "declared", instrument: "a", kind: "dataset", subject_any: ["x"], ran: [] },
      { id: "shape-only", instrument: "b", kind: "dataset", ran: [] },
    ] }],
    items: [], nearMisses: [], classify: () => "runnable", refusal: () => null,
  });
  const [a, b] = built.projects[0].slots;
  assert.equal(a.unvetted_caveat, null, "a slot that declared its subject carries no caveat");
  assert.equal(b.unvetted_caveat, UNVETTED_CAVEAT);

  const fs = require("fs"), path = require("path");
  const phrase = "the right SHAPE of data";
  const copies = ["public/ground-truth.html", "modules/weekly-digest.js"].filter((f) =>
    fs.readFileSync(path.join(__dirname, "..", f), "utf8").includes(phrase));
  assert.deepEqual(copies, [], "a renderer is spelling the caveat out instead of reading it");
});
