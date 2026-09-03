/**
 * REPRODUCER - lane C, C2 (semantic correctness / valid-but-wrong).
 *
 * The slot gate proves a dataset has the right SHAPE (task category, language,
 * licence, size) and then asserts it has the right SUBJECT. HuggingFace's
 * `task_categories` is a shape signal only: `image-to-text` covers OCR, captioning
 * and VQA as well as screenshot->code, and `text-generation` covers nearly
 * everything. So the page offers the operator answer keys that cannot grade the
 * instrument they are filed under, with the reason "grades apollo/design-fidelity" -
 * an assertion, not evidence.
 *
 * Uses the REAL config and REAL stored payloads. A fixture would pass while the
 * page kept showing book scans.
 */
const path = require("path");
const HUB = "/home/ytr_o/ai-intelligence-hub";
const HuggingFaceModule = require(path.join(HUB, "modules/huggingface.js"));
const m = new HuggingFaceModule({ id:"huggingface", name:"HuggingFace", type:"huggingface",
  url:"https://huggingface.co/api/models", config:{} });

// Real payloads, in the shape the HF list API actually returns them.
const CASES = [
  { id:"ieasybooks-org/waqfeya-library",  what:"Arabic Islamic book scans (OCR)",
    tags:["task_categories:image-to-text","license:mit","size_categories:10k<n<100k"], expect_slot:"design-fidelity" },
  { id:"RevolutionCrossroads/loc_chronicling_america_1770-1810", what:"1770-1810 newspaper page scans (OCR)",
    tags:["task_categories:image-to-text","license:cc0-1.0","size_categories:10k<n<100k"], expect_slot:"design-fidelity" },
  { id:"openai/gsm8k", what:"grade-school maths word problems",
    tags:["task_categories:text-generation","license:mit","size_categories:1k<n<10k"], expect_slot:"tool-calling" },
  { id:"google/IFEval", what:"instruction-following eval, no function calling",
    tags:["task_categories:text-generation","license:apache-2.0","size_categories:n<1k"], expect_slot:"tool-calling" },
  { id:"truthfulqa/truthful_qa", what:"multiple-choice truthfulness",
    tags:["task_categories:text-generation","license:apache-2.0","size_categories:n<1k"], expect_slot:"tool-calling" },
];
// POSITIVE CONTROLS: the three answer keys that DO work must keep matching, or the
// fix has thrown away the instrument along with the noise.
const CONTROLS = [
  // Every slot whose real reference is known. A subject vocabulary is a
  // vocabulary: it is proven complete only by testing the cases where the
  // correct answer requires it to FIRE. `halluc` vs `HaluEval` (one l) was
  // caught here and nowhere else.
  { id:"SALT-NLP/Design2Code", what:"485 screenshot->HTML pairs",
    tags:["task_categories:image-to-text","license:odc-by","size_categories:n<1k"], want_slot:"design-fidelity" },
  { id:"SALT-NLP/Design2Code", what:"same, for the analyzer slot",
    tags:["task_categories:image-to-text","license:odc-by","size_categories:n<1k"], want_slot:"design-analysis-accuracy" },
  { id:"SALT-NLP/Design2Code", what:"same, for the hermes slot",
    tags:["task_categories:image-to-text","license:odc-by","size_categories:n<1k"], want_slot:"landing-critique" },
  { id:"gorilla-llm/Berkeley-Function-Calling-Leaderboard", what:"function-calling answer key",
    tags:["task_categories:text-generation","license:apache-2.0","size_categories:1k<n<10k"], want_slot:"tool-calling" },
  { id:"NousResearch/hermes-function-calling-v1", what:"second tool-calling set (n=400 arm)",
    tags:["task_categories:text-generation","license:apache-2.0","size_categories:1k<n<10k"], want_slot:"tool-calling" },
  { id:"glaiveai/glaive-function-calling-v2", what:"third tool-calling set",
    tags:["task_categories:text-generation","license:apache-2.0","size_categories:10k<n<100k"], want_slot:"tool-surface-cliff" },
  { id:"pminervini/HaluEval", what:"hallucination answer key - spelled with ONE l",
    tags:["task_categories:text-classification","license:apache-2.0","size_categories:10k<n<100k"], want_slot:"groundedness" },
  { id:"bltlab/open-ner-standardized", what:"NEMO Hebrew NER gold",
    tags:["task_categories:token-classification","language:he","license:cc-by-4.0","size_categories:1k<n<10k"], want_slot:"contact-name-ner" },
  { id:"fsicoli/common_voice_22_0", what:"Hebrew ASR clips",
    tags:["task_categories:automatic-speech-recognition","language:he","license:cc0-1.0","size_categories:10k<n<100k"], want_slot:"voice-wer" },
  { id:"gretelai/synthetic_text_to_sql", what:"text-to-SQL set (parked, must still match)",
    tags:["task_categories:text2text-generation","license:apache-2.0","size_categories:10k<n<100k"], want_slot:"text-to-sql" },
];
const MODEL_CONTROLS = [
  { id:"dicta-il/neodictabert-bilingual-embed", what:"Hebrew embedding model",
    tags:["pipeline_tag:sentence-similarity","language:he","license:cc-by-4.0","size_categories:n<1k"],
    pipeline_tag:"sentence-similarity", want_slot:"tier-retrieval" },
  { id:"Alibaba-NLP/gte-multilingual-reranker-base", what:"reranker",
    tags:["pipeline_tag:sentence-similarity","language:he","license:apache-2.0","size_categories:n<1k"],
    pipeline_tag:"sentence-similarity", want_slot:"tier-retrieval" },
];

console.log(`population: ${CASES.length} known-wrong payloads + ${CONTROLS.length} known-right controls, real slot config (${(m.loadProjects().projects||[]).flatMap(p=>p.slots||[]).length} slots)`);
let bad = 0, lost = 0;
console.log("\nMUST NOT MATCH (the defect):");
for (const c of CASES) {
  const hits = m.matchSlots(c, "dataset").map((h) => h.slot);
  const hit = hits.includes(c.expect_slot);
  if (hit) bad++;
  console.log(`  ${hit ? "REPRODUCED" : "ok        "}  ${c.id.padEnd(52)} ${c.what}`);
  if (hit) console.log(`              -> filed under: ${hits.join(", ")}`);
}
console.log("\nMUST STILL MATCH (positive controls - a fix that loses these is worse):");
for (const c of CONTROLS) {
  const hits = m.matchSlots(c, "dataset").map((h) => h.slot);
  const ok = hits.includes(c.want_slot);
  if (!ok) lost++;
  console.log(`  ${ok ? "kept      " : "LOST      "}  ${c.id.padEnd(52)} ${c.what} -> ${hits.join(", ") || "nothing"}`);
}
for (const c of MODEL_CONTROLS) {
  const hits = m.matchSlots(c, "model").map((h) => h.slot);
  const ok = hits.includes(c.want_slot);
  if (!ok) lost++;
  console.log(`  ${ok ? "kept      " : "LOST      "}  ${c.id.padEnd(52)} ${c.what} -> ${hits.join(", ") || "nothing"}`);
}
console.log(`\nverdict: ${bad} of ${CASES.length} wrong payloads matched · ${lost} of ${CONTROLS.length + MODEL_CONTROLS.length} real answer keys lost`);
process.exit(bad === 0 && lost === 0 ? 0 : 1);
