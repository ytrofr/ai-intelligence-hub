const test = require("node:test");
const assert = require("node:assert/strict");
const { keywordScore, passesGate, applyIngestPolicy } = require("../modules/item-filter");

const KW = [
  { category: "ai", keyword: "llm", weight: 1.5 }, { category: "ai", keyword: "agent", weight: 1.5 }, { category: "ai", keyword: "ai", weight: 1.5 },
  { category: "claude", keyword: "claude", weight: 2.0 }, { category: "devtools", keyword: "framework", weight: 1.5 },
];

test("keywordScore uses word boundaries and counts distinct keywords", () => {
  assert.equal(keywordScore({ title: "How to maintain a garden" }, KW, ["ai"]).score, 0);
  assert.equal(keywordScore({ title: "AI agents everywhere: an LLM agent" }, KW, ["ai"]).score, 4.5);
  assert.equal(keywordScore({ title: "Claude Code agent framework" }, KW, ["claude", "devtools"]).score, 3.5);
});

test("passesGate: pure-theory arXiv title fails, agentic tooling passes at 3.0", () => {
  const opts = { categories: ["ai", "claude", "devtools"], threshold: 3.0 };
  assert.equal(passesGate({ title: "Category theory of monoidal preorders" }, KW, opts), false);
  assert.equal(passesGate({ title: "Agentic tool-use benchmark for LLM coding assistants" }, KW, opts), true);
});

test("applyIngestPolicy: gate drops, boost scores (never drops)", () => {
  const items = [{ title: "Tai Chi health benefits", score: 200 }, { title: "Patterns in multi-agent LLM systems", score: 200 }];
  const gated = applyIngestPolicy(items.map((i) => ({ ...i })), { keyword_gate: { categories: ["ai"], threshold: 3.0 } }, KW);
  assert.deepEqual(gated.map((i) => i.title), ["Patterns in multi-agent LLM systems"]);
  const boosted = applyIngestPolicy(items.map((i) => ({ ...i })), { keyword_boost: { categories: ["ai"], factor: 10 } }, KW);
  assert.equal(boosted.length, 2);
  assert.equal(boosted[0].score, 200);
  assert.equal(boosted[1].score, 230);
  assert.equal(boosted[1].metadata.keyword_score, 3);
});
