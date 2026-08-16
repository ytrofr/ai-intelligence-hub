/**
 * GitHub Module - Fetch trending repositories
 */

const BaseModule = require("./base-module");
const { fetchJson } = require("./http");

class GitHubModule extends BaseModule {
  /**
   * One search per topic. A topic that fails is collected; if EVERY topic
   * fails the source throws (dead / network down); partial failure warns.
   */
  async fetch() {
    const topics = this.config.topics || ["ai", "llm", "claude", "anthropic"];
    const headers = { Accept: "application/vnd.github.v3+json" };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
    }
    const failures = [];

    const topicResults = await Promise.all(
      topics.map(async (topic) => {
        try {
          const url = `https://api.github.com/search/repositories?q=topic:${topic}&sort=stars&order=desc&per_page=20`;
          const data = await fetchJson(url, { headers, timeoutMs: this.config.timeout_ms || 45000 });
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
          failures.push(`${topic}: ${err.message}`);
          return [];
        }
      }),
    );
    if (failures.length === topics.length) {
      throw new Error(`All ${topics.length} GitHub topic searches failed - ${failures[0]}`);
    }
    if (failures.length) console.warn(`GitHub: ${failures.length}/${topics.length} topics failed: ${failures.join("; ")}`);
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
