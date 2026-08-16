/**
 * Watchlist Discovery Module
 *
 * For each curated GitHub author/org in claude-ecosystem.watchlist, list their
 * most-recently-pushed repos and surface high-star ones into the items table.
 * Catches gems that don't self-tag with our seed topics (e.g., pbakaus/impeccable).
 *
 * Reuses GitHubDiscoveryModule helpers (analyzeRepo, calculateRelevanceScore,
 * normalizeRepo, fetchWithRateCheck) by extending it.
 */
const GitHubDiscoveryModule = require('./github-discovery');

class WatchlistDiscoveryModule extends GitHubDiscoveryModule {
  async fetch() {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN required for watchlist discovery');
    }

    const projectId = this.config.project_id || 'claude-ecosystem';
    const { projects } = this.loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project || !Array.isArray(project.watchlist) || project.watchlist.length === 0) {
      console.warn(`  [watchlist] project "${projectId}" has no watchlist; skipping`);
      return [];
    }

    const owners = project.watchlist;
    const minStars = this.config.min_stars ?? project.watchlist_star_floor ?? 100;
    const daysWithin = this.config.days_pushed_within ?? 30;
    // First-run cap reduces interactive runtime from ~16min to ~3min
    const maxPerOwner =
      process.env.HUB_FIRST_RUN === '1'
        ? this.config.first_run_max_repos_per_owner ?? 5
        : this.config.max_repos_per_owner ?? 30;

    const headers = this.githubHeaders();
    const cutoffMs = Date.now() - daysWithin * 86400000;

    const seen = new Set();
    const results = [];
    let stopped = false;

    for (const owner of owners) {
      if (stopped) break;
      const url = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=pushed&direction=desc&per_page=${maxPerOwner}`;
      let res;
      try {
        res = await this.fetchWithRateCheck(url, headers);
      } catch (err) {
        console.warn(`  [watchlist] rate-limit stop at owner=${owner}: ${err.message}`);
        stopped = true;
        break;
      }
      if (res.status === 404) {
        console.warn(`  [watchlist] owner not found: ${owner}`);
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        console.warn(`  [watchlist] rate limited (${res.status}) at owner=${owner}; stopping`);
        stopped = true;
        break;
      }
      if (!res.ok) {
        console.warn(`  [watchlist] GET /users/${owner}/repos failed: ${res.status}`);
        await this.sleep(1500);
        continue;
      }

      const repos = await res.json();
      for (const repo of repos) {
        if (!repo || repo.archived || repo.fork) continue;
        if ((repo.stargazers_count || 0) < minStars) continue;
        const pushedMs = new Date(repo.pushed_at).getTime();
        if (Number.isFinite(pushedMs) && pushedMs < cutoffMs) continue;
        if (seen.has(repo.full_name)) continue;
        seen.add(repo.full_name);

        const analysis = await this.analyzeRepo(repo);
        const queryInfo = { query: `watchlist:${owner}`, strategy: 'watchlist', owner };
        const relevance = this.calculateRelevanceScore(repo, analysis, queryInfo);
        results.push(this.normalizeRepo(repo, analysis, relevance, queryInfo));
        await this.sleep(500); // gentler than search-API pacing
      }
    }

    console.log(`  [watchlist] ${results.length} repos from ${owners.length} owners (>=${minStars}★, pushed within ${daysWithin}d, cap=${maxPerOwner}/owner)`);
    return results;
  }
}

module.exports = WatchlistDiscoveryModule;
