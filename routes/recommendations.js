/**
 * Recommendations Route - GET /api/recommendations
 * Returns discovered repos filtered by project relevance
 */
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const fs = require('fs');
const path = require('path');

// GET /api/recommendations?project=apollo&limit=20
router.get('/', (req, res) => {
  try {
    const { project, limit = 20 } = req.query;
    const discoverySources = [
      'github-discovery-tech',
      'github-discovery-curated',
      'github-discovery-rising',
      'github-discovery-deps',
    ];
    const wanted = parseInt(limit) || 20;

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

    // Dedup by repo title across both lists (a repo can be indexed by >1 source)
    const seen = new Set();
    const dedup = (list) => list.filter(r => {
      if (seen.has(r.title)) return false;
      seen.add(r.title);
      return true;
    });

    const stack = dedup(matched.filter(r => r.relevance.strategy === 'dependency-backed')).slice(0, wanted);
    const discoveries = dedup(matched.filter(r => r.relevance.strategy !== 'dependency-backed')).slice(0, wanted);

    res.json({
      project,
      count: stack.length + discoveries.length,
      stack,
      discoveries,
      recommendations: [...stack, ...discoveries],
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
