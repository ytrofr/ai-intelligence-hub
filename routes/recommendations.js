/**
 * Recommendations Route - GET /api/recommendations
 * Returns discovered repos filtered by project relevance
 */
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const { rankDiscoveries, stackHealth, DEFAULT_STARS_MIN } = require('./lib/rank');

// GET /api/recommendations?project=apollo&limit=20&starsMin=200
//   starsMin: star floor for discoveries (default 200; 0 disables)
//   raw=1   : skip floor/fork/dedup/decay (debug - the pre-2026-08-16 behaviour)
router.get('/', (req, res) => {
  try {
    const { project, limit = 20, starsMin, raw } = req.query;
    const discoverySources = [
      'github-discovery-tech',
      'github-discovery-curated',
      'github-discovery-rising',
      'github-discovery-deps',
      'github-watchlist',
    ];
    const wanted = parseInt(limit) || 20;
    const floor = starsMin === undefined ? DEFAULT_STARS_MIN : Math.max(0, parseInt(starsMin) || 0);
    const useRank = raw !== '1';

    // When filtering by project, pull the full discovery pool — the project
    // filter and the stack/discoveries split run after the SQL fetch, so a
    // small limit would starve the result (esp. lower-scored stack repos).
    let items = db.getItems({
      sources: discoverySources,
      sortBy: 'score',
      sortOrder: 'DESC',
      limit: project ? 2000 : wanted,
    });

    // Enrich a raw item with parsed metadata + a flattened relevance block.
    // When forProject is given, matchReason/overlap reflect THAT project's own
    // matched_projects entry — not the global best-overlap project.
    const enrich = (item, forProject) => {
      try {
        const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
        const mps = metadata?.matched_projects || [];
        const own = forProject ? mps.find(mp => mp.id === forProject) : null;
        let reason = metadata?.match_reason || '';
        if (own) {
          const parts = [];
          if (own.specificDeps && own.specificDeps.length) {
            parts.push(`${own.specificDeps.length} key deps (${own.specificDeps.slice(0, 4).join(', ')})`);
          }
          if (own.specificTopics && own.specificTopics.length) {
            parts.push(`${own.specificTopics.length} topics (${own.specificTopics.slice(0, 3).join(', ')})`);
          }
          if (!parts.length && own.genericDeps && own.genericDeps.length) {
            parts.push(`${own.genericDeps.length} common deps`);
          }
          reason = parts.length
            ? `Shares ${parts.join(' + ')}`
            : (own.overlap >= 10
                ? 'Direct dependency'
                : (own.viaQuery ? `Found via "${own.viaQuery}" search` : reason));
        }
        return {
          ...item,
          metadata,
          relevance: {
            matchedProjects: mps,
            matchReason: reason,
            dependencyOverlap: own ? own.overlap : (metadata?.dependency_overlap || 0),
            strategy: metadata?.discovery_strategy || 'unknown',
          },
        };
      } catch {
        return { ...item, relevance: { strategy: 'unknown' } };
      }
    };

    // No project filter — flat top-N feed
    if (!project) {
      const enriched = items.map(enrich);
      return res.json({
        project: 'all',
        count: enriched.length,
        recommendations: enriched,
        stack: [],
        discoveries: [],
      });
    }

    // Project filter — keep the full matched set, then split into:
    //   stack       = repos this project already depends on (dependency-backed)
    //   discoveries = everything else — candidates to consider adopting
    const matched = items
      .filter(item => {
        try {
          const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
          return (metadata?.matched_projects || []).some(mp => mp.id === project);
        } catch { return false; }
      })
      .map(item => enrich(item, project));

    // Sort by THIS project's own overlap first — not the item's global score
    // (which reflects its best-matching project). Otherwise a repo strongly
    // matched to another project outranks one strongly matched to the queried
    // project. Global score breaks ties within the same overlap.
    matched.sort((a, b) =>
      (b.relevance.dependencyOverlap || 0) - (a.relevance.dependencyOverlap || 0) ||
      (b.score || 0) - (a.score || 0)
    );

    // dependency-backed rows are OUR OWN declared deps (overlap forced to 10) -
    // not recommendations. Serve them as stackHealth (upstream staleness) and
    // keep them out of discoveries. `stack` stays as an alias for one release.
    const ownDeps = matched.filter(r => r.relevance.strategy === 'dependency-backed');
    const candidates = matched.filter(r => r.relevance.strategy !== 'dependency-backed');
    const ownTitles = new Set(ownDeps.map(r => r.title));
    const pool = candidates.filter(r => !ownTitles.has(r.title));

    let discoveries;
    if (useRank) {
      discoveries = rankDiscoveries(pool, { starsMin: floor });
      console.log(`RECS ${project}: ${pool.length} candidates -> ${discoveries.length} after floor(${floor})/fork/dedup`);
    } else {
      const seen = new Set();
      discoveries = pool.filter(r => (seen.has(r.title) ? false : seen.add(r.title)));
    }
    discoveries = discoveries.slice(0, wanted);
    const health = stackHealth(ownDeps).slice(0, wanted);

    res.json({
      project,
      count: discoveries.length,
      starsMin: useRank ? floor : 0,
      stackHealth: health,
      stack: health, // deprecated alias (project-radar.html) - remove after 2026-09
      discoveries,
      recommendations: discoveries,
    });
  } catch (error) {
    console.error('Recommendations error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/recommendations/projects — list available projects
router.get('/projects', (req, res) => {
  try {
    const projectsPath = path.join(__dirname, '..', 'config', 'projects.json');
    const { projects } = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
    res.json({ projects: projects.map(p => ({ id: p.id, name: p.name })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load projects config' });
  }
});

module.exports = router;
