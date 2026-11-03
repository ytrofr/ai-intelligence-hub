/**
 * The digest window starts where the last delivered digest ended - never "7 days back
 * from now". Two real losses this guards (audit 2026-11-03):
 *  - harness2 was first seen 2026-10-19 07:16Z; the 10-19 digest ran at 06:53Z and the
 *    10-26 one looked back only to 10-19 07:54Z, so it fell between them.
 *  - the 11-02 digest failed; a now-7d window on 11-09 would never cover 10-26..11-02.
 *
 * Run: node --test tests/digest-window.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { digestWindow, capList } = require('../modules/digest-window');

const iso = (s) => new Date(s).toISOString();

test('starts at the previous window end when the run recorded one', () => {
  const w = digestWindow({
    prev: { run_date: '2026-10-26', window_until: '2026-10-26T07:51:00.000Z' },
    now: new Date('2026-11-09T07:00:00Z'),
  });
  assert.equal(w.since, iso('2026-10-26T07:51:00Z'));
  assert.equal(w.until, iso('2026-11-09T07:00:00Z'));
  assert.equal(w.basis, 'previous-window-end');
});

test('legacy row without a window starts at that run START (created_at minus runtime)', () => {
  // weekly_runs.created_at is SQLite CURRENT_TIMESTAMP: UTC, space, no zone.
  const w = digestWindow({
    prev: { run_date: '2026-10-19', created_at: '2026-10-19 06:53:12', runtime_ms: 183627 },
    now: new Date('2026-10-26T07:54:12Z'),
  });
  assert.equal(w.since, iso('2026-10-19T06:50:08.373Z'));
  assert.equal(w.basis, 'previous-run-start');
});

test('REPLAY 2026-10-19: harness2 (first seen 07:16Z) falls inside the next window', () => {
  const harness2 = '2026-10-19T07:16:48.475Z';
  const now = new Date('2026-10-26T07:54:12Z');
  const oldSince = new Date(now.getTime() - 7 * 86400000).toISOString();
  assert.ok(harness2 < oldSince, 'the old now-7d window really did miss it');
  const w = digestWindow({
    prev: { run_date: '2026-10-19', created_at: '2026-10-19 06:53:12', runtime_ms: 183627 },
    now,
  });
  assert.ok(harness2 >= w.since && harness2 < w.until, `harness2 must be in [${w.since}, ${w.until})`);
});

test('REPLAY 2026-11-02: a failed week is covered by the next run', () => {
  const w = digestWindow({
    prev: { run_date: '2026-10-26', created_at: '2026-10-26 07:54:12', runtime_ms: 188409 },
    now: new Date('2026-11-09T07:00:00Z'),
  });
  // the 10-26 run started at 07:54:12 minus 188.409 s
  assert.equal(w.since, iso('2026-10-26T07:51:03.591Z'));
  assert.ok(w.days > 13 && w.days < 15, `window spans both weeks, got ${w.days}`);
});

test('no previous digest falls back to 7 days', () => {
  const w = digestWindow({ prev: null, now: new Date('2026-11-09T07:00:00Z') });
  assert.equal(w.since, iso('2026-11-02T07:00:00Z'));
  assert.equal(w.basis, 'no-previous-digest');
});

test('a very old previous digest is clamped and says so', () => {
  const w = digestWindow({
    prev: { run_date: '2026-06-01', window_until: '2026-06-01T07:00:00.000Z' },
    now: new Date('2026-11-09T07:00:00Z'),
    maxDays: 35,
  });
  assert.equal(w.since, iso('2026-10-05T07:00:00Z'));
  assert.equal(w.clamped, true);
});

test('an unparseable previous row never yields an empty window', () => {
  const w = digestWindow({
    prev: { run_date: '2026-10-26', created_at: 'garbage', runtime_ms: null },
    now: new Date('2026-11-09T07:00:00Z'),
  });
  assert.equal(w.basis, 'no-previous-digest');
  assert.ok(w.since < w.until);
});

test('capList shows the cap and counts the rest, never drops silently', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const { shown, more } = capList(list, 12);
  assert.equal(shown.length, 12);
  assert.equal(more, 18);
  assert.deepEqual(capList([1, 2], 12), { shown: [1, 2], more: 0 });
});
