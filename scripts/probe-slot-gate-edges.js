/**
 * /deep-test lane C - C1 edge/boundary inputs over the REAL gate chain and the
 * REAL slot config. No fixtures for the config: a fixture would pass while the
 * live page kept showing the wrong thing (the C8 lesson).
 *
 * Prints POPULATION and a POSITIVE CONTROL that MUST fire before any verdict.
 * Three states everywhere: PASS / FAIL / ERROR-cannot-judge.
 */
const path = require("path");
// Derived, never hardcoded: this repo is PUBLIC and its own deployment rule
// treats an absolute-home path in a published diff as always wrong.
const HUB = path.join(__dirname, "..");
const HuggingFaceModule = require(path.join(HUB, "modules/huggingface.js"));
const slotGate = require(path.join(HUB, "modules/slot-gate.js"));

const m = new HuggingFaceModule({ id: "huggingface", name: "HuggingFace", type: "huggingface", url: "https://huggingface.co/api/models", config: {} });
const cfg = m.loadProjects();
const projects = cfg.projects || [];
const slots = projects.flatMap((p) => (p.slots || []).map((s) => ({ p: p.id, ...s })));
console.log(`population: ${projects.length} projects, ${slots.length} slots ` +
  `(${slots.filter(s => (s.kind||"dataset")==="dataset").length} dataset, ${slots.filter(s => s.kind==="model").length} model)`);
if (!slots.length) { console.log("ABORT: no slots loaded - the join failed, not a finding"); process.exit(2); }

let pass = 0, fail = 0, err = 0;
const FAILS = [];
function cell(name, fn, expect) {
  let got;
  try { got = fn(); } catch (e) { err++; console.log(`  ERROR ${name}: ${e.message}`); return; }
  const ok = expect(got);
  if (ok) { pass++; } else { fail++; FAILS.push(`${name} -> ${JSON.stringify(got)}`); console.log(`  FAIL  ${name} -> ${JSON.stringify(got)}`); }
}

// ---- POSITIVE CONTROL: a payload that MUST match, built from the real config.
// If this does not fire, every negative below is vacuous.
const voice = slots.find((s) => s.id === "voice-wer");
const control = {
  id: "control/hebrew-asr",
  tags: [`task_categories:${voice.task_categories[0]}`, `language:${voice.language}`,
         `license:${voice.licence_ok[0]}`, "size_categories:1k<n<10k"],
};
const ctlHit = m.matchSlots(control, "dataset");
console.log(`positive control (a cc0 Hebrew ASR set): ${ctlHit.length ? "FIRED -> " + ctlHit.map(h=>h.project+"/"+h.slot).join(",") : "DID NOT FIRE"}`);
if (!ctlHit.length) { console.log("ABORT: the matcher cannot match anything - do not trust the negatives below"); process.exit(2); }
console.log("");

const T = (extra = {}) => ({ id: "probe/x", tags: [
  `task_categories:${voice.task_categories[0]}`, `language:${voice.language}`,
  `license:${voice.licence_ok[0]}`, "size_categories:1k<n<10k"], ...extra });
const tagsMinus = (drop) => T().tags.filter((t) => !t.startsWith(drop));
const tagsWith = (drop, add) => [...tagsMinus(drop), add];

console.log("D1  size vocabulary - every bucket not in the safe set must refuse");
const ALL_BUCKETS = ["n<1k","1k<n<10k","10k<n<100k","100k<n<1m","1m<n<10m","10m<n<100m",
                     "100m<n<1b","1b<n<10b","10b<n<100b","100b<n<1t","n>1t"];
for (const b of ALL_BUCKETS) {
  const it = { metadata: { kind: "dataset", size_category: b, license: "cc0-1.0", license_declared: "cc0-1.0", gated: false } };
  const small = ["n<1k","1k<n<10k","10k<n<100k"].includes(b);
  cell(`cheapRun(${b})`, () => m.cheapRunRefusal(it), (r) => (small ? r === null : r !== null));
}
// buckets HF has not invented yet, and the absent case
// "N<1K" is deliberately NOT here: the gate lowercases, so upper-case IS n<1k.
// That was my expectation being wrong, not the code. Asserted as an ALLOW below.
for (const b of ["n>1q", "1t<n<1q", "", null, undefined, " n<1k "]) {
  const it = { metadata: { kind: "dataset", size_category: b, license: "cc0-1.0", license_declared: "cc0-1.0", gated: false } };
  cell(`cheapRun(unknown ${JSON.stringify(b)}) refuses`, () => m.cheapRunRefusal(it), (r) => r !== null);
}

