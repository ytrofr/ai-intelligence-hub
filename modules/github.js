/**
 * GitHub Module - Fetch trending repositories
 */

const BaseModule = require("./base-module");

class GitHubModule extends BaseModule {
  async fetch() {
    const topics = this.config.topics || ["ai", "llm", "claude", "anthropic"];
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AI-Intelligence-Hub/1.0",
    };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const topicResults = await Promise.all(
      topics.map(async (topic) => {
        try {
          const url = `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=20`;
          const res = await fetch(url, { headers });
          if (!res.ok) return [];
          const data = await res.json();
          return (data.items || []).map((repo) =>
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
        } catch (err) {
          console.error(`GitHub topic ${topic} error:`, err.message);
          return [];
        }
      }),
    );
    return topicResults.flat();
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
