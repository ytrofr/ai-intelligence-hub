/**
 * Digest Route — POST /api/digest/run, GET /api/digest/:date
 *
 * Run flow: optionally fire perplexity-weekly + github-watchlist channels
 * (their items upsert via existing pipeline), then call weekly-digest to
 * read items first seen in last 7 days and write the markdown file.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const db = require('../database/db');
const { createModule } = require('../modules');
const { generateDigest, buildDigestStructure } = require('../modules/weekly-digest');

const DIGESTS_DIR = path.join(__dirname, '..', 'digests');

router.post('/run', async (req, res) => {
  const startMs = Date.now();
  const channelStats = {};
  const requestedChannels =
    Array.isArray(req.body?.channels) && req.body.channels.length > 0
      ? req.body.channels
      : ['github-watchlist', 'perplexity-weekly'];

  // Allow client to skip the weekly fetch and just regenerate from already-stored items
  const skipFetch = req.body?.skip_fetch === true;

  // Run channels (each is best-effort — one failing does not abort the digest)
  if (!skipFetch) {
    const sources = db.getEnabledSources();
    for (const channel of requestedChannels) {
      const source = sources.find((s) => s.id === channel);
      if (!source) {
        channelStats[channel] = 'skipped (not in sources)';
        continue;
      }
      const mod = createModule(source);
      if (!mod) {
        channelStats[channel] = 'skipped (no module)';
        continue;
      }
      try {
        const items = await mod.fetch();
        const count = db.upsertItems(items);
        db.updateSourceLastFetched(source.id);
        channelStats[channel] = count;
      } catch (err) {
        console.error(`  [digest] channel ${channel} failed: ${err.message}`);
        channelStats[channel] = `error: ${err.message.slice(0, 100)}`;
      }
    }
  } else {
    channelStats.fetch = 'skipped';
  }

  try {
    const result = await generateDigest({
      channelStats,
      runtimeStartMs: startMs,
    });
    res.json({
      digest_path: result.digestPath,
      item_count: result.itemCount,
      runtime_ms: result.runtimeMs,
      channels: channelStats,
    });
  } catch (err) {
    console.error('[digest] generation failed:', err);
    res.status(500).json({ error: err.message, channels: channelStats });
  }
});

// Structured JSON view of the digest. MUST be registered before `/:date`
// so Express does not capture the `.json` suffix into the date param.
// Returns {buckets, rising, runDate, totals} ready for SPA rendering.
router.get('/:date.json', (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
  }
  const file = path.join(DIGESTS_DIR, `weekly-${date}.md`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `No digest for ${date}` });
  }
  try {
    const windowStart = new Date(date + 'T00:00:00Z');
    windowStart.setUTCDate(windowStart.getUTCDate() - 7);
    const sinceIso = windowStart.toISOString();
    const items = db.getItemsFirstSeenSince(sinceIso, { limit: 80 });
    const structure = buildDigestStructure({ items, runDate: date });
    res.json(structure);
  } catch (err) {
    console.error('[digest] JSON build failed:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:date', (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
  }
  const file = path.join(DIGESTS_DIR, `weekly-${date}.md`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: `No digest for ${date}` });
  }
  res.type('text/markdown').send(fs.readFileSync(file, 'utf-8'));
});

router.get('/', (req, res) => {
  if (!fs.existsSync(DIGESTS_DIR)) return res.json({ digests: [] });
  const files = fs
    .readdirSync(DIGESTS_DIR)
    .filter((f) => /^weekly-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .sort()
    .reverse();
  res.json({ digests: files });
});

module.exports = router;