cell("cheapRun(N<1K) allows - the gate is case-insensitive by design",
  () => m.cheapRunRefusal({ metadata: { kind:"dataset", size_category: "N<1K", license: "cc0-1.0", gated: false } }),
  (r) => r === null);

console.log("D2  licence ambiguity");
cell("cheapRun(single permissive) allows",
  () => m.cheapRunRefusal({ metadata: { kind: "dataset", size_category: "n<1k", license: "cc0-1.0", license_declared: "cc0-1.0", gated: false } }),
  (r) => r === null);
cell("cheapRun(two licences) refuses",
  () => m.cheapRunRefusal({ metadata: { kind: "dataset", size_category: "n<1k", license: "apache-2.0", license_declared: ["cc-by-nc-4.0","apache-2.0"], gated: false } }),
  (r) => r !== null);
cell("cheapRun(gated) refuses",
  () => m.cheapRunRefusal({ metadata: { kind: "dataset", size_category: "n<1k", license: "cc0-1.0", license_declared: "cc0-1.0", gated: true } }),
  (r) => r !== null);
cell("cheapRun(no licence) refuses",
  () => m.cheapRunRefusal({ metadata: { kind: "dataset", size_category: "n<1k", gated: false } }),
  (r) => r !== null);

cell("cheapRun(kind=model) refuses",
  () => m.cheapRunRefusal({ metadata: { kind: "model", size_category: "n<1k", license: "mit", gated: false } }),
  (r) => r !== null);
cell("cheapRun(gated absent) refuses",
  () => m.cheapRunRefusal({ metadata: { kind: "dataset", size_category: "n<1k", license: "mit" } }),
  (r) => r !== null);
cell("cheapRun(no metadata at all) refuses",
  () => m.cheapRunRefusal({}), (r) => r !== null);
cell("cheapRun(null item) refuses",
  () => m.cheapRunRefusal(null), (r) => r !== null);
cell("isCheapRun agrees with cheapRunRefusal on all 11 buckets", () => {
  const bad = [];
  for (const b of ALL_BUCKETS) {
    const it = { metadata: { kind:"dataset", size_category: b, license: "cc0-1.0", gated: false } };
    if (m.isCheapRun(it) !== (m.cheapRunRefusal(it) === null)) bad.push(b);
  }
  return bad;
}, (r) => r.length === 0);

console.log("D3  matchSlots fails closed on every unknown");
cell("no licence tag -> no match", () => m.matchSlots({ id:"x", tags: tagsMinus("license:") }, "dataset"), (r) => r.length === 0);
cell("no language tag -> no match on a language slot",
  () => m.matchSlots({ id:"x", tags: tagsMinus("language:") }, "dataset").filter(h=>h.slot==="voice-wer"), (r) => r.length === 0);
cell("kind mismatch -> no match", () => m.matchSlots(T(), "model"), (r) => r.length === 0);
cell("gap slot (no tasks, no licences) matches nothing",
  () => m.matchSlots({ id:"x", tags: ["license:mit","size_categories:n<1k"] }, "dataset").filter(h=>h.slot==="skill-evals"), (r) => r.length === 0);
cell("empty tags -> no match", () => m.matchSlots({ id:"x", tags: [] }, "dataset"), (r) => r.length === 0);
cell("no tags key at all -> no match", () => m.matchSlots({ id:"x" }, "dataset"), (r) => r.length === 0);
cell("null raw -> ERROR or empty, never a match", () => { try { return m.matchSlots({}, "dataset"); } catch(e){ return "threw"; } }, (r) => r === "threw" || r.length === 0);

