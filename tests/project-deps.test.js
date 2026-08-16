const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readDeps, parseRequirements, parsePyproject, parsePnpmCatalog, mergeProjectDeps } = require("../modules/project-deps");

function fixtureTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-deps-"));
  const w = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w("pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - 'packages/*'\n\ncatalog:\n  # comment\n  typescript: ^6.0.3\n  '@types/node': ^25.9.1\n  fastify: ^5.0.0\n\ncatalogs:\n  react18:\n    react: ^18.3.1\n");
  w("package.json", JSON.stringify({ name: "root", devDependencies: { turbo: "^2", eslint: "catalog:" } }));
  w("apps/web/package.json", JSON.stringify({ name: "@repo/web", dependencies: { react: "catalog:react18", "@repo/api-types": "workspace:*", zod: "^4" } }));
  w("packages/api-types/package.json", JSON.stringify({ name: "@repo/api-types", dependencies: { zod: "^4" } }));
  w("apps/backend/requirements.txt", "# core\nfastapi>=0.110\nGoogle-ADK==1.2.0\nuvicorn[standard]>=0.30 ; python_version>='3.10'\n-r requirements-test.txt\n--index-url https://x\n");
  w("apps/backend/pyproject.toml", '[project]\nname = "backend"\ndependencies = [\n  "anthropic>=0.30",\n  "httpx[http2]>=0.27",\n]\n[project.optional-dependencies]\ndev = ["pytest>=8"]\n[tool.poetry.dependencies]\npython = "^3.11"\nredis = "^5"\n');
  w("node_modules/evil/package.json", JSON.stringify({ dependencies: { "should-not-appear": "1" } }));
  w("apps/web/node_modules/deep/package.json", JSON.stringify({ dependencies: { "nor-this": "1" } }));
  return root;
}

test("parseRequirements strips versions, extras, markers, options", () => {
  const out = parseRequirements("# core\nfastapi>=0.110\nGoogle-ADK==1.2.0\nuvicorn[standard]>=0.30 ; python_version>='3.10'\n-r other.txt\n--index-url https://x\n");
  assert.deepEqual(out, ["fastapi", "google-adk", "uvicorn"]);
});

test("parsePyproject reads PEP 621 + optional + poetry deps, drops python", () => {
  const out = parsePyproject('[project]\ndependencies = [\n  "anthropic>=0.30",\n  "httpx[http2]>=0.27",\n]\n[project.optional-dependencies]\ndev = ["pytest>=8"]\n[tool.poetry.dependencies]\npython = "^3.11"\nredis = "^5"\n');
  assert.deepEqual(out.sort(), ["anthropic", "httpx", "pytest", "redis"]);
});

test("parsePnpmCatalog returns catalog + named catalogs entries", () => {
  const out = parsePnpmCatalog("packages:\n  - 'apps/*'\ncatalog:\n  typescript: ^6\n  '@types/node': ^25\ncatalogs:\n  react18:\n    react: ^18\n");
  assert.deepEqual(out.sort(), ["@types/node", "react", "typescript"]);
});

test("readDeps walks the tree, skips node_modules, drops workspace-internal packages", () => {
  const root = fixtureTree();
  const deps = readDeps(root);
  for (const want of ["turbo", "eslint", "react", "zod", "typescript", "@types/node", "fastify", "fastapi", "google-adk", "uvicorn", "anthropic", "httpx", "pytest", "redis"]) {
    assert.ok(deps.includes(want), `missing ${want}`);
  }
  assert.ok(!deps.includes("@repo/api-types"), "workspace-internal package leaked");
  assert.ok(!deps.includes("should-not-appear"));
  assert.ok(!deps.includes("nor-this"));
  assert.ok(!deps.includes("python"));
});

test("readDeps on a missing path returns [] and never throws", () => {
  assert.deepEqual(readDeps("/definitely/not/here"), []);
  assert.deepEqual(readDeps(undefined), []);
});

test("mergeProjectDeps unions curated + live, lowercased, curated first", () => {
  const out = mergeProjectDeps(["FastAPI", "mcp"], ["fastapi", "zod"]);
  assert.deepEqual(out, ["fastapi", "mcp", "zod"]);
});
