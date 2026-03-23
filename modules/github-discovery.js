/**
 * GitHub Discovery Module - Discover relevant repos via multiple strategies
 *
 * Strategies: "tech-stack", "curated-lists", "rising-stars"
 */
const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

// Generic deps appear in 80%+ of web projects — low signal
const GENERIC_DEPS = new Set([
  'react', 'react-dom', 'typescript', 'vite', 'tailwindcss',
  'zustand', 'next', 'express', 'axios', 'lodash', 'dotenv',
  'eslint', 'prettier', 'jest', 'vitest', 'webpack', 'postcss',
  'autoprefixer', 'lucide-react', 'clsx', 'uuid', 'zod',
  'cors', 'helmet', 'nodemon', 'ts-node', 'tslib',
]);

// Broad topics match too many unrelated repos — low signal
const BROAD_TOPICS = new Set([
  'claude-code', 'rag', 'dashboard', 'ai', 'llm', 'agent',
  'open-source', 'typescript', 'react', 'python', 'javascript',
  'machine-learning', 'deep-learning', 'api', 'cli',
]);

class GitHubDiscoveryModule extends BaseModule {
  constructor(config) {
    super(config);
    this._projectsCache = null;
  }

  githubHeaders() {
    const headers = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AI-Intelligence-Hub/1.0',
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `token ${token}`;
    return headers;
  }

