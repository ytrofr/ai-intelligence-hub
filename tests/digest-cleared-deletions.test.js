const test = require("node:test");
const assert = require("node:assert/strict");
const { dropClearedDeletions, formatTrackedSection } = require("../modules/weekly-digest");

const del = (repo) => ({ repo, event: "deleted", from_value: "", to_value: "404", severity: "ALARM", detected_at: "2026-09-03T07:02:50Z" });

test("a deleted ALARM on a repo the latest probe found alive (200) is downgraded to a NOTE", () => {
  const out = dropClearedDeletions([del("dicta-il/neodictabert-bilingual-embed")], [{ repo: "dicta-il/neodictabert-bilingual-embed", http_status: 200 }]);
  assert.equal(out[0].severity, "NOTE");
  assert.equal(out[0].event, "cleared");
});

test("CONTROL: a deleted ALARM stays an ALARM when the repo is still 404, or only 429 (a rate limit is not proof of life)", () => {
  const rows = [{ repo: "gone/gone", http_status: 404 }, { repo: "lazy-frames/lazyframes", http_status: 429 }];
  const out = dropClearedDeletions([del("gone/gone"), del("lazy-frames/lazyframes")], rows);
  assert.deepEqual(out.map((e) => e.severity), ["ALARM", "ALARM"]);
});

test("CONTROL: non-deleted events and events for untracked repos pass through untouched", () => {
  const ev = [{ repo: "a/b", event: "release", severity: "NOTE" }, del("x/y")];
  assert.deepEqual(dropClearedDeletions(ev, [{ repo: "a/b", http_status: 200 }]), ev);
});

test("the rendered section labels a cleared alarm as a false alarm, and no longer under Needs a look", () => {
  const events = dropClearedDeletions([del("dicta-il/neodictabert-bilingual-embed")], [{ repo: "dicta-il/neodictabert-bilingual-embed", http_status: 200 }]);
  const md = formatTrackedSection({ events, checked: 1, projectsByRepo: { "dicta-il/neodictabert-bilingual-embed": ["atlas"] } });
  assert.match(md, /cleared \(false alarm\)/);
  assert.doesNotMatch(md, /\*\*DELETED\*\*/);
});
