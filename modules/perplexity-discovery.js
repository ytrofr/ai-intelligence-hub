/**
 * Perplexity Weekly Discovery Module
 *
 * Once-a-week catch-all: ask Perplexity to surface notable Claude/agent/MCP
 * repos with significant activity in the last 7 days. Star counts in
 * Perplexity's response are unreliable — every returned repo is verified
 * against the GitHub API before upsert.
 *
 * Graceful-degrade: PERPLEXITY_API_KEY missing -> warn + return [].
 */
const BaseModule = require('./base-module');
const fs = require('fs');
const path = require('path');

class PerplexityWeeklyModule extends BaseModule {
  loadProjects() {
    const filePath = path.join(__dirname, '..', 'config', 'projects.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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

  parseResponse(text) {
    if (!text) return [];
    // Strip ```json ... ``` fences if present
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenced ? fenced[1] : text;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.repos)) return parsed.repos;
      if (Array.isArray(parsed.items)) return parsed.items;
      return [];
    } catch (err) {
      console.warn(`  [perplexity] JSON parse failed: ${err.message}`);
      return [];
    }
  }

  async verifyRepo(slug, headers) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)) return null;
    try {
      const res = await fetch(`https://api.github.com/repos/${slug}`, { headers });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async fetch() {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      console.warn('  [perplexity] PERPLEXITY_API_KEY not set — skipping channel');
      return [];
    }

    const projectId = this.config.project_id || 'claude-ecosystem';
    const { projects } = this.loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (!project || !project.perplexity_prompt) {
      console.warn(`  [perplexity] no prompt for project ${projectId}; skipping`);
      return [];
    }

    const model = this.config.model || 'sonar';
    const maxItems = this.config.max_items || 30;

    const body = {
      model,
      messages: [
        { role: 'system', content: 'Return ONLY a JSON array. No prose. No markdown fences.' },
        { role: 'user', content: project.perplexity_prompt },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    };

    let res;
    try {
      res = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn(`  [perplexity] network error: ${err.message}`);
      return [];
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`  [perplexity] HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return [];
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content || '';
    const usage = json?.usage || {};
    // Sonar pricing approx: $0.001/1K input + $0.001/1K output (cheap)
    const costEst =
      ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)) / 1000 * 0.001;
    console.log(
      `  [perplexity] tokens: ${usage.prompt_tokens || 0}+${usage.completion_tokens || 0}, est cost: $${costEst.toFixed(4)}`
    );

    const items = this.parseResponse(text).slice(0, maxItems);
    if (items.length === 0) {
      console.warn('  [perplexity] no items parsed from response');
      return [];
    }

    // Verify each repo against real GitHub API — Perplexity hallucinates star counts
    const headers = this.githubHeaders();
    const verified = [];
    for (const item of items) {
      const slug = (item.repo || item.name || '').replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const repoData = await this.verifyRepo(slug, headers);
      if (!repoData) {
        console.warn(`  [perplexity] could not verify: ${slug}`);
        continue;
      }
      const stars = repoData.stargazers_count || 0;
      if (stars < 200) continue; // floor: even rising-stars need ≥200
      const createdMs = new Date(repoData.created_at).getTime();
      const ageDays = (Date.now() - createdMs) / 86400000;
      const isRising = stars >= 200 && stars < 1000 && ageDays <= 90;
      const isEstablished = stars >= 1000;
      if (!isRising && !isEstablished) continue;

      verified.push(
        this.normalize({
          id: `${repoData.owner.login}-${repoData.name}`,
          title: repoData.full_name,
          url: repoData.html_url,
          description: repoData.description || item.summary || '',
          author: repoData.owner?.login,
          stars,
          score: 5.0 + (isEstablished ? 2.0 : 0) + (isRising ? 3.0 : 0),
          published_at: repoData.pushed_at,
          metadata: {
            discovery_strategy: 'perplexity',
            search_query: 'perplexity-weekly',
            match_reason: item.summary || 'Surfaced by Perplexity weekly catch-all',
            category_hint: item.category || 'other',
            language: repoData.language,
            forks: repoData.forks_count,
            topics: repoData.topics || [],
            star_velocity: stars / Math.max(1, ageDays),
            open_issues: repoData.open_issues_count,
            created_at: repoData.created_at,
            perplexity_summary: item.summary,
            cost_usd: costEst / verified.length, // rough per-item attribution after the fact
          },
        }),
      );
      // Light pacing — github API is generous but be polite
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`  [perplexity] ${verified.length} verified repos (from ${items.length} candidates)`);
    return verified;
  }
}

module.exports = PerplexityWeeklyModule;