  async fetch() {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN is required for GitHub Discovery. Set it in your environment.');
    }
    const strategy = this.config.strategy || 'tech-stack';
    console.log(`  GitHub Discovery: running "${strategy}" strategy`);
    if (strategy === 'tech-stack') return this.fetchTechStack();
    if (strategy === 'curated-lists') return this.fetchCuratedLists();
    if (strategy === 'rising-stars') return this.fetchRisingStars();
    throw new Error(`Unknown GitHub Discovery strategy: ${strategy}`);
  }

  loadProjects() {
    if (this._projectsCache) return this._projectsCache;
    const filePath = path.join(__dirname, '..', 'config', 'projects.json');
    this._projectsCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return this._projectsCache;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Fetch wrapper — checks rate limit ratio, stops when <5% remaining */
  async fetchWithRateCheck(url, headers) {
    const res = await fetch(url, { headers });
    const remaining = parseInt(res.headers.get('x-ratelimit-remaining'), 10);
    const limit = parseInt(res.headers.get('x-ratelimit-limit'), 10);
    if (!isNaN(remaining) && !isNaN(limit) && limit > 0) {
      const ratio = remaining / limit;
      if (ratio < 0.05) {
        throw new Error(`GitHub rate limit critically low: ${remaining}/${limit} remaining. Stopping.`);
      }
      if (ratio < 0.15) {
        console.warn(`  GitHub rate limit low: ${remaining}/${limit} remaining`);
      }
    }
    return res;
  }

  // -- Strategy 1: Tech Stack ------------------------------------------------

  async fetchTechStack() {
    const { projects } = this.loadProjects();
    const headers = this.githubHeaders();
    const maxQueries = this.config.max_queries || 30;
    const maxReadmeFetches = this.config.max_readme_fetches || 50;

    const queryPool = [];
    for (const project of projects) {
      for (const q of project.searchQueries || []) {
        queryPool.push({ query: q, projectId: project.id, projectName: project.name });
      }
    }
    this.shuffleArray(queryPool);
    const queries = queryPool.slice(0, maxQueries);

    const seen = new Set();
    const results = [];
    let readmeFetches = 0;
    let stopped = false;

    for (const queryInfo of queries) {
      if (stopped) break;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(queryInfo.query)}&sort=stars&per_page=10`;

      let res;
      try {
        res = await this.fetchWithRateCheck(url, headers);
      } catch (err) {
        console.warn(`  Rate limit stop during tech-stack: ${err.message}`);
        stopped = true;
        break;
      }

      if (res.status === 403 || res.status === 429) {
        console.warn(`  GitHub search rate limited (${res.status}). Stopping tech-stack queries.`);
        stopped = true;
        break;
      }
      if (!res.ok) {
        console.warn(`  GitHub search failed for "${queryInfo.query}": ${res.status}`);
        await this.sleep(2000);
        continue;
      }

      const data = await res.json();
      for (const repo of data.items || []) {
        if (seen.has(repo.full_name)) continue;
        seen.add(repo.full_name);

        let analysis = { readmeSummary: '', readmeLength: 0, dependencies: [] };
        if (readmeFetches < maxReadmeFetches) {
          analysis = await this.analyzeRepo(repo);
          readmeFetches++;
        }
        const relevance = this.calculateRelevanceScore(repo, analysis, queryInfo);
        results.push(this.normalizeRepo(repo, analysis, relevance, queryInfo));
      }
      await this.sleep(2000); // GitHub secondary rate limit: 30 search/min
    }

    console.log(`  Tech-stack: ${results.length} repos from ${queries.length} queries`);
    return results;
  }

  // -- Strategy 2: Curated Lists ---------------------------------------------

  async fetchCuratedLists() {
    const { curatedLists } = this.loadProjects();
    const headers = this.githubHeaders();
    const maxRepos = this.config.max_repos || 50;

    if (!curatedLists || curatedLists.length === 0) {
      console.log('  No curated lists configured in projects.json.');
      return [];
    }

    const repoSlugs = new Set();
    for (const list of curatedLists) {
      const readmeUrl = `https://raw.githubusercontent.com/${list.repo}/HEAD/README.md`;
      try {
        const res = await fetch(readmeUrl, { headers: { 'User-Agent': 'AI-Intelligence-Hub/1.0' } });
        if (!res.ok) { console.warn(`  Could not fetch README for ${list.repo}: ${res.status}`); continue; }
        const markdown = await res.text();
        for (const slug of this.extractGitHubRepoUrls(markdown)) repoSlugs.add(slug);
      } catch (err) {
        console.warn(`  Error fetching curated list ${list.repo}: ${err.message}`);
      }
    }

    const slugs = [...repoSlugs].slice(0, maxRepos);
    console.log(`  Curated lists: ${slugs.length} unique repo URLs from ${curatedLists.length} lists`);

    const seen = new Set();
    const results = [];
    let stopped = false;

    for (let i = 0; i < slugs.length && !stopped; i += 10) {
      const batch = slugs.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (slug) => {
          if (seen.has(slug)) return null;
          seen.add(slug);
          try {
            const res = await this.fetchWithRateCheck(`https://api.github.com/repos/${slug}`, headers);
            if (res.status === 403 || res.status === 429) { stopped = true; return null; }
            if (!res.ok) return null;
            const repo = await res.json();
            const analysis = await this.analyzeRepo(repo);
            const queryInfo = { query: null, strategy: 'curated-lists' };
            const relevance = this.calculateRelevanceScore(repo, analysis, queryInfo);
            return this.normalizeRepo(repo, analysis, relevance, queryInfo);
          } catch (err) {
            if (err.message.includes('rate limit')) stopped = true;
            return null;
          }
        })
      );
      results.push(...batchResults.filter(Boolean));
    }

    console.log(`  Curated lists: ${results.length} repos analyzed and scored`);
    return results;
  }

  extractGitHubRepoUrls(markdown) {
    const regex = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
    const slugs = new Set();
    let match;
    while ((match = regex.exec(markdown)) !== null) {
      let slug = match[1].replace(/\.git$/, '').replace(/[.)]+$/, '');
      const parts = slug.split('/');
      const owner = parts[0];
      const repo = parts[1];
      if (owner && repo && repo.length > 1 && !repo.startsWith('.')) {
        slugs.add(`${owner}/${repo}`);
      }
    }
    return [...slugs];
  }

  // -- Strategy 3: Rising Stars ----------------------------------------------

  async fetchRisingStars() {
    const { projects } = this.loadProjects();
    const headers = this.githubHeaders();

    const langSet = new Set();
    for (const project of projects) {
      for (const lang of project.languages || []) langSet.add(lang);
    }
    const languages = [...langSet].slice(0, 5);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

    const seen = new Set();
    const results = [];
    let stopped = false;

    for (const lang of languages) {
      if (stopped) break;
      const q = `created:>${ninetyDaysAgo} stars:>50 language:${lang}`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=15`;

      let res;
      try {
        res = await this.fetchWithRateCheck(url, headers);
      } catch (err) {
        console.warn(`  Rate limit stop during rising-stars: ${err.message}`);
        stopped = true;
        break;
      }
      if (res.status === 403 || res.status === 429) {
        console.warn(`  GitHub search rate limited (${res.status}). Stopping rising-stars.`);
        stopped = true;
        break;
      }
      if (!res.ok) {
        console.warn(`  Rising stars search failed for "${lang}": ${res.status}`);
        await this.sleep(2000);
        continue;
      }

      const data = await res.json();
      for (const repo of data.items || []) {
        if (seen.has(repo.full_name)) continue;
        seen.add(repo.full_name);
        const analysis = await this.analyzeRepo(repo);
        const queryInfo = { query: q, strategy: 'rising-stars', language: lang };
        const relevance = this.calculateRelevanceScore(repo, analysis, queryInfo);
        results.push(this.normalizeRepo(repo, analysis, relevance, queryInfo));
      }
      await this.sleep(2000);
    }

    console.log(`  Rising stars: ${results.length} repos across ${languages.length} languages`);
    return results;
  }

  // -- Repo Analysis (CDN only, no API calls) --------------------------------

  async analyzeRepo(repoData) {
    const base = `https://raw.githubusercontent.com/${repoData.full_name}/HEAD`;
    const h = { 'User-Agent': 'AI-Intelligence-Hub/1.0' };

    const [readmeRes, pkgRes, reqRes, pyRes] = await Promise.all([
      fetch(`${base}/README.md`, { headers: h }).catch(() => null),
      fetch(`${base}/package.json`, { headers: h }).catch(() => null),
      fetch(`${base}/requirements.txt`, { headers: h }).catch(() => null),
      fetch(`${base}/pyproject.toml`, { headers: h }).catch(() => null),
    ]);

    const readme = readmeRes && readmeRes.ok ? await readmeRes.text() : null;
    const pkgJson = pkgRes && pkgRes.ok ? await pkgRes.text() : null;
    const reqTxt = reqRes && reqRes.ok ? await reqRes.text() : null;
    const pyproject = pyRes && pyRes.ok ? await pyRes.text() : null;

    const readmeInfo = readme ? this.extractReadmeInfo(readme) : { title: '', description: '', length: 0 };
    const dependencies = this.extractDependencies(pkgJson, reqTxt, pyproject);

    return { readmeSummary: readmeInfo.description, readmeLength: readmeInfo.length, dependencies };
  }

  extractReadmeInfo(markdown) {
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    const title = h1Match ? h1Match[1].trim() : '';

    let description = '';
    const h1Index = markdown.search(/^#\s+/m);
    if (h1Index !== -1) {
      const afterH1 = markdown.indexOf('\n', h1Index);
      const h2Index = markdown.search(/^##\s+/m);
      const end = h2Index > afterH1 ? h2Index : Math.min(afterH1 + 1000, markdown.length);
      if (afterH1 !== -1) {
        description = markdown.substring(afterH1 + 1, end)
          .replace(/[#*`\[\]()>]/g, '').replace(/\n+/g, ' ').trim().substring(0, 300);
      }
    }
    return { title, description, length: markdown.length };
  }

  extractDependencies(packageJsonStr, requirementsTxt, pyprojectToml) {
    const deps = [];

    if (packageJsonStr) {
      try {
        const pkg = JSON.parse(packageJsonStr);
        if (pkg.dependencies) deps.push(...Object.keys(pkg.dependencies));
        if (pkg.devDependencies) deps.push(...Object.keys(pkg.devDependencies));
      } catch { /* malformed JSON */ }
    }

    if (requirementsTxt) {
      for (const line of requirementsTxt.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
        const name = trimmed.split(/[=<>~![\s]/)[0].trim();
        if (name) deps.push(name.toLowerCase());
      }
    }

    if (pyprojectToml) {
      const depMatch = pyprojectToml.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depMatch) {
        const entries = depMatch[1].match(/"([^"]+)"|'([^']+)'/g);
        if (entries) {
          for (const entry of entries) {
            const raw = entry.replace(/["']/g, '');
            const name = raw.split(/[=<>~![\s]/)[0].trim();
            if (name) deps.push(name.toLowerCase());
          }
        }
      }
    }

    return [...new Set(deps.map((d) => d.toLowerCase()))];
  }

  // -- Relevance Scoring -----------------------------------------------------

  calculateRelevanceScore(repoData, analysis, queryInfo) {
    const { projects } = this.loadProjects();
    const strategy = queryInfo.strategy || this.config.strategy || 'tech-stack';

    let maxOverlap = 0;
    const matchedProjects = [];

    for (const project of projects) {
      const projectDeps = new Set((project.dependencies || []).map((d) => d.toLowerCase()));
      const projectTopics = new Set((project.topics || []).map((t) => t.toLowerCase()));
      const repoTopics = (repoData.topics || []).map((t) => t.toLowerCase());

      const specificDeps = analysis.dependencies.filter((d) => projectDeps.has(d) && !GENERIC_DEPS.has(d));
      const genericDeps = analysis.dependencies.filter((d) => projectDeps.has(d) && GENERIC_DEPS.has(d));
      const specificTopics = repoTopics.filter((t) => projectTopics.has(t) && !BROAD_TOPICS.has(t));
      const genericTopics = repoTopics.filter((t) => projectTopics.has(t) && BROAD_TOPICS.has(t));

      const weightedOverlap =
        specificDeps.length * 5.0 + genericDeps.length * 0.5 +
        specificTopics.length * 3.0 + genericTopics.length * 0.3;

      const allSharedDeps = [...specificDeps, ...genericDeps];
      const allSharedTopics = [...specificTopics, ...genericTopics];

      if (weightedOverlap > 0) {
        matchedProjects.push({
          id: project.id, name: project.name,
          overlap: weightedOverlap,
          sharedDeps: allSharedDeps, sharedTopics: allSharedTopics,
          specificDeps, genericDeps, specificTopics, genericTopics,
        });
      }
      if (weightedOverlap > maxOverlap) maxOverlap = weightedOverlap;
    }

    const strategyWeights = { 'tech-stack': 3.0, 'curated-lists': 2.5, 'rising-stars': 2.0 };
    const strategyWeight = strategyWeights[strategy] || 2.0;
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(repoData.created_at).getTime()) / 86400000);
    const starVelocity = repoData.stargazers_count / daysSinceCreation;
    const recencyScore = this.getRecencyMultiplier(repoData.pushed_at);
    const readmeQuality = Math.min((analysis.readmeLength || 0) / 10000, 1);

    const score =
      maxOverlap +
      strategyWeight +
      Math.min(starVelocity, 10) * 2.0 +
      recencyScore * 10.0 +
      readmeQuality * 0.5;

    let matchReason = '';
    if (matchedProjects.length > 0) {
      const best = matchedProjects.reduce((a, b) => (a.overlap > b.overlap ? a : b));
      const parts = [];
      if (best.specificDeps && best.specificDeps.length > 0) {
        parts.push(`${best.specificDeps.length} key deps (${best.specificDeps.slice(0, 4).join(', ')})`);
      }
      if (best.specificTopics && best.specificTopics.length > 0) {
        parts.push(`${best.specificTopics.length} topics (${best.specificTopics.slice(0, 3).join(', ')})`);
      }
      if (parts.length === 0 && best.genericDeps && best.genericDeps.length > 0) {
        parts.push(`${best.genericDeps.length} common deps (${best.genericDeps.slice(0, 3).join(', ')})`);
      }
      matchReason = parts.length > 0 ? `Shares ${parts.join(' + ')} with ${best.name}` : `Matched to ${best.name}`;
    } else if (strategy === 'rising-stars') {
      matchReason = `Rising: ${repoData.stargazers_count} stars in ${Math.round(daysSinceCreation)} days`;
    } else {
      matchReason = `Found via ${strategy}`;
    }

    return { score, matchedProjects, matchReason };
  }

  getRecencyMultiplier(dateStr) {
    if (!dateStr) return 0.3;
    const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
    if (days < 1) return 1.0;
    if (days < 7) return 0.9;
    if (days < 30) return 0.7;
    if (days < 90) return 0.5;
    return 0.3;
  }

  // -- Normalization ---------------------------------------------------------

  normalizeRepo(repoData, analysis, relevance, queryInfo) {
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(repoData.created_at).getTime()) / 86400000);
    return this.normalize({
      id: `${repoData.owner.login}-${repoData.name}`,
      title: repoData.full_name,
      url: repoData.html_url,
      description: repoData.description || analysis.readmeSummary || '',
      author: repoData.owner?.login,
      stars: repoData.stargazers_count,
      score: relevance.score,
      published_at: repoData.pushed_at,
      metadata: {
        discovery_strategy: this.config.strategy,
        search_query: queryInfo?.query || null,
        matched_projects: relevance.matchedProjects,
        match_reason: relevance.matchReason,
        dependency_overlap: Math.max(...relevance.matchedProjects.map((p) => p.overlap), 0),
        repo_dependencies: analysis.dependencies.slice(0, 30),
        readme_summary: analysis.readmeSummary?.substring(0, 300) || '',
        readme_length: analysis.readmeLength,
        language: repoData.language,
        forks: repoData.forks_count,
        topics: repoData.topics || [],
        star_velocity: repoData.stargazers_count / daysSinceCreation,
        open_issues: repoData.open_issues_count,
      },
    });
  }

  // -- Utilities -------------------------------------------------------------

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

module.exports = GitHubDiscoveryModule;
