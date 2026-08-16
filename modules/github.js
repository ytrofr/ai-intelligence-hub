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
  /**
   * Two windows per topic so "trending" means something:
   *   active = pushed within `active_days` (default 7), sorted by stars
   *   new    = created within `new_days`   (default 30), sorted by stars
   * (was: all-time stars per topic - openai/whisper forever)
   */
  async fetch() {
    const topics = this.config.topics || ["ai", "llm", "claude", "anthropic"];
    const headers = { Accept: "application/vnd.github.v3+json" };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
    }
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().split("T")[0];
    const windows = [
      { key: "active", q: `pushed:>${day(this.config.active_days || 7)}` },
      { key: "new", q: `created:>${day(this.config.new_days || 30)}` },
    ];
    const jobs = topics.flatMap((topic) => windows.map((w) => ({ topic, ...w })));
    const failures = [];

    const topicResults = await Promise.all(
      jobs.map(async ({ topic, key, q }) => {
        try {
          const query = encodeURIComponent(`topic:${topic} ${q}`);
          const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=20`;
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
                window: key,
                fork: !!repo.fork,
                archived: !!repo.archived,
                created_at: repo.created_at,
              },
            }),
          );
        } catch (err) {
          failures.push(`${topic}/${key}: ${err.message}`);
          return [];
        }
      }),
    );
    if (failures.length === jobs.length) {
      throw new Error(`All ${jobs.length} GitHub topic searches failed - ${failures[0]}`);
    }
    if (failures.length) console.warn(`GitHub: ${failures.length}/${jobs.length} searches failed: ${failures.join("; ")}`);
    // A repo can appear in both windows - keep one row, prefer "new"
    const byId = new Map();
    for (const item of topicResults.flat()) {
      const prev = byId.get(item.id);
      if (!prev || item.metadata.window === "new") byId.set(item.id, item);
    }
    return [...byId.values()];
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
