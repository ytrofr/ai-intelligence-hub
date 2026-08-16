/**
 * Tests for buildDigestStructure — the structured object exposed via
 * GET /api/digest/:date.json and consumed by the SPA digest view.
 *
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDigestStructure,
  classify,
  isRisingStar,
} = require('../modules/weekly-digest');

// ── helpers ───────────────────────────────────────────────────────────────
function mkItem(overrides) {
  return {
    title: overrides.title || 'org/repo',
    url: overrides.url || 'https://github.com/org/repo',
    description: overrides.description || '',
    stars: overrides.stars ?? 1500,
    score: overrides.score ?? 50,
    metadata: JSON.stringify({
      topics: overrides.topics || [],
      created_at: overrides.created_at || '2023-01-01',
      ...overrides.extraMeta,
    }),
  };
}

const RUN_DATE = '2026-05-08';

// ── 1. buildDigestStructure shape ─────────────────────────────────────────
test('buildDigestStructure: returns expected top-level shape', () => {
  const items = [mkItem({ topics: ['claude-code'] })];
  const result = buildDigestStructure({ items, runDate: RUN_DATE });

  assert.equal(result.runDate, RUN_DATE);
  assert.ok(result.buckets, 'buckets present');
  assert.ok(Array.isArray(result.rising), 'rising is array');
  assert.ok(result.totals, 'totals present');
  assert.equal(typeof result.totals.totalItems, 'number');
  assert.ok(result.totals.perCategory, 'perCategory present');
  assert.equal(typeof result.totals.risingCount, 'number');
});

// ── 2. classify routes items to the right bucket ──────────────────────────
test('buildDigestStructure: classify routes by topic', () => {
  const items = [
    mkItem({ title: 'a', topics: ['claude-code'] }),
    mkItem({ title: 'b', topics: ['mcp'] }),
    mkItem({ title: 'c', topics: ['adk'] }),
    mkItem({ title: 'd', topics: ['agent-framework'] }),
    mkItem({ title: 'e', topics: ['rag'] }),
    mkItem({ title: 'f', topics: ['something-uncategorized'] }),
  ];
  const { buckets } = buildDigestStructure({ items, runDate: RUN_DATE });

  // Each labeled bucket should contain at least 1 item routed to it.
  assert.ok(buckets['claude-code'].items.length >= 1, 'claude-code routed');
  assert.ok(buckets['mcp'].items.length >= 1, 'mcp routed');
  assert.ok(buckets['adk'].items.length >= 1, 'adk routed');
  assert.ok(buckets['agent-fw'].items.length >= 1, 'agent-fw routed');
  assert.ok(buckets['rag'].items.length >= 1, 'rag routed');
  assert.ok(buckets['other'].items.length >= 1, 'uncategorized lands in other');
});

// ── 3. isRisingStar filter ────────────────────────────────────────────────
test('buildDigestStructure: rising filter follows isRisingStar()', () => {
  const recent = new Date(Date.now() - 30 * 86400000).toISOString();   // 30d old
  const old = new Date(Date.now() - 200 * 86400000).toISOString();      // 200d old

  const items = [
    mkItem({ title: 'rising-eligible', stars: 500, created_at: recent }),
    mkItem({ title: 'too-old', stars: 500, created_at: old }),
    mkItem({ title: 'too-popular', stars: 6000, created_at: recent }),
    mkItem({ title: 'too-few-stars', stars: 100, created_at: recent }),
  ];

  const { rising } = buildDigestStructure({ items, runDate: RUN_DATE });
  const titles = rising.map((i) => i.title);

  assert.ok(titles.includes('rising-eligible'), 'rising-eligible included');
  assert.ok(!titles.includes('too-old'), 'too-old excluded (>90d)');
  assert.ok(!titles.includes('too-popular'), 'too-popular excluded (>=5000)');
  assert.ok(!titles.includes('too-few-stars'), 'too-few-stars excluded (<200)');

  // Cross-check: isRisingStar() agrees per-item
  for (const item of items) {
    const expected = isRisingStar(item);
    const actual = titles.includes(item.title);
    assert.equal(actual, expected, `isRisingStar agreement for ${item.title}`);
  }
});

// ── 4. totals sum correctly ───────────────────────────────────────────────
test('buildDigestStructure: totals.perCategory sums to totalItems', () => {
  const items = [
    mkItem({ title: 'a', topics: ['claude-code'] }),
    mkItem({ title: 'b', topics: ['claude-code'] }),
    mkItem({ title: 'c', topics: ['mcp'] }),
    mkItem({ title: 'd', topics: ['nothing-known'] }),
    mkItem({ title: 'e', topics: ['rag'] }),
  ];
  const { buckets, totals } = buildDigestStructure({ items, runDate: RUN_DATE });

  assert.equal(totals.totalItems, items.length);

  const sumPerCategory = Object.values(totals.perCategory).reduce(
    (acc, n) => acc + n,
    0
  );
  assert.equal(sumPerCategory, items.length, 'perCategory sums to total');

  // And bucket lengths match perCategory counts
  for (const [catId, count] of Object.entries(totals.perCategory)) {
    assert.equal(
      buckets[catId].items.length,
      count,
      `bucket ${catId} length matches count`
    );
  }
});
