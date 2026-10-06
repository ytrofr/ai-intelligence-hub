/**
 * Theme tagger. The negative space matters as much as the hits: every theme
 * gets a MUST-FIRE case written the way real repos phrase it (hyphenated
 * names, plural topics), and the known false-hit shapes are pinned as
 * must-NOT-fire.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { matchThemes, compileThemes, loadThemes, keywordRegex } = require("../modules/themes");

const SHIPPED = loadThemes({ projectsPath: "/nonexistent/projects.json" });
const C = compileThemes(SHIPPED);
const tag = (name, description = "", topics = []) => matchThemes({ name, description, topics }, C);
const has = (r, id) => r.includes(id);

test("shipped taxonomy: 15 themes, each with label, topics, keywords and 2 queries; projects[] empty in the public file", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "themes.json"), "utf8")).themes;
  assert.equal(raw.length, 15);
  const ids = raw.map((t) => t.id);
  assert.equal(new Set(ids).size, 15);
  assert.ok(!ids.includes("other"), "'other' is the tagger's fallback, not a configured theme");
  for (const t of raw) {
    assert.ok(t.label && t.topics.length && t.keywords.length, t.id);
    assert.equal(t.queries.length, 2, `${t.id} queries`);
    assert.deepEqual(t.projects, [], `${t.id}: project ids belong in the gitignored projects.json`);
  }
});

test("MUST-FIRE: one real-shaped repo per theme", () => {
  const cases = [
    ["agentic-ai", "Agent-Reach", "Give your AI agents eyes to see the internet"],
    ["coding-agents", "openrig", "Build your own network of agents from Claude Code, Codex and Pi"],
    ["browser-computer-use", "browser-use", "Make websites accessible for AI agents"],
    ["agent-memory", "cognee", "Memory for AI Agents in 6 lines of code", ["agent-memory"]],
    ["llm-observability", "openllmetry", "Open-source observability for your LLM application, based on OpenTelemetry"],
    ["evals", "promptfoo", "Test your prompts, agents, and RAGs. Red teaming and LLM evaluation"],
    ["llm-gateways-routers", "litellm", "Python SDK, Proxy Server (LLM Gateway) to call 100+ LLM APIs"],
    ["small-models-inference", "llama.cpp", "LLM inference in C/C++"],
    ["rag-retrieval", "PageIndex", "Document index for vectorless, reasoning-based RAG"],
    ["web-ui-generation", "screenshot-to-code", "Drop in a screenshot and convert it to clean code"],
    ["video-generation", "hyperframes", "Write HTML. Render video. Built for agents."],
    ["ads-seo-aeo", "seo-machine", "Answer engine optimization and SEO audits"],
    ["chat-bots-whatsapp", "whatsapp-web.js", "A WhatsApp client library for NodeJS"],
    ["text-to-sql-bi", "vanna", "Chat with your SQL database. Text-to-SQL generation via LLMs"],
    ["hebrew-rtl", "hebrew-nlp", "Tools for Hebrew text processing, RTL aware"],
  ];
  for (const [id, name, desc, topics] of cases) {
    assert.ok(has(tag(name, desc, topics || []), id), `${id} must fire on ${name}: got ${tag(name, desc, topics || [])}`);
  }
});

test("topics match by exact equality even with no keyword in the text", () => {
  assert.deepEqual(tag("zzz", "", ["text-to-sql"]), ["text-to-sql-bi"]);
  assert.ok(has(tag("zzz", "", ["ai-agents"]), "agentic-ai"));
});

test("hyphen/underscore/space variants and plurals of a multi-word keyword all match", () => {
  assert.ok(has(tag("ai-agents-kit"), "agentic-ai") === false, "a compound NAME is one word: 'ai-agents-kit' is not 'ai agent'");
  assert.ok(has(tag("x", "", ["ai-agents"]), "agentic-ai"));
  assert.ok(has(tag("x", "a toolkit for ai_agent workflows"), "agentic-ai"));
  assert.ok(has(tag("x", "Natural-language to SQL"), "text-to-sql-bi"));
  assert.ok(has(tag("x", "fast rerankers for search"), "rag-retrieval"));
});

test("MUST-NOT-FIRE: substring and compound false hits", () => {
  // 'sql' inside nosql / mysql, and the nosql-lite compound
  assert.ok(!has(tag("nosql-lite", "A tiny NoSQL store, mysql compatible"), "text-to-sql-bi"));
  // 'agent' inside user-agent (HTTP header), and agents as a substring of other words
  assert.deepEqual(tag("user-agent-parser", "Parse the User-Agent header string"), ["other"]);
  assert.ok(!has(tag("reagent", "chemistry reagents inventory"), "agentic-ai"));
  // 'rag' inside fragment / drag / storage
  assert.deepEqual(tag("drag-fragment", "Drag and drop fragments with storage"), ["other"]);
  // 'seo' inside seoul, 'rtl' inside ortl, 'video' inside videos-free words
  assert.deepEqual(tag("seoul-bus", "Seoul bus arrival times"), ["other"]);
  // 'eval' inside medieval
  assert.deepEqual(tag("medieval-maps", "Medieval cartography"), ["other"]);
  // docker swarm and cursor pagination are not themes
  assert.deepEqual(tag("swarm-deploy", "Deploy to Docker Swarm with cursor pagination"), ["other"]);
  // an owner named like a product does not tag the repo
  assert.deepEqual(matchThemes({ name: "cursor/plugins", description: "plugin specification" }, C), ["other"]);
});

test("a repo can carry several themes; nothing matched means ['other'], never []", () => {
  const multi = tag("claude-mem", "Persistent memory layer for Claude Code coding agents");
  assert.ok(has(multi, "coding-agents") && has(multi, "agent-memory"), String(multi));
  assert.deepEqual(tag("", ""), ["other"]);
  assert.deepEqual(matchThemes(null, C), ["other"]);
});

test("keywordRegex escapes regex metacharacters (llama.cpp is a literal dot)", () => {
  assert.ok(keywordRegex("llama.cpp").test("built on llama.cpp"));
  assert.ok(!keywordRegex("llama.cpp").test("built on llamaxcpp"));
});

test("loadThemes builds projects[] from `themes` on each private profile, nothing else", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "themes-"));
  const pj = path.join(dir, "projects.json");
  fs.writeFileSync(
    pj,
    JSON.stringify({
      projects: [
        { id: "apollo", themes: ["evals", "rag-retrieval", "no-such-theme"] },
        { id: "atlas", themes: ["evals"] },
        { id: "vega" },
      ],
    })
  );
  const t = Object.fromEntries(loadThemes({ projectsPath: pj }).map((x) => [x.id, x.projects]));
  assert.deepEqual(t.evals, ["apollo", "atlas"]);
  assert.deepEqual(t["rag-retrieval"], ["apollo"]);
  assert.deepEqual(t["hebrew-rtl"], []);
  // object-shaped projects.json is read too
  fs.writeFileSync(pj, JSON.stringify({ projects: { lyra: { themes: ["hebrew-rtl"] } } }));
  assert.deepEqual(loadThemes({ projectsPath: pj }).find((x) => x.id === "hebrew-rtl").projects, ["lyra"]);
  // an unreadable file leaves projects[] empty rather than throwing
  assert.ok(loadThemes({ projectsPath: path.join(dir, "missing.json") }).every((x) => x.projects.length === 0));
  fs.rmSync(dir, { recursive: true, force: true });
});
