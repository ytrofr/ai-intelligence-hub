/**
 * MCP Registry Module - Fetch MCP servers from glama.ai
 */

const BaseModule = require("./base-module");

class MCPRegistryModule extends BaseModule {
  async fetch() {
    const items = [];

    try {
      // Fetch from glama.ai MCP registry
      const res = await fetch("https://glama.ai/mcp/servers", {
        headers: {
          "User-Agent": "AI-Intelligence-Hub/1.0",
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        // Fallback: try fetching the HTML and parsing
        console.log("MCP JSON API not available, using fallback");
        return await this.fetchFallback();
      }

      const data = await res.json();
      const servers = data.servers || data || [];

      for (const server of servers) {
        items.push(
          this.normalize({
            id: server.id || server.name,
            title: `🔌 ${server.name}`,
            url:
              server.url ||
              server.repository ||
              `https://glama.ai/mcp/servers/${server.name}`,
            description: server.description,
            author: server.author,
            stars: server.stars || 0,
            score: (server.stars || 0) + (server.downloads || 0) / 10,
            published_at: server.updated_at || server.created_at,
            metadata: {
              type: "mcp-server",
              category: server.category,
              tools: server.tools,
            },
          }),
        );
      }
    } catch (err) {
      console.error("MCP Registry fetch error:", err.message);
      return await this.fetchFallback();
    }

    return items;
  }

  async fetchFallback() {
    // Hardcoded popular MCP servers as fallback
    const popularServers = [
      {
        name: "filesystem",
        desc: "File system operations",
        url: "https://github.com/anthropics/mcp-server-filesystem",
      },
      {
        name: "github",
        desc: "GitHub API integration",
        url: "https://github.com/anthropics/mcp-server-github",
      },
      {
        name: "postgres",
        desc: "PostgreSQL database access",
        url: "https://github.com/anthropics/mcp-server-postgres",
      },
      {
        name: "slack",
        desc: "Slack workspace integration",
        url: "https://github.com/anthropics/mcp-server-slack",
      },
      {
        name: "brave-search",
        desc: "Brave Search API",
        url: "https://github.com/anthropics/mcp-server-brave-search",
      },
    ];

    return popularServers.map((s, i) =>
      this.normalize({
        id: s.name,
        title: `🔌 ${s.name}`,
        url: s.url,
        description: s.desc,
        score: 100 - i * 10,
      }),
    );
  }
}

module.exports = MCPRegistryModule;
