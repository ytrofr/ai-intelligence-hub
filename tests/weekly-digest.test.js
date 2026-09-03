/**
 * Tests for weekly-digest module
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Load fixtures
const FIXTURE_DIR = path.join(__dirname, 'perplexity-fixtures');

// Use a fresh require for the perplexity module so we can call parseResponse without
// hitting the network. We instantiate it with minimal config.
const PerplexityWeeklyModule = require('../modules/perplexity-discovery');
const perplexity = new PerplexityWeeklyModule({
  id: 'test',
  name: 'test',
  type: 'perplexity-weekly',
  url: '',
  config: { project_id: 'claude-ecosystem' },
});

const { formatDigest, classify, isRisingStar } = require('../modules/weekly-digest');

// ── parsePerplexityResponse fixtures ──────────────────────────────────────
test('parseResponse: well-formed JSON array', () => {
  const fixture = fs.readFileSync(path.join(FIXTURE_DIR, 'well-formed.json'), 'utf-8');
  const items = perplexity.parseResponse(fixture);
  assert.equal(items.length, 3);
  assert.equal(items[0].repo, 'anthropics/claude-code');
  assert.equal(items[0].stars, 12000);
  assert.equal(items[0].category, 'claude-code');
});

test('parseResponse: JSON wrapped in markdown fence', () => {
  const fixture = fs.readFileSync(path.join(FIXTURE_DIR, 'fenced.json'), 'utf-8');
  const items = perplexity.parseResponse(fixture);
  assert.equal(items.length, 2);
  assert.equal(items[0].repo, 'modelcontextprotocol/servers');
});

test('parseResponse: malformed JSON returns empty array', () => {
  const fixture = fs.readFileSync(path.join(FIXTURE_DIR, 'malformed.json'), 'utf-8');
  const items = perplexity.parseResponse(fixture);
  assert.deepEqual(items, []);
});

test('parseResponse: empty string returns empty array', () => {
  assert.deepEqual(perplexity.parseResponse(''), []);
  assert.deepEqual(perplexity.parseResponse(null), []);
  assert.deepEqual(perplexity.parseResponse(undefined), []);
});

// ── classify ───────────────────────────────────────────────────────────────
test('classify: claude-code topic routes to claude-code category', () => {
  const item = {
    title: 'foo/bar',
    description: 'A Claude Code skill',
    metadata: JSON.stringify({ topics: ['claude-code'] }),
  };
  assert.equal(classify(item).id, 'claude-code');
});

test('classify: mcp topic routes to mcp category', () => {
  const item = {
    title: 'foo/bar',
    description: 'MCP server',
    metadata: JSON.stringify({ topics: ['mcp'] }),
  };
  assert.equal(classify(item).id, 'mcp');
});

test('classify: no matching topic falls through to other', () => {
  const item = { title: 'foo/bar', description: 'unrelated', metadata: JSON.stringify({ topics: ['unrelated'] }) };
  assert.equal(classify(item).id, 'other');
});

test('classify: category_hint from perplexity wins over topic match', () => {
  const item = {
    title: 'foo/bar',
    description: 'Has mcp topic',
    metadata: JSON.stringify({ topics: ['mcp'], category_hint: 'agent-fw' }),
  };
  assert.equal(classify(item).id, 'agent-fw');
});

// ── isRisingStar ───────────────────────────────────────────────────────────
test('isRisingStar: 300 stars + 30 days old → true', () => {
  const created = new Date(Date.now() - 30 * 86400000).toISOString();
  const item = { stars: 300, metadata: JSON.stringify({ created_at: created }) };
  assert.equal(isRisingStar(item), true);
});

test('isRisingStar: 6000 stars (above ceiling) → false', () => {
  const created = new Date(Date.now() - 30 * 86400000).toISOString();
  const item = { stars: 6000, metadata: JSON.stringify({ created_at: created }) };
  assert.equal(isRisingStar(item), false);
});

test('isRisingStar: 300 stars + 200 days old → false (too old)', () => {
  const created = new Date(Date.now() - 200 * 86400000).toISOString();
  const item = { stars: 300, metadata: JSON.stringify({ created_at: created }) };
  assert.equal(isRisingStar(item), false);
});

test('isRisingStar: no created_at → false', () => {
  const item = { stars: 300, metadata: JSON.stringify({}) };
  assert.equal(isRisingStar(item), false);
});

// ── formatDigest golden ────────────────────────────────────────────────────
test('formatDigest: produces expected sections + TL;DR', () => {
  const items = [
    {
      title: 'anthropics/claude-code',
      url: 'https://github.com/anthropics/claude-code',
      stars: 12000,
      description: 'Official Claude Code',
      metadata: JSON.stringify({
        topics: ['claude-code'],
        match_reason: 'Specific topic',
        language: 'TypeScript',
        created_at: '2025-01-01T00:00:00Z',
      }),
    },
    {
      title: 'newproject/agent-fw',
      url: 'https://example.com/x',
      stars: 350,
      description: 'A new agent framework',
      metadata: JSON.stringify({
        topics: ['agent-framework'],
        match_reason: 'Watchlist + rising',
        language: 'Python',
        created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      }),
    },
  ];
  const md = formatDigest({
    items,
    runDate: '2026-05-08',
    channelStats: { topic: 5, watchlist: 12, perplexity: 3 },
  });
  assert.match(md, /# Weekly Claude Code Ecosystem Digest — 2026-05-08/);
  assert.match(md, /## TL;DR — Top 5/);
  assert.match(md, /## 🌟 Rising Stars/);
  assert.match(md, /## 🤖 Claude Code/);
  assert.match(md, /## 🧠 Agent Frameworks/);
  assert.match(md, /anthropics\/claude-code/);
  assert.match(md, /newproject\/agent-fw/);
  assert.match(md, /12,000★/);
  assert.match(md, /350★/);
  assert.match(md, /Channels run.*topic.*watchlist.*perplexity/);
});

test('formatDigest: empty items still produces valid markdown with empty TL;DR', () => {
  const md = formatDigest({ items: [], runDate: '2026-05-08' });
  assert.match(md, /# Weekly Claude Code Ecosystem Digest — 2026-05-08/);
  assert.match(md, /No items met the star floor this week/);
  assert.match(md, /No rising stars surfaced this week/);
});

// --- D5: the "Adopted & tracked" section -------------------------------------
const { formatTrackedSection } = require("../modules/weekly-digest");

test("a quiet week SAYS SO — the section is never omitted", () => {
  // An omitted section is an absence of a result; '0 alarms' is a result.
  const md = formatTrackedSection({ events: [], checked: 257 });
  assert.match(md, /Adopted & tracked/);
  assert.match(md, /Nothing changed upstream this week/);
  assert.match(md, /\*\*0 alarms\*\*/);
  assert.match(md, /257 repos/);
});

