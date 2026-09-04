/**
 * GitHub Discovery Module - Discover relevant repos via multiple strategies
 *
 * Strategies: "tech-stack", "curated-lists", "rising-stars"
 */
const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');
// The slot gate (H4, 2026-09-03): a repo can grade a `package`/`service`
// instrument slot the same way an HF dataset grades a `ground-truth` one.
// See modules/slot-gate.js.
const slotGate = require('./slot-gate');

// Generic deps appear in 80%+ of projects — low signal, must NOT boost relevance
const GENERIC_DEPS = new Set([
  // JS / frontend
  'react', 'react-dom', 'typescript', 'vite', 'tailwindcss',
  'zustand', 'next', 'express', 'axios', 'lodash', 'dotenv',
  'eslint', 'prettier', 'jest', 'vitest', 'webpack', 'postcss',
  'autoprefixer', 'lucide-react', 'clsx', 'uuid', 'zod',
  'cors', 'helmet', 'nodemon', 'ts-node', 'tslib',
  // Python — web framework / HTTP / packaging / data base layer.
  // These say "it's a Python backend", not "it's relevant to this project".
  'fastapi', 'uvicorn', 'pydantic', 'pydantic-settings', 'python-dotenv',
  'httpx', 'requests', 'starlette', 'aiohttp', 'anyio', 'sniffio',
  'click', 'rich', 'pyyaml', 'gunicorn', 'flask', 'sqlalchemy',
  'numpy', 'pandas', 'scipy', 'setuptools', 'pytest', 'python-multipart',
  'typing-extensions', 'aiofiles',
  // 2026-08-16: utility/infra libs that live-repo deps surfaced as "key" but say nothing about domain
  'chalk', 'commander', 'inquirer', 'jsdom', 'tsup', 'esbuild', 'class-variance-authority', 'tailwind-merge',
  'react-router', 'react-router-dom', 'node-fetch', 'winston', 'pino', 'pino-pretty', 'cookie-parser',
  'bcrypt', 'bcryptjs', 'jsonwebtoken', 'jose', 'knip', 'lefthook', 'typescript-eslint', 'express-rate-limit',
  'ws', 'cryptography', 'aiosqlite', 'openpyxl', 'python-docx', 'python-pptx', 'pypdf', 'react-markdown',
  'date-fns', 'dayjs', 'js-yaml', 'yaml', 'glob', 'minimatch', 'semver', 'ora', 'debug', 'body-parser',
  // AI SDKs shared by EVERY project of ours - they say "it's an AI app", not which domain
  '@modelcontextprotocol/sdk', '@anthropic-ai/sdk', 'anthropic', 'openai', '@google/genai', 'google-genai',
  '@google/generative-ai', 'mcp', 'litellm', 'tiktoken',
]);
// Dev-tooling families that live deps (package.json devDependencies, requirements-test)
// drag in: type stubs, linters, test runners, bundler plugins, release tooling.
// One regex for the prefix families (scoped tooling packages); exact names live in the Set above.
const GENERIC_DEP_RE = new RegExp(
  '^(?:' + ['@types/', '@typescript-eslint/', '@eslint/', 'eslint', 'prettier', '@vitejs/', '@vitest/', 'vitest',
    'jest', '@jest/', '@testing-library/', '@playwright/', 'playwright$', 'tsx$', 'ts-jest$', '@changesets/', 'husky$',
    'lint-staged$', 'turbo$', '@turbo/', 'rimraf$', 'concurrently$', '@tailwindcss/', 'globals$', 'supertest$', 'msw$',
    '@storybook/', 'storybook$', 'ruff$', 'black$', 'mypy$', 'isort$', 'flake8$', 'pytest', 'coverage$', 'wheel$', 'pip$', 'build$',
  ].join('|') + ')',
);
const isGenericDep = (d) => GENERIC_DEPS.has(d) || GENERIC_DEP_RE.test(d);