console.log("D4  slotMissReason reports the DEEPEST gate, independent of slot ORDER");
// a Hebrew ASR set with a licence nobody allows: clears task+language, dies on licence
const deep = { id:"x", tags: tagsWith("license:", "license:cc-by-nc-4.0") };
cell("deepest = licence-not-allowed", () => m.slotMissReason(deep, "dataset"), (r) => r === "licence-not-allowed");
cell("a match returns null (nothing to explain)", () => m.slotMissReason(T(), "dataset"), (r) => r === null);
cell("unrelated task -> task-not-graded",
  () => m.slotMissReason({ id:"x", tags:["task_categories:tabular-regression","license:mit","size_categories:n<1k"] }, "dataset"),
  (r) => r === "task-not-graded");
cell("oversize but otherwise perfect -> too-big-for-this-slot",
  () => m.slotMissReason({ id:"x", tags: tagsWith("size_categories:", "size_categories:10b<n<100b") }, "dataset"),
  (r) => r === "too-big-for-this-slot");

console.log("D5  cells the mutation control proved MISSING (M2/M3/M4 survived without them)");
// M4: a dataset with NO size_categories tag, perfect otherwise. HF datasets often
// omit it, so this is a real payload shape, not a constructed one.
cell("no size tag but otherwise perfect -> no match",
  () => m.matchSlots({ id:"x", tags: tagsMinus("size_categories:") }, "dataset"), (r) => r.length === 0);
cell("unknown size bucket but otherwise perfect -> no match",
  () => m.matchSlots({ id:"x", tags: tagsWith("size_categories:", "size_categories:n>1q") }, "dataset"), (r) => r.length === 0);
// M3: the guard is redundant for the VERDICT and load-bearing for the NAME.
// "undeclared" and "declared and wrong" are different findings in the corpus.
cell("missing licence is reported as licence-unknown, not licence-not-allowed",
  () => m.slotMissReason({ id:"x", tags: tagsMinus("license:") }, "dataset"), (r) => r === "licence-unknown");
// M2: same shape one gate earlier. The real gap slot, read through the real gate.
const gapSlot = slots.find((s) => s.id === "skill-evals");
// 2026-09-03: the live skill-evals slot is now kind `skill-eval`, which no feed
// can fill, so its verdict is the shallowest gate (`wrong-source`) by design.
cell("a skill-eval slot refuses every feed as wrong-source",
  () => slotGate.slotVerdict(gapSlot, slotGate.slotFactsFromHf(T(), "dataset")), (r) => r === "wrong-source");
cell("a ground-truth slot declaring no tasks says so by name",
  () => slotGate.slotVerdict({ ...gapSlot, kind: "dataset" }, slotGate.slotFactsFromHf(T(), "dataset")), (r) => r === "slot-declares-no-tasks");

console.log("D4b VOCABULARY COMPLETENESS - every gate _slotVerdict can emit is rankable");
const src = require("fs").readFileSync(path.join(HUB,"modules/slot-gate.js"),"utf8");
const body = src.slice(src.indexOf("function hfSlotVerdict("), src.indexOf("function matchSlots("));
const emitted = [...body.matchAll(/return "([a-z-]+)"/g)].map(x=>x[1]);
const depth = JSON.parse("[" + src.slice(src.indexOf("const SLOT_MISS_DEPTH"), src.indexOf("];", src.indexOf("const SLOT_MISS_DEPTH"))).split("[")[1].replace(/\s+/g," ").replace(/,\s*$/,"") + "]");
console.log(`  gates emitted by _slotVerdict: ${emitted.length} -> ${emitted.join(", ")}`);
console.log(`  ranked in SLOT_MISS_DEPTH   : ${depth.length}`);
const missing = emitted.filter((g) => !depth.includes(g));
cell("every emitted gate is in SLOT_MISS_DEPTH", () => missing, (r) => r.length === 0);

console.log("");
console.log(`C1 result: ${pass} pass / ${fail} fail / ${err} error`);
if (FAILS.length) { console.log("FAILING CELLS:"); FAILS.forEach(f=>console.log("  - "+f)); }
