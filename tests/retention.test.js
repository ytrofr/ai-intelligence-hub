const test = require("node:test");
const assert = require("node:assert/strict");
const { planRetention } = require("../modules/retention");

test("planRetention maps configured retention_days per source, skips null/never", () => {
  const sources = [
    { id: "arxiv-ai", config: { retention_days: 14 } },
    { id: "github", config: {} },
    { id: "hackernews", config: { retention_days: 30 } },
    { id: "weird", config: { retention_days: "abc" } },
  ];
  assert.deepEqual(planRetention(sources), [{ source: "arxiv-ai", days: 14 }, { source: "hackernews", days: 30 }]);
});