// Broad topics match too many unrelated repos — low signal
const BROAD_TOPICS = new Set([
  'claude-code', 'rag', 'dashboard', 'ai', 'llm', 'agent',
  'open-source', 'typescript', 'react', 'python', 'javascript',
  'machine-learning', 'deep-learning', 'api', 'cli',
]);

const { readDeps, mergeProjectDeps } = require('./project-deps');
const { formatMatchReason } = require('./match-reason');

// Shared across module instances (createModule builds one per source per fetch):
// one config parse + one live-deps merge per PROJECTS_TTL_MS, not one per instance.
const PROJECTS_TTL_MS = 5 * 60 * 1000;
let _sharedProjects = { at: 0, cfg: null };

class GitHubDiscoveryModule extends BaseModule {
  constructor(config) {
    super(config);
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
    if (strategy === 'dependency-backed') return this.fetchDependencyBacked();
    throw new Error(`Unknown GitHub Discovery strategy: ${strategy}`);
  }

  loadProjects() {
    if (_sharedProjects.cfg && Date.now() - _sharedProjects.at < PROJECTS_TTL_MS) return _sharedProjects.cfg;
    const filePath = path.join(__dirname, '..', 'config', 'projects.json');
    const cfg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Live deps from the repo checkout (config.repoPath) widen the SCORING
    // overlap set; `dependencies` stays the curated list used for the
    // dependency-backed (stack health) strategy. Unreadable repo -> curated only.
    for (const project of cfg.projects || []) {
      const live = readDeps(project.repoPath, { exclude: project.repoExclude || [] });
      project.scoringDependencies = mergeProjectDeps(project.dependencies || [], live);
      if (live.length) console.log(`  Project ${project.id}: ${live.length} live deps from ${project.repoPath}`);
    }
    _sharedProjects = { at: Date.now(), cfg };
    return cfg;
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
    const minStars = this.config.min_stars || 50;
    const lookback = this.config.days_lookback || 90;
    const ninetyDaysAgo = new Date(Date.now() - lookback * 86400000).toISOString().split('T')[0];

    const seen = new Set();
    const results = [];
    let stopped = false;

    for (const lang of languages) {
      if (stopped) break;
      const q = `created:>${ninetyDaysAgo} stars:>${minStars} language:${lang}`;
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

  // -- Strategy 4: Dependency-Backed -----------------------------------------
  // Resolves the GitHub repo behind each declared project dependency and ingests
  // it tagged to that project at full weight. Without this, a repo a project
  // literally depends on can sit in the index unranked forever — the scorer
  // compares dependency *lists*, never "which repo publishes this package".

  async fetchDependencyBacked() {
    const { projects } = this.loadProjects();
    const headers = this.githubHeaders();
    const maxDeps = this.config.max_deps || 120;

    // Pass 1: resolve every (project, dep) -> "owner/repo" slug
    const slugMap = new Map(); // slug -> { slug, sources: [{id,name,dep}] }
    let resolveCount = 0;
    for (const project of projects) {
      for (const dep of project.dependencies || []) {
        if (resolveCount >= maxDeps) break;
        resolveCount++;
        const slug = await this.resolveDependencyRepo(dep);
        if (!slug) continue;
        if (!slugMap.has(slug)) slugMap.set(slug, { slug, sources: [] });
        slugMap.get(slug).sources.push({
          id: project.id, name: project.name, dep,
        });
      }
    }
    console.log(
      `  Dependency-backed: ${slugMap.size} repos resolved from ${resolveCount} declared dependencies`,
    );

    // Pass 2: fetch each unique repo, tag it to the project(s) that declare it
    const results = [];
    const entries = [...slugMap.values()];
    let stopped = false;
    for (let i = 0; i < entries.length && !stopped; i += 10) {
      const batch = entries.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (entry) => {
          try {
            const res = await this.fetchWithRateCheck(
              `https://api.github.com/repos/${entry.slug}`, headers,
            );
            if (res.status === 403 || res.status === 429) { stopped = true; return null; }
            if (!res.ok) return null;
            const repo = await res.json();
            const analysis = await this.analyzeRepo(repo);
            const relevance = this.buildDependencyRelevance(repo, analysis, entry.sources);
            return this.normalizeRepo(repo, analysis, relevance, {
              query: null, strategy: 'dependency-backed',
            });
          } catch (err) {
            if (err.message.includes('rate limit')) stopped = true;
            return null;
          }
        }),
      );
      results.push(...batchResults.filter(Boolean));
    }

    console.log(`  Dependency-backed: ${results.length} repos analyzed and scored`);
    return results;
  }

