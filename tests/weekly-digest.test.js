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
