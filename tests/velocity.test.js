const test = require("node:test");
const assert = require("node:assert/strict");
const { computeVelocity, rankByVelocity, GAIN7_FLOOR } = require("../routes/lib/velocity");

/** A daily series ending `today`, `days` long, from `start` stars growing `perDay`. */
function series(today, days, start, perDay) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    day: new Date(end - (days - 1 - i) * 86400000).toISOString().slice(0, 10),
    stars: start + i * perDay,
  }));
}

test("snapshots: gain7 = today - 7 days ago; velocity = gain7 / sqrt(max(50, base))", () => {
  const v = computeVelocity(series("2026-10-13", 8, 1000, 100), { today: "2026-10-13" });
  assert.equal(v.origin, "snapshots");
  assert.equal(v.gain7, 700);
  assert.equal(v.gain1, 100);
  assert.equal(v.stars_7d_ago, 1000);
  assert.equal(v.base_day, "2026-10-06");
  assert.ok(Math.abs(v.velocity - 700 / Math.sqrt(1000)) < 1e-9);
  assert.equal(v.eligible, true);
});

// /deep-test 2026-10-06: the base floor survived a mutation to 1 - every case above starts at
// 1,000+ stars, so the floor never bound. A brand-new repo can sit at 0 a week ago, and
// sqrt(0) would make its velocity Infinity. Literal numbers on purpose: a case derived
// from the floor's own constant would move with any mutation of it.
test("base floor: a repo at 0 or 10 stars a week ago divides by sqrt(50), never by its own base", () => {
  const zero = computeVelocity([{ day: "2026-10-06", stars: 0 }, { day: "2026-10-13", stars: 400 }], { today: "2026-10-13" });
  assert.equal(zero.stars_7d_ago, 0);
  assert.ok(Number.isFinite(zero.velocity));
  assert.ok(Math.abs(zero.velocity - 400 / Math.sqrt(50)) < 1e-9);
  const ten = computeVelocity([{ day: "2026-10-06", stars: 10 }, { day: "2026-10-13", stars: 410 }], { today: "2026-10-13" });
  assert.ok(Math.abs(ten.velocity - 400 / Math.sqrt(50)) < 1e-9);
});

test("NEGATIVE CONTROL: a 200k repo gaining 300/wk ranks BELOW a 2k repo gaining 1,500/wk", () => {
  const giant = { repo: "giant/old", v: computeVelocity([{ day: "2026-10-06", stars: 200000 }, { day: "2026-10-13", stars: 200300 }], { today: "2026-10-13" }) };
  const surge = { repo: "small/new", v: computeVelocity([{ day: "2026-10-06", stars: 2000 }, { day: "2026-10-13", stars: 3500 }], { today: "2026-10-13" }) };
  assert.ok(surge.v.velocity > giant.v.velocity, `${surge.v.velocity} vs ${giant.v.velocity}`);
  assert.deepEqual(rankByVelocity([giant, surge]).map((r) => r.repo), ["small/new", "giant/old"]);
  // and a giant gaining MORE in absolute terms still loses to the relative surge
  const bigGain = { repo: "giant/busy", v: computeVelocity([{ day: "2026-10-06", stars: 195000 }, { day: "2026-10-13", stars: 200000 }], { today: "2026-10-13" }) };
  assert.equal(rankByVelocity([bigGain, surge])[0].repo, "small/new");
});

test("floor: gain7 under 150 is computed but not eligible for ranking", () => {
  const v = computeVelocity([{ day: "2026-10-06", stars: 60 }, { day: "2026-10-13", stars: 60 + GAIN7_FLOOR - 1 }], { today: "2026-10-13" });
  assert.equal(v.gain7, 149);
  assert.ok(v.velocity > 0);
  assert.equal(v.eligible, false);
  assert.deepEqual(rankByVelocity([{ v }]), []);
  const at = computeVelocity([{ day: "2026-10-06", stars: 60 }, { day: "2026-10-13", stars: 60 + GAIN7_FLOOR }], { today: "2026-10-13" });
  assert.equal(at.eligible, true);
});

test("base window tolerates a missed daily run (8 or 9 days back), not 10", () => {
  const nine = computeVelocity([{ day: "2026-10-04", stars: 100 }, { day: "2026-10-13", stars: 500 }], { today: "2026-10-13" });
  assert.equal(nine.origin, "snapshots");
  assert.equal(nine.gain7, 400);
  const ten = computeVelocity([{ day: "2026-10-03", stars: 100 }, { day: "2026-10-13", stars: 500 }], { today: "2026-10-13" });
  assert.equal(ten.origin, "insufficient_history");
});

test("insufficient_history is a STATE: gain7 and velocity are null, never 0", () => {
  const v = computeVelocity(series("2026-10-13", 3, 500, 400), { today: "2026-10-13" });
  assert.equal(v.origin, "insufficient_history");
  assert.equal(v.gain7, null);
  assert.equal(v.velocity, null);
  assert.equal(v.eligible, false);
  assert.equal(v.gain1, 400, "a 1-day gain is still known");
  const empty = computeVelocity([], {});
  assert.equal(empty.origin, "insufficient_history");
  assert.equal(empty.stars, null);
});

test("trending-page fallback: the page's weekly gain stands in while history is short", () => {
  const v = computeVelocity([{ day: "2026-10-06", stars: 5358 }], { today: "2026-10-06", trending: { weekly: 3776, daily: 900 } });
  assert.equal(v.origin, "trending-page");
  assert.equal(v.gain7, 3776);
  assert.equal(v.gain1, 900);
  assert.equal(v.stars_7d_ago, 5358 - 3776);
  assert.ok(Math.abs(v.velocity - 3776 / Math.sqrt(1582)) < 1e-9);
  assert.equal(v.eligible, true);
});

test("trending-page fallback without any total-star reading: gain7 known, velocity null", () => {
  const v = computeVelocity([], { trending: { weekly: 900 } });
  assert.equal(v.origin, "trending-page");
  assert.equal(v.gain7, 900);
  assert.equal(v.velocity, null);
  assert.equal(v.eligible, false);
});

test("snapshot history outranks the trending page once it exists", () => {
  const v = computeVelocity([{ day: "2026-10-06", stars: 1000 }, { day: "2026-10-13", stars: 1400 }], { today: "2026-10-13", trending: { weekly: 9999 } });
  assert.equal(v.origin, "snapshots");
  assert.equal(v.gain7, 400);
});

test("readings after `today` are ignored; series order does not matter", () => {
  const rows = [{ day: "2026-10-20", stars: 99999 }, { day: "2026-10-13", stars: 1700 }, { day: "2026-10-06", stars: 1000 }];
  const v = computeVelocity(rows, { today: "2026-10-13" });
  assert.equal(v.gain7, 700);
  assert.equal(v.stars, 1700);
});

test("tie on velocity breaks on gain7", () => {
  const a = { repo: "a", v: { eligible: true, velocity: 5, gain7: 200 } };
  const b = { repo: "b", v: { eligible: true, velocity: 5, gain7: 900 } };
  assert.deepEqual(rankByVelocity([a, b]).map((r) => r.repo), ["b", "a"]);
});