  /** Resolve a package name to an "owner/repo" GitHub slug — npm first, then PyPI. */
  async resolveDependencyRepo(dep) {
    const name = String(dep || '').trim();
    if (!name) return null;
    const npmSlug = await this.resolveNpmRepo(name);
    if (npmSlug) return npmSlug;
    if (name.startsWith('@')) return null; // scoped names are npm-only
    return this.resolvePypiRepo(name);
  }

  async resolveNpmRepo(pkg) {
    try {
      const encoded = pkg.replace('/', '%2F'); // @scope/name -> @scope%2Fname
      const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
        headers: { 'User-Agent': 'AI-Intelligence-Hub/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const repo = data.repository;
      const url = typeof repo === 'string' ? repo : repo && repo.url;
      return this.repoSlugFromUrl(url);
    } catch {
      return null;
    }
  }

  async resolvePypiRepo(pkg) {
    try {
      const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
        headers: { 'User-Agent': 'AI-Intelligence-Hub/1.0' },
      });
      if (!res.ok) return null;
      const info = (await res.json()).info || {};
      const candidates = Object.values(info.project_urls || {});
      if (info.home_page) candidates.push(info.home_page);
      for (const url of candidates) {
        const slug = this.repoSlugFromUrl(url);
        if (slug) return slug;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Extract "owner/repo" from any GitHub URL form (https, git+, ssh). */
  repoSlugFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (!m) return null;
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, '');
    if (!owner || !repo || repo === '.' || repo === '..') return null;
    return `${owner}/${repo}`;
  }

