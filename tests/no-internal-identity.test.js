/**
 * No tracked file names an internal project.
 *
 * This repo is PUBLIC. The operator's standing instruction, twice, verbatim:
 * "make sure we dont expose anything sensitive to this this repo" and
 * "MAKE SURE WE DONT EXPOSE ANYTHING ABOUT THESE PROJECTS PUBLIC!!!!".
 *
 * The real project ids live in config/projects.json, which is gitignored and
 * has never been pushed. Nothing in the CODE needs to know them: the app reads
 * them at runtime, and config/projects.example.json ships fictional ones
 * (apollo / atlas / hermes). So the guarantee this file enforces is the strong
 * one - not "the config is ignored" but "no tracked file names a project".
 *
 * POPULATION is `git ls-files`, not a hand-listed directory. A new file is
 * covered the moment it is tracked, which is the moment it can leak. A glob
 * would have to be remembered; this cannot be forgotten.
 *
 * `remotion` is the one term that needs care. It is ALSO a public npm package
 * and a topic this hub legitimately tracks, so a bare-word regex would fire on
 * "@remotion/player" and on a keywords list - and a guard that cries wolf on
 * legitimate content is a guard someone deletes. It is therefore matched only
 * in IDENTIFIER position. The two controls below exist so that neither half of
 * that trade can rot silently.
 */

const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

/**
 * Terms with no legitimate public meaning inside this repo. Measured before
 * this guard was written: every occurrence of `hermes` outside `hermes` was
 * one of three real leaks, so it belongs here rather than in ANCHORED.
 */
const UNCONDITIONAL = ["apollo", "hermes", "hermes", "atlas", "orion", "lyra"];

/**
 * Terms that are also real public things. Each carries a pattern that fires
 * ONLY where the term is being used as one of our project ids.
 *
 * The lookbehind on the last alternative is the whole point: `@remotion/player`
 * and `node_modules/remotion/` must not match, `"remotion/scene-generation"`
 * (a slot id of ours) must.
 */
const ANCHORED = [
  {
    // The account name alone is not a leak: it is in this repo's own clone URL
    // and in the LICENSE's copyright line, both of which must stay. What leaks
    // is the account paired with a DIFFERENT repo - `ytrofr/Apollo` names a
    // private project, `ytrofr/ai-intelligence-hub` names the thing you are
    // already reading. Measured before writing this: all 9 occurrences in the
    // repo today are the second kind.
    term: "ytrofr",
    re: /ytrofr\/(?!ai-intelligence-hub\b)/i,
  },
  {
    term: "remotion",
    re: /(?:"id"\s*:\s*"remotion"|'id'\s*:\s*'remotion'|project\s*[=:]\s*['"]?remotion|['"]remotion['"]\s*:|radar\/remotion|(?<![@\w/-])remotion\/[a-z])/i,
  },
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 24 })
    .toString()
    .split("\0")
    .filter(Boolean);
}

/** Every internal-identity hit in one blob of text, as `term` strings. */
function hits(text) {
  const found = [];
  for (const t of UNCONDITIONAL) {
    if (new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) found.push(t);
  }
  for (const { term, re } of ANCHORED) {
    if (re.test(text)) found.push(term);
  }
  return found;
}

test("POSITIVE CONTROL: the matcher fires on a synthetic project id", () => {
  // Without this, a matcher broken into never matching anything reports a
  // spotlessly clean repo, which is the most convincing possible lie.
  assert.deepEqual(hits("const url = `/radar.html?project=apollo`;"), ["apollo"]);
  assert.deepEqual(hits('{ "id": "remotion", "name": "x" }'), ["remotion"]);
  assert.deepEqual(hits("slot: 'remotion/scene-generation'"), ["remotion"]);
  // A different repo under the same account. Deliberately named with no
  // internal id in it, so this cell proves the ytrofr anchor and nothing else.
  assert.deepEqual(hits("https://github.com/ytrofr/some-private-repo"), ["ytrofr"]);
});

test("NEGATIVE CONTROL: the matcher does NOT fire on the public remotion package", () => {
  // remotion.dev is a real public library. Flagging it would make this guard
  // wrong about legitimate content, and a guard that is wrong gets switched off.
  assert.deepEqual(hits('import { Player } from "@remotion/player";'), []);
  assert.deepEqual(hits('"keywords": ["remotion", "video-generation"]'), []);
  assert.deepEqual(hits("node_modules/remotion/dist/index.js"), []);
  assert.deepEqual(hits("git clone https://github.com/ytrofr/ai-intelligence-hub.git"), []);
  assert.deepEqual(hits("Copyright (c) 2026 ytrofr"), []);
});

test("no tracked file names an internal project", () => {
  const offenders = [];
  for (const rel of trackedFiles()) {
    const abs = path.join(ROOT, rel);
    let body;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch (_) {
      continue; // deleted-but-still-indexed, or binary we cannot read as utf8
    }
    const found = new Set([...hits(rel), ...hits(body)]);
    if (found.size) offenders.push(`${rel}: ${[...found].sort().join(", ")}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} tracked file(s) name an internal project:\n  ${offenders.join("\n  ")}`,
  );
});
