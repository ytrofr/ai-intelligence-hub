/**
 * Recommendations Route - GET /api/recommendations
 * Returns discovered repos filtered by project relevance
 */
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const fs = require('fs');
const path = require('path');

// GET /api/recommendations?project=ogas&limit=20
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

    // When filtering by project, pull a larger pool first — the project filter
    // is applied after the SQL limit, so a small limit would starve the result.
    let items = db.getItems({
      sources: discoverySources,
      sortBy: 'score',
      sortOrder: 'DESC',
      limit: project ? Math.min(wanted * 12, 600) : wanted,
    });

    // Filter by project if specified
    if (project) {
      items = items
        .filter(item => {
          try {
            const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
            const matched = metadata?.matched_projects || [];
            return matched.some(mp => mp.id === project);
          } catch { return false; }
        })
        .slice(0, wanted);
    }

    // Enrich with parsed metadata
    const enriched = items.map(item => {
      try {
        const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
        return {
          ...item,
          metadata,
          relevance: {
            matchedProjects: metadata?.matched_projects || [],
            matchReason: metadata?.match_reason || '',
            dependencyOverlap: metadata?.dependency_overlap || 0,
            strategy: metadata?.discovery_strategy || 'unknown',
          }
        };
      } catch {
        return item;
      }
    });

    res.json({
      project: project || 'all',
      count: enriched.length,
      recommendations: enriched,
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
