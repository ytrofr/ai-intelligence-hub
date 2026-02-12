/**
 * GitHub Module - Fetch trending repositories
 */

const BaseModule = require("./base-module");

class GitHubModule extends BaseModule {
  async fetch() {
    const topics = this.config.topics || ["ai", "llm", "claude", "anthropic"];
    const items = [];

    for (const topic of topics) {
      try {
        const url = `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=20`;
        const res = await fetch(url, {
          headers: {
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "AI-Intelligence-Hub/1.0",
          },
        });

        if (!res.ok) continue;
        const data = await res.json();

        for (const repo of data.items || []) {
          items.push(
            this.normalize({
              id: repo.id.toString(),
              title: repo.full_name,
              url: repo.html_url,
              description: repo.description,
              author: repo.owner?.login,
              stars: repo.stargazers_count,
              score: this.calculateScore(repo),
              published_at: repo.pushed_at,
              metadata: {
                language: repo.language,
                forks: repo.forks_count,
                topics: repo.topics,
                open_issues: repo.open_issues_count,
              },
            }),
          );
        }

        // Small delay between requests
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        console.error(`GitHub fetch error for topic ${topic}:`, err.message);
      }
    }

    return items;
  }

  calculateScore(repo) {
    const stars = repo.stargazers_count || 0;
    const forks = repo.forks_count || 0;
    const recency = this.getRecencyScore(repo.pushed_at);
    return Math.round((stars * 1.0 + forks * 2.0) * recency);
  }

  getRecencyScore(dateStr) {
    if (!dateStr) return 0.5;
    const days =
      (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1) return 1.5;
    if (days < 7) return 1.2;
    if (days < 30) return 1.0;
    return 0.8;
  }
}

module.exports = GitHubModule;
