const test = require("node:test");
const assert = require("node:assert/strict");
const MCPRegistryModule = require("../modules/mcp-registry");

const cfg = { id: "mcp-registry", name: "MCP", type: "mcp", url: "https://registry.example/v0/servers", config: {} };
const entry = (over = {}) => ({
  server: {
    name: "io.github.acme/thing",
    title: "Thing",
    description: "Does things",
    version: "1.2.3",
    repository: { url: "https://github.com/acme/thing", source: "github" },
    remotes: [{ type: "streamable-http", url: "https://x" }],
    ...over,
  },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, updatedAt: "2026-08-01T00:00:00Z" } },
});

test("mapServer maps an official registry entry to a hub item", () => {
  const m = new MCPRegistryModule(cfg);
  const item = m.mapServer(entry());
  assert.equal(item.url, "https://github.com/acme/thing");
  assert.match(item.title, /Thing/);
  assert.equal(item.published_at, "2026-08-01T00:00:00Z");
  assert.equal(item.metadata.type, "mcp-server");
  assert.deepEqual(item.metadata.remotes, ["streamable-http"]);
});

test("mapServer skips entries with neither repository nor website", () => {
  const m = new MCPRegistryModule(cfg);
  assert.equal(m.mapServer(entry({ repository: undefined, websiteUrl: undefined })), null);
});

test("no fallback data: a failing registry fetch throws (never 5 fake servers)", async () => {
  const m = new MCPRegistryModule({ ...cfg, url: "http://127.0.0.1:9/v0/servers", config: { timeout_ms: 500 } });
  await assert.rejects(m.fetch());
  assert.equal(typeof m.fetchFallback, "undefined");
});