test("two releases and no alarms renders both and still states 0 alarms", () => {
  const md = formatTrackedSection({
    events: [
      { repo: "a/one", event: "release", severity: "NOTE", from: "v1.0.0", to: "v1.1.0" },
      { repo: "b/two", event: "release", severity: "NOTE", from: "v2.0.0", to: "v2.0.1" },
    ],
    checked: 257,
    projectsByRepo: { "a/one": ["apollo"] },
  });
  assert.match(md, /\*\*0 alarms\*\*/);
  assert.match(md, /2 releases/);
  assert.match(md, /a\/one` v1\.0\.0 → \*\*v1\.1\.0\*\* — apollo/);
  assert.match(md, /b\/two/);
  assert.doesNotMatch(md, /Needs a look/, "no alarm heading when there are none");
});

test("alarms lead, and a rename says where it went", () => {
  const md = formatTrackedSection({
    events: [
      { repo: "facebook/react", event: "renamed", severity: "ALARM", to: "react/react" },
      { repo: "x/y", event: "archived", severity: "ALARM", to: "true" },
    ],
    checked: 257,
    projectsByRepo: { "facebook/react": ["apollo", "hermes"] },
  });
  assert.match(md, /\*\*2 alarms\*\*/);
  assert.match(md, /### ⛔ Needs a look/);
  assert.match(md, /\*\*RENAMED\*\* `facebook\/react` → `react\/react` — apollo, hermes/);
  assert.match(md, /\*\*ARCHIVED\*\* `x\/y`/);
  assert.doesNotMatch(md, /ARCHIVED `x\/y` → /, "'archived → true' reads as nonsense");
  assert.ok(md.indexOf("Needs a look") < md.indexOf("Gone quiet") || !md.includes("Gone quiet"));
});

test("the quiet-repo list is counted in its heading so it can be skipped", () => {
  const events = Array.from({ length: 26 }, (_, i) => ({ repo: `q/${i}`, event: "stale", severity: "WARN" }));
  const md = formatTrackedSection({ events, checked: 257 });
  assert.match(md, /Gone quiet \(no push in 180 days\) — 26/);
  assert.match(md, /26 gone quiet/);
});

// /deep-test C8 (2026-09-03): a HuggingFace title is written by anyone with an
// account and we ingest it verbatim into a MARKDOWN file the operator clicks.
const { formatGroundTruthSection: gtSection } = require("../modules/weekly-digest");

test("a title containing ]( cannot open its own link in the digest", () => {
  const hostile = 'evil](https://attacker.example "x")[';
  const md = gtSection(
    [{ id: "x", title: hostile, url: "https://huggingface.co/datasets/x",
       metadata: { matched_slots: [{ project: "p", slot: "s" }], kind: "dataset",
                   size_category: "n<1k", license: "mit", gated: false } }],
    [{ id: "p", name: "P", slots: [{ id: "s", instrument: "i.py", kind: "dataset", ran: [] }] }],
    []
  );
  const line = md.split("\n").find((l) => l.includes("huggingface.co/datasets/x")) || "";
  // Only an UNESCAPED ]( ends the link text; counting all of them would read a
  // correctly-escaped title as an escape.
  const unescaped = (line.match(/(^|[^\\])\]\(/g) || []).length;
  assert.equal(unescaped, 1, `title escaped its link: ${line}`);
  assert.ok(line.includes("attacker.example"), "the title text itself must survive, just inertly");
});

test("CONTROL: an ordinary bracketed title is unchanged to a reader", () => {
  // 11 of 9,335 live titles carry a bare bracket ([pdf], [2026]). Escaping them
  // renders identically; a fix that mangled them would be worse than the hole.
  const md = gtSection(
    [{ id: "y", title: "Soft Rains [pdf]", url: "https://huggingface.co/datasets/y",
       metadata: { matched_slots: [{ project: "p", slot: "s" }], kind: "dataset",
                   size_category: "n<1k", license: "mit", gated: false } }],
    [{ id: "p", name: "P", slots: [{ id: "s", instrument: "i.py", kind: "dataset", ran: [] }] }],
    []
  );
  const line = md.split("\n").find((l) => l.includes("huggingface.co/datasets/y")) || "";
  assert.match(line, /Soft Rains \\\[pdf\\\]/);
  assert.equal((line.match(/(^|[^\\])\]\(/g) || []).length, 1);
});
