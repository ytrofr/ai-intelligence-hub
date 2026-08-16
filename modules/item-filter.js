/**
 * Item Filter - keyword gate / boost at ingest, driven by config/keywords.json
 * (already loaded into the `keywords` table). Word-boundary matching so "ai"
 * does not match "maintain".
 *
 *   keywordScore(item, keywords, categories) -> sum of weights of DISTINCT matched keywords
 *   passesGate(item, keywords, {categories, threshold})
 *   applyIngestPolicy(items, sourceConfig, keywords) -> filtered/boosted items
 *
 * sourceConfig: { keyword_gate: { categories: [...], threshold: 3.0 },
 *                 keyword_boost: { categories: [...], factor: 10 } }
 */

const _cache = new Map(); // keyword -> RegExp

function kwRegex(kw) {
  let re = _cache.get(kw);
  if (!re) {
    const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // word boundary + common inflections (agent -> agents/agentic, llm -> llms)
    re = new RegExp(`(^|[^a-z0-9])${esc}(s|es|ic|ics)?([^a-z0-9]|$)`, "i");
    _cache.set(kw, re);
  }
  return re;
}

function keywordScore(item, keywords, categories) {
  const hay = `${item.title || ""} ${item.description || ""}`;
  const cats = categories && categories.length ? new Set(categories) : null;
  let score = 0;
  const seen = new Set();
  for (const kw of keywords) {
    if (cats && !cats.has(kw.category)) continue;
    const key = kw.keyword.toLowerCase();
    if (seen.has(key)) continue;
    if (kwRegex(kw.keyword).test(hay)) {
      seen.add(key);
      score += Number(kw.weight) || 1;
    }
  }
  return { score, matched: [...seen] };
}

function passesGate(item, keywords, { categories = [], threshold = 1.5 } = {}) {
  return keywordScore(item, keywords, categories).score >= threshold;
}

function applyIngestPolicy(items, sourceConfig = {}, keywords = []) {
  let out = items;
  if (sourceConfig.keyword_gate && keywords.length) {
    const g = sourceConfig.keyword_gate;
    const before = out.length;
    out = out.filter((it) => passesGate(it, keywords, g));
    if (before !== out.length) console.log(`  keyword gate: ${before} -> ${out.length} items (threshold ${g.threshold ?? 1.5})`);
  }
  if (sourceConfig.keyword_boost && keywords.length) {
    const b = sourceConfig.keyword_boost;
    for (const it of out) {
      const { score } = keywordScore(it, keywords, b.categories || []);
      it.score = (it.score || 0) + score * (b.factor || 10);
      it.metadata = { ...(it.metadata || {}), keyword_score: score };
    }
  }
  return out;
}

module.exports = { keywordScore, passesGate, applyIngestPolicy };
