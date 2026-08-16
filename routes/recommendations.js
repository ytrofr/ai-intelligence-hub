/**
 * Recommendations Route - GET /api/recommendations
 * Returns discovered repos filtered by project relevance (assembly in modules/recommend.js).
 *   ?project=apollo&limit=20&starsMin=200   starsMin: floor for discoveries (default 200; 0 disables)
 *   ?raw=1                               skip floor/fork/dedup/decay (pre-2026-08-16 behaviour)
 */
const express = require('express');
const router = express.Router();
const db = require('../database/db');
const fs = require('fs');
const path = require('path');
const { recommendForProject, topFeed } = require('../modules/recommend');
const { DEFAULT_STARS_MIN } = require('./lib/rank');

router.get('/', (req, res) => {
  try {
    const { project, limit = 20, starsMin, raw } = req.query;
    const wanted = parseInt(limit) || 20;
    const floor = starsMin === undefined ? DEFAULT_STARS_MIN : Math.max(0, parseInt(starsMin) || 0);
    const useRaw = raw === '1';

    if (!project) {
      const enriched = topFeed(db, wanted);
      return res.json({ project: 'all', count: enriched.length, recommendations: enriched, stack: [], stackHealth: [], discoveries: [] });
    }

    const { discoveries, stackHealth, poolSize } = recommendForProject(db, project, { limit: wanted, starsMin: floor, raw: useRaw });
    if (!useRaw) console.log(`RECS ${project}: ${poolSize} candidates -> ${discoveries.length} after floor(${floor})/fork/dedup`);
    res.json({
      project,
      count: discoveries.length,
      starsMin: useRaw ? 0 : floor,
      stackHealth,
      stack: stackHealth, // deprecated alias (project-radar.html) - remove after 2026-09
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