  /** Relevance for a repo that IS a declared dependency — forced strong match. */
  buildDependencyRelevance(repoData, analysis, sources) {
    const matchedProjects = sources.map((s) => ({
      id: s.id, name: s.name,
      overlap: 10.0, // a confirmed direct dependency is the strongest signal
      sharedDeps: [s.dep], sharedTopics: [],
      specificDeps: [s.dep], genericDeps: [],
      specificTopics: [], genericTopics: [],
    }));
    const daysSinceCreation = Math.max(
      1, (Date.now() - new Date(repoData.created_at).getTime()) / 86400000,
    );
    const starVelocity = repoData.stargazers_count / daysSinceCreation;
    const recencyScore = this.getRecencyMultiplier(repoData.pushed_at);
    const readmeQuality = Math.min((analysis.readmeLength || 0) / 10000, 1);
    const score =
      10.0 +                                 // forced dependency overlap
      3.5 +                                  // dependency-backed strategy weight
      Math.min(starVelocity, 10) * 2.0 +
      recencyScore * 10.0 +
      readmeQuality * 0.5;
    const names = [...new Set(sources.map((s) => s.name))].join(', ');
    const deps = [...new Set(sources.map((s) => s.dep))].join(', ');
    return {
      score,
      matchedProjects,
      matchReason: `Direct dependency of ${names} (${deps})`,
    };
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
      const projectDeps = new Set((project.scoringDependencies || project.dependencies || []).map((d) => d.toLowerCase()));
      const projectTopics = new Set((project.topics || []).map((t) => t.toLowerCase()));
      const repoTopics = (repoData.topics || []).map((t) => t.toLowerCase());

      // Per-project override: topics in `topics_as_specific` opt OUT of the BROAD_TOPICS
      // demotion. claude-ecosystem uses this so claude-code/mcp/rag count as specific (5x)
      // for that project, while staying generic (0.3x) for everyone else.
      const projectAsSpecific = new Set(
        (project.topics_as_specific || []).map((t) => t.toLowerCase()),
      );
      const isBroadFor = (t) => BROAD_TOPICS.has(t) && !projectAsSpecific.has(t);

      const specificDeps = analysis.dependencies.filter((d) => projectDeps.has(d) && !isGenericDep(d));
      const genericDeps = analysis.dependencies.filter((d) => projectDeps.has(d) && isGenericDep(d));
      const specificTopics = repoTopics.filter((t) => projectTopics.has(t) && !isBroadFor(t));
      const genericTopics = repoTopics.filter((t) => projectTopics.has(t) && isBroadFor(t));

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

    // Credit the project whose own targeted searchQuery surfaced this repo,
    // even when dependency/topic overlap is zero. A repo found by a project's
    // domain query (e.g. "hebrew nlp llm") IS relevant to that project — but
    // many such repos share none of its npm/PyPI deps. Without this, the
    // tech-stack strategy searches per-project queries yet the repo never gets
    // tagged to the project that searched for it. Weaker signal than a real
    // dep/topic match, so a modest overlap.
    if (
      queryInfo.projectId &&
      !matchedProjects.some((p) => p.id === queryInfo.projectId)
    ) {
      // 6.0 ≈ one shared specific dependency — a repo surfaced by a project's
      // own domain query ranks alongside a single-key-dep match, above the
      // long tail of repos that merely share one common library.
      const QUERY_OVERLAP = 6.0;
      matchedProjects.push({
        id: queryInfo.projectId,
        name: queryInfo.projectName || queryInfo.projectId,
        overlap: QUERY_OVERLAP,
        sharedDeps: [], sharedTopics: [],
        specificDeps: [], genericDeps: [],
        specificTopics: [], genericTopics: [],
        viaQuery: queryInfo.query || null,
      });
      if (maxOverlap < QUERY_OVERLAP) maxOverlap = QUERY_OVERLAP;
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
      matchReason = formatMatchReason(best, { projectName: best.name });
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

  /**
   * Record a repo that matched a PROJECT and no INSTRUMENT. Same shape as
   * `HuggingFaceModule#_recordNearMiss` and the same store - a `package`/
   * `service` gap is exactly as much the corpus for the next slot as a
   * dataset one, and `modules/ground-truth.js` reads both without caring
   * which feed wrote them.
   */
  _recordSlotNearMiss({ itemId, facts, matched, slots, title, url }) {
    if (!this.nearMissStore || slots.length || !matched.length) return;
    const projects = this.loadProjects().projects || [];
    const reason = slotGate.slotMissReason(facts, projects);
    if (!reason) return;
    const seen_at = new Date().toISOString();
    for (const project of matched) {
      try {
        this.nearMissStore.record({ item_id: itemId, project: project.id, kind: 'repo', reason, title, url, seen_at });
      } catch (_) {
        // never load-bearing
      }
    }
  }

  normalizeRepo(repoData, analysis, relevance, queryInfo) {
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(repoData.created_at).getTime()) / 86400000);
    const id = `${repoData.owner.login}-${repoData.name}`;
    // Which of OUR INSTRUMENTS can this repo actually grade? A `package`/
    // `service` slot is filled by a repo the same way a `ground-truth`/
    // `model` slot is filled by an HF dataset/model - see modules/slot-gate.js.
    const projects = this.loadProjects().projects || [];
    const facts = slotGate.slotFactsFromGithub(repoData);
    const slots = slotGate.matchSlots(facts, projects);
    this._recordSlotNearMiss({
      itemId: id, facts, matched: relevance.matchedProjects, slots,
      title: repoData.full_name, url: repoData.html_url,
    });
    return this.normalize({
      id,
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
        created_at: repoData.created_at, // for rising-star detection in weekly digest
        fork: !!repoData.fork,
        archived: !!repoData.archived,
        // Which INSTRUMENT this repo can grade, not merely which project it is
        // about (`matched_projects` above is a topic/dependency overlap). Empty
        // is the common and correct case; a repo matching a project but no slot
        // is the near-miss this method just recorded, not a defect.
        matched_slots: slots,
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
