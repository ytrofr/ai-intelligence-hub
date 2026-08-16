const test = require("node:test");
const assert = require("node:assert/strict");
const RSSModule = require("../modules/rss");

test("toIso normalizes Atom/RFC dates and tolerates garbage", () => {
  const m = new RSSModule({ id: "x", name: "x", type: "rss", url: "http://x", config: {} });
  assert.equal(m.toIso("2026-02-18T10:00:00+02:00"), "2026-02-18T08:00:00.000Z");
  assert.equal(m.toIso("Tue, 18 Feb 2026 10:00:00 GMT"), "2026-02-18T10:00:00.000Z");
  assert.equal(m.toIso("not a date"), null);
  assert.equal(m.toIso(undefined), null);
});
