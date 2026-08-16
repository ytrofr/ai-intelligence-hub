/**
 * MCP Registry Module - official Model Context Protocol registry
 * https://registry.modelcontextprotocol.io/v0/servers  (JSON, cursor-paginated)
 *
 * No fallback data: if the registry is unreachable this THROWS and the fetch
 * runner records the error. An honest empty/error beats 5 invented servers
 * (the previous glama.ai URL returns HTML and had been serving a hardcoded
 * fallback on every run since it changed).
 */

const BaseModule = require("./base-module");
const { fetchJson } = require("./http");

const OFFICIAL_META = "io.modelcontextprotocol.registry/official";

class MCPRegistryModule extends BaseModule {
  async fetch() {
    const limit = Math.min(this.config.max_items || 100, 100);
    const pages = Math.max(1, Math.min(this.config.max_pages || 3, 10));
    const timeoutMs = this.config.timeout_ms || 20000;
    const items = [];
    let cursor = null;

    for (let page = 0; page < pages; page++) {
      const url = new URL(this.url);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("version", "latest");
      if (cursor) url.searchParams.set("cursor", cursor);
      const data = await fetchJson(url.toString(), { timeoutMs });
      const servers = Array.isArray(data.servers) ? data.servers : [];
      for (const entry of servers) {
        const item = this.mapServer(entry);
        if (item) items.push(item);
      }
      cursor = data.metadata && data.metadata.nextCursor;
      if (!cursor || servers.length === 0) break;
    }
    return items;
  }

  /** Map one registry entry to a hub item; null when it has no linkable URL. */
  mapServer(entry) {
    const server = entry.server || entry;
    const meta = (entry._meta && entry._meta[OFFICIAL_META]) || {};
    const repoUrl = server.repository && server.repository.url;
    const url = repoUrl || server.websiteUrl;
    if (!server.name || !url) return null;
    return this.normalize({
      id: server.name,
      title: server.title ? `${server.title} (${server.name})` : server.name,
      url,
      description: server.description || "",
      author: server.name.split("/")[0],
      stars: 0,
      score: meta.isLatest ? 60 : 40,
      published_at: meta.updatedAt || meta.publishedAt || null,
      metadata: {
        type: "mcp-server",
        registry: "modelcontextprotocol.io",
        version: server.version,
        status: meta.status,
        remotes: (server.remotes || []).map((r) => r.type),
        packages: (server.packages || []).map((p) => p.registryType || p.registry_type).filter(Boolean),
        repository: repoUrl || null,
        website: server.websiteUrl || null,
      },
    });
  }
}

module.exports = MCPRegistryModule;
