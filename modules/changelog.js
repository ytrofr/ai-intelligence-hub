/**
 * Changelog Module - Fetch Claude Code releases and docs changes
 */

const BaseModule = require("./base-module");

class ChangelogModule extends BaseModule {
  async fetch() {
    const mode = this.config.mode || "releases";
    if (mode === "releases") return this.fetchReleases();
    if (mode === "docs") return this.fetchDocs();
    return [];
  }

  /**
   * GitHub API headers with optional token for higher rate limits
   */
  githubHeaders() {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "AI-Intelligence-Hub/1.0",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /**
   * Mode: releases - GitHub Releases API (newest first)
   */
  async fetchReleases() {
    const maxItems = this.config.max_items || 30;
    const url = `${this.url}?per_page=${maxItems}`;
    const res = await fetch(url, { headers: this.githubHeaders() });

    if (!res.ok) {
      console.error(`Changelog releases fetch error: ${res.status}`);
      return [];
    }

    const releases = await res.json();

    // Sort newest first (API usually does this, but be explicit)
    releases.sort(
      (a, b) => new Date(b.published_at) - new Date(a.published_at),
    );

    return releases.map((release) => {
      const body = release.body || "";
      const changes = this.parseChanges(body);
      const plainText = this.stripMarkdown(body);

      return this.normalize({
        id: release.tag_name || release.id.toString(),
        title: `Claude Code ${release.tag_name || release.name}`,
        url: release.html_url,
        description: plainText.substring(0, 500),
        author: "anthropic",
        published_at: release.published_at,
        score: this.recencyScore(release.published_at),
        metadata: {
          version: (release.tag_name || "").replace(/^v/, ""),
          type: "release",
          change_count: changes.length,
          changes: changes.slice(0, 10),
          prerelease: release.prerelease,
        },
      });
    });
  }

  /**
   * Mode: docs - Fetch all documentation files from Claude Code repo
   * Uses GitHub Commits API for real last-modified dates per file
   */
  async fetchDocs() {
    const headers = this.githubHeaders();

    // Get latest release version for context (1 API call)
    const latestVersion = await this.getLatestVersion(headers);

    // Get repo tree to find all .md files (1 API call)
    const treeRes = await fetch(`${this.url}?recursive=1`, { headers });
    if (!treeRes.ok) {
      console.error(`Docs tree fetch error: ${treeRes.status}`);
      return [];
    }

    const tree = await treeRes.json();
    const treeSha = tree.sha;
    const mdFiles = (tree.tree || []).filter(
      (f) =>
        f.type === "blob" &&
        f.path.endsWith(".md") &&
        f.path !== "CHANGELOG.md" &&
        f.path !== "LICENSE.md" &&
        f.size > 200,
    );

    const maxItems = this.config.max_items || 100;
    const items = [];
    let rateLimitRemaining = 100; // Assume OK until told otherwise

    for (const file of mdFiles.slice(0, maxItems)) {
      try {
        // Fetch raw content (CDN, no API rate limit)
        const rawUrl = `https://raw.githubusercontent.com/anthropics/claude-code/main/${file.path}`;
        const res = await fetch(rawUrl, {
          headers: { "User-Agent": "AI-Intelligence-Hub/1.0" },
        });
        if (!res.ok) continue;

        const content = await res.text();
        const title = this.extractTitle(content, file.path);
        const description = this.stripMarkdown(content).substring(0, 500);
        const sections = this.extractSections(content);
        const category = this.categorizeDoc(file.path);

        // Get real last-modified date from GitHub Commits API
        // Stop making API calls if we're running low on rate limit
        let lastModifiedAt = null;
        let lastCommitMsg = null;
        if (rateLimitRemaining > 10) {
          const commitInfo = await this.getFileLastCommit(file.path, headers);
          if (commitInfo) {
            if (commitInfo.rateLimitRemaining !== undefined) {
              rateLimitRemaining = commitInfo.rateLimitRemaining;
            }
            lastModifiedAt = commitInfo.date;
            lastCommitMsg = commitInfo.message;
          }
        }

        items.push(
          this.normalize({
            id: file.path,
            title,
            url: `https://github.com/anthropics/claude-code/blob/main/${file.path}`,
            description,
            author: "anthropic",
            published_at: lastModifiedAt || new Date().toISOString(),
            score: this.docScore(file.path, file.size),
            metadata: {
              type: "docs",
              category,
              file_path: file.path,
              size_bytes: file.size,
              section_count: sections.length,
              sections: sections.slice(0, 10),
              blob_sha: file.sha,
              last_modified_at: lastModifiedAt,
              last_commit_message: lastCommitMsg,
              fetched_at_version: latestVersion,
              tree_sha: treeSha,
            },
          }),
        );

        // Small delay between requests
        await new Promise((r) => setTimeout(r, 150));
      } catch (err) {
        console.error(`Doc fetch error for ${file.path}:`, err.message);
      }
    }

    const withDates = items.filter((i) => i.metadata?.last_modified_at).length;
    console.log(
      `  Docs: ${items.length} files, ${withDates} with commit dates (rate limit remaining: ${rateLimitRemaining})`,
    );

    return items;
  }

  /**
   * Get the latest Claude Code release version
   */
  async getLatestVersion(headers) {
    try {
      const res = await fetch(
        "https://api.github.com/repos/anthropics/claude-code/releases?per_page=1",
        { headers },
      );
      if (!res.ok) return null;
      const releases = await res.json();
      return releases[0]?.tag_name?.replace(/^v/, "") || null;
    } catch {
      return null;
    }
  }

  /**
   * Get the last commit that touched a specific file
   * Returns { date, message, sha, rateLimitRemaining } or null
   */
  async getFileLastCommit(filePath, headers) {
    try {
      const url = `https://api.github.com/repos/anthropics/claude-code/commits?path=${encodeURIComponent(filePath)}&per_page=1`;
      const res = await fetch(url, { headers });

      const remaining = parseInt(res.headers.get("x-ratelimit-remaining"), 10);

      if (res.status === 403 || res.status === 429) {
        console.warn(`  GitHub rate limit hit (remaining: ${remaining})`);
        return { rateLimitRemaining: 0 };
      }
      if (!res.ok) return null;

      const commits = await res.json();
      if (!commits.length) return null;

      return {
        date: commits[0].commit.author.date,
        message: commits[0].commit.message.split("\n")[0].substring(0, 100),
        sha: commits[0].sha.substring(0, 8),
        rateLimitRemaining: isNaN(remaining) ? 100 : remaining,
      };
    } catch {
      return null;
    }
  }

  /**
   * Extract title from markdown content or file path
   */
  extractTitle(content, filePath) {
    // Try first h1 heading
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // Try YAML frontmatter name
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    if (nameMatch) return nameMatch[1].trim();

    // Fall back to file path
    const parts = filePath.replace(/\.md$/, "").split("/");
    return parts[parts.length - 1]
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Extract section headings from markdown
   */
  extractSections(content) {
    return content
      .split("\n")
      .filter((line) => /^#{2,3}\s+/.test(line))
      .map((line) => line.replace(/^#{2,3}\s+/, "").trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Categorize a doc file by its path
   */
  categorizeDoc(filePath) {
    if (filePath.startsWith("plugins/")) {
      const plugin = filePath.split("/")[1];
      if (filePath.includes("/skills/")) return `plugin/${plugin}/skill`;
      if (filePath.includes("/agents/")) return `plugin/${plugin}/agent`;
      if (filePath.includes("/commands/")) return `plugin/${plugin}/command`;
      return `plugin/${plugin}`;
    }
    if (filePath.startsWith("examples/")) return "example";
    if (filePath === "README.md") return "overview";
    if (filePath === "SECURITY.md") return "security";
    return "docs";
  }

  /**
   * Score docs by importance (READMEs and top-level docs rank higher)
   */
  docScore(filePath, size) {
    let score = 50;
    if (filePath === "README.md") score = 150;
    else if (filePath.endsWith("README.md")) score = 100;
    else if (filePath.includes("SKILL.md")) score = 90;
    else if (filePath.includes("/commands/")) score = 85;
    else if (filePath.includes("/agents/")) score = 80;
    // Larger files tend to have more content
    if (size > 10000) score += 20;
    else if (size > 5000) score += 10;
    return score;
  }

  /**
   * Extract bullet points from markdown release body
   */
  parseChanges(markdown) {
    return markdown
      .split("\n")
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Strip markdown formatting to plain text
   */
  stripMarkdown(md) {
    return md
      .replace(/#{1,6}\s+/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n{2,}/g, " ")
      .replace(/\n/g, " ")
      .trim();
  }

  /**
   * Score based on recency (newer = higher)
   */
  recencyScore(dateStr) {
    if (!dateStr) return 50;
    const days =
      (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1) return 200;
    if (days < 7) return 150;
    if (days < 30) return 100;
    if (days < 90) return 70;
    return 50;
  }
}

module.exports = ChangelogModule;
