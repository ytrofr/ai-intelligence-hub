/**
 * A SUBSET guard, and it says so.
 *
 * The real instrument for this class is eslint-plugin-react-hooks, which
 * understands scope and control flow. It is not installed: this box is sitting
 * at 8.0/8.0 swap and the plan's own line is to stop rather than start an
 * install there. So this file catches exactly ONE shape - the one that shipped
 * a crash to the operator - and must not be read as covering rules-of-hooks.
 *
 *   useMatch(a) ?? useMatch(b)
 *
 * `??`, `||` and `&&` all short-circuit, so the right-hand hook runs only on
 * some renders. React identifies hooks by call order, so the first navigation
 * that changes which branch is taken desyncs the list and throws somewhere
 * else entirely.
 *
 * Comments are stripped before scanning. The R2 ramp scan failed itself
 * because its own header explained the pattern it forbade, and this file
 * describes the bug in prose four lines up - the fifth time in this arc that
 * an instrument landed inside its own population. `__tests__` is excluded for
 * the same reason.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

const SHORT_CIRCUITED_HOOK = /\buse[A-Z]\w*\s*\([^;]*?\)\s*(\?\?|\|\||&&)\s*use[A-Z]\w*\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Block comments, line comments and JSX comments - not string contents. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("hooks are never short-circuited", () => {
  it("no source file calls a hook on the right of ?? || or &&", () => {
    const files = sourceFiles(SRC);
    // The population, printed with the finding: a scan that walked nothing
    // reports the same clean result as a scan that walked everything.
    expect(files.length, "walked zero files - the scan is broken, not the code").toBeGreaterThan(20);
    const bad = files.filter((f) => SHORT_CIRCUITED_HOOK.test(stripComments(readFileSync(f, "utf8"))));
    expect(bad.map((f) => f.replace(SRC, "src"))).toEqual([]);
  });

  it("the matcher fires on the exact line that shipped the crash", () => {
    // Positive control. Without it a clean report is indistinguishable from a
    // regex that stopped matching when someone reformatted the source.
    const real = 'const match = useMatch("/p/:project/*") ?? useMatch("/p/:project");';
    expect(SHORT_CIRCUITED_HOOK.test(real)).toBe(true);
    expect(SHORT_CIRCUITED_HOOK.test(stripComments(`// ${real}`))).toBe(false);
  });

  it("does NOT fire on two hooks called on their own lines", () => {
    // Negative control - the fix itself must pass, or the guard bans the cure.
    const fixed = 'const deep = useMatch("/p/:project/*");\nconst bare = useMatch("/p/:project");\nreturn (deep ?? bare)?.params.project;';
    expect(SHORT_CIRCUITED_HOOK.test(fixed)).toBe(false);
  });
});
