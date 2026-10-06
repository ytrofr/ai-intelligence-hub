/**
 * GitHub Module - Fetch trending repositories (topic search, two windows)
 */

const BaseModule = require("./base-module");
const { searchRepos, searchBucket, searchDeadline, settleSearchRun, ghHeaders } = require("./github-theme-search");

class GitHubModule extends BaseModule {
  constructor(config) {
    super(config);
    this.deps = config.deps || {};
  }

  /**
   * Two windows per topic so "trending" means something:
   *   active = pushed within `active_days` (default 7), sorted by stars
   *   new    = created within `new_days`   (default 30), sorted by stars
   * (was: all-time stars per topic - openai/whisper forever)
   *
   * The searches run ONE AT A TIME through the process-wide search bucket
   * (modules/github-theme-search.js). They used to fire all 12 in parallel,
   * draining GitHub's 30/min search minute just before tech-stack needed it.
   * A search that fails is collected; executed < planned -> `partial`
   * (items kept), nothing executed -> throw.
   */
  async fetch() {
    const topics = this.config.topics || ["ai", "llm", "claude", "anthropic"];
    const clock = this.deps.clock || Date.now;
    const day = (n) => new Date(clock() - n * 86400000).toISOString().split("T")[0];
    const windows = [
      { key: "active", q: `pushed:>${day(this.config.active_days || 7)}` },
      { key: "new", q: `created:>${day(this.config.new_days || 30)}` },
    ];
    const jobs = topics.flatMap((topic) => windows.map((w) => ({ topic, ...w })));
    const timeoutMs = this.config.timeout_ms || 45000;
    const budgetMs = this.config.budget_ms || 120000;
    const opts = {
      perPage: 20,
      deadline: searchDeadline({ budgetMs, startedAt: clock(), marginMs: Math.min(timeoutMs + 5000, budgetMs / 2) }),
      bucket: this.deps.bucket || searchBucket,
      headers: ghHeaders(),
      timeoutMs,
      ...(this.deps.fetchRes ? { fetchRes: this.deps.fetchRes } : {}),
    };
    const failures = [];
    const topicResults = [];
    let executed = 0;

    for (let i = 0; i < jobs.length; i++) {
      const { topic, key, q } = jobs[i];
      let r;
      try {
        r = await searchRepos(`topic:${topic} ${q}`, opts);
      } catch (err) {
        failures.push(`${topic}/${key}: ${err.message}`);
        continue;
      }
      if (r.status === "deferred") {
        failures.unshift(`budget: ${jobs.length - i} searches left, next search slot only at ${new Date(r.readyAt).toISOString()}`);
        break;
      }
      executed += 1;
      topicResults.push(
        ((r.data && r.data.items) || []).map((repo) =>
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
        ),
      );
    }
    // A repo can appear in both windows - keep one row, prefer "new"
    const byId = new Map();
    for (const item of topicResults.flat()) {
      const prev = byId.get(item.id);
      if (!prev || item.metadata.window === "new") byId.set(item.id, item);
    }
    const items = [...byId.values()];
    console.log(`GitHub: executed ${executed} / planned ${jobs.length} topic searches · ${items.length} repos`);
    if (failures.length) console.warn(`GitHub: not executed: ${failures.join("; ")}`);
    this.runReport = { executed, planned: jobs.length, repos: items.length };
    return settleSearchRun({ label: "github", items, executed, planned: jobs.length, notes: failures, report: this.runReport });
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
