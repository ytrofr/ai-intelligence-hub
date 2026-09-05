/**
 * The design tokens are a CONTRACT, and this file is the contract.
 *
 * Read with readFileSync, deliberately NOT with Vite's `?raw` import. `?raw`
 * goes through the bundler, so a transform that mangles or drops the file
 * would be invisible here - the test would be reading the same broken pipeline
 * it is meant to be checking. The bytes on disk are the thing being asserted.
 *
 * Three classes of assertion, and only the first is about taste:
 *
 *  1. every shadcn role exists in BOTH themes. `shadcn add` writes components
 *     that reference roles; a missing one renders as `background-color: ;` -
 *     no error, no warning, an invisible element.
 *  2. --accent is not the brand. shadcn's --accent is the HOVER surface. It is
 *     the single most common way a shadcn theme goes wrong, because pointing it
 *     at the primary colour looks deliberate in the token file and turns every
 *     hover in the app into a shout.
 *  3. the favourability ramp is not the shadcn palette and never carries the
 *     red/green pair. The person reading these pages cannot distinguish those
 *     two, so on any surface where the ramp IS the signal, that pair is not a
 *     style choice - it is an unreadable page.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolved from the vitest root, NOT from import.meta.url. Under vitest that
 * URL is a bundler-virtual path ("/src/test/"), so building a filesystem path
 * from it reads `/src/styles/tokens.css` at the root of the disk. vitest.config
 * pins `root` to web/, so cwd is the stable anchor.
 */
const read = (f: string) => readFileSync(join(process.cwd(), "src", "styles", f), "utf8");

const tokens = read("tokens.css");
const globals = read("globals.css");
const ramp = read("favourability.css");

/**
 * Comments stripped. The ramp's own header EXPLAINS why it avoids the red/green
 * pair and therefore contains both hexes as prose - so a scan of the raw file
 * fails the very file that documents the rule. Free-form text will eventually
 * contain every token any rule forbids; a gate must read the DECLARATIONS.
 */
const rampDecls = ramp.replace(/\/\*[\s\S]*?\*\//g, "");

/** The block for one selector, e.g. `:root` or `.dark`. */
function block(css: string, selector: string): string {
  const i = css.indexOf(selector + " {");
  if (i === -1) return "";
  const start = css.indexOf("{", i);
  return css.slice(start + 1, css.indexOf("}", start));
}

function value(css: string, selector: string, name: string): string | null {
  const m = block(css, selector).match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

/** Every role a generated shadcn component may reference. */
const ROLES = [
  "background", "foreground",
  "card", "card-foreground",
  "popover", "popover-foreground",
  "primary", "primary-foreground",
  "secondary", "secondary-foreground",
  "muted", "muted-foreground",
  "accent", "accent-foreground",
  "destructive", "destructive-foreground",
  "border", "input", "ring",
];

const SIDEBAR = [
  "sidebar-background", "sidebar-foreground",
  "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground",
  "sidebar-border", "sidebar-ring",
];

describe("the shadcn role contract", () => {
  it("POSITIVE CONTROL: the parser can read a value at all", () => {
    // Without this, a parser that returns null for everything makes every
    // "is defined" assertion below vacuous and the suite reads green.
    expect(value(tokens, ":root", "background")).toBeTruthy();
    expect(value(tokens, ".dark", "background")).toBeTruthy();
    expect(value(tokens, ":root", "definitely-not-a-token")).toBeNull();
  });

  for (const theme of [":root", ".dark"]) {
    it(`${theme} defines every shadcn role`, () => {
      const missing = ROLES.filter((r) => value(tokens, theme, r) === null);
      expect(missing, `missing in ${theme}`).toEqual([]);
    });

    it(`${theme} defines every sidebar role`, () => {
      const missing = SIDEBAR.filter((r) => value(tokens, theme, r) === null);
      expect(missing, `missing in ${theme}`).toEqual([]);
    });

    it(`${theme} states roles as bare HSL channels, not colours`, () => {
      // shadcn composes them as `hsl(var(--x) / <alpha-value>)`. A hex here
      // produces `hsl(#6366f1 / 1)`, which is not a colour and renders as
      // nothing - silently.
      const bad = ROLES.map((r) => [r, value(tokens, theme, r)] as const)
        .filter(([, v]) => v !== null && !/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(v!))
        .map(([r, v]) => `${r}: ${v}`);
      expect(bad, `not bare HSL channels in ${theme}`).toEqual([]);
    });
  }
});

describe("only tokens.css declares a role", () => {
  /**
   * This exists because it already happened. `shadcn add sidebar` appended its
   * own stock `--sidebar-*` block to globals.css, AFTER the `@import` of
   * tokens.css - so the stock values won the cascade and the app rendered
   * slate. Every assertion in this file passed throughout, because they all
   * read tokens.css and tokens.css was untouched.
   *
   * A guard that reads the file it expects the value to be in cannot see a
   * value arriving from somewhere else. This one reads the OTHER file.
   */
  it("globals.css declares no shadcn role of its own", () => {
    const declared = [...globals.matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1]);
    const stolen = declared.filter((d) => ROLES.includes(d) || SIDEBAR.includes(d));
    expect(
      [...new Set(stolen)],
      "globals.css is imported AFTER tokens.css, so anything it declares here WINS",
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: the role scanner can see a declaration at all", () => {
    // Against an empty or unread file the assertion above passes trivially.
    const declared = [...tokens.matchAll(/--([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(declared).toContain("sidebar-background");
  });
});

describe("the brand is not the hover surface", () => {
  for (const theme of [":root", ".dark"]) {
    it(`${theme}: --accent is not --primary`, () => {
      expect(value(tokens, theme, "accent")).not.toEqual(value(tokens, theme, "primary"));
    });
  }
});

describe("the hub still looks like the hub", () => {
  it("the two signature colours are pinned", () => {
    // `shadcn add` and `shadcn init` both rewrite theme files. These two are
    // what makes the page recognisably this product rather than stock slate.
    //
    // One decimal place, not zero: at integer precision #0f1117 round-trips to
    // #0e1016 and #6366f1 to #6467f2. Imperceptible on one swatch, but the
    // whole palette drifting a step off the pages it is replacing is exactly
    // what a before/after comparison is for.
    expect(value(tokens, ".dark", "background")).toBe("225 21.1% 7.5%");   // #0f1117 exactly
    // 66.5%, not 66.7%, since 2026-09-05. #6366f1 measured 4.47:1 against the
    // white sitting on it - a button label 0.03 under the floor - and /design
    // was the first surface in the app that ever painted the pair. The operator
    // ruled on the rendered before/after, not on the hex. #6265f1 is one hex
    // digit away and clears at 4.52.
    expect(value(tokens, ".dark", "primary")).toBe("238.7 83.5% 66.5%"); // #6265f1 exactly
  });
});

describe("the favourability ramp", () => {
  it("is the only file that declares --fav", () => {
    // It was inlined in one page once, and the test guarding it read that page
    // BY FILENAME - so it would have gone green against a page that no longer
    // had the ramp, and could not have seen a second page inventing its own.
    expect(rampDecls).toMatch(/--fav\s*:/);
    expect(tokens).not.toMatch(/--fav\s*:/);
  });

  it("never uses the red/green pair", () => {
    // Not a style rule. On these pages the ramp IS the signal, and the person
    // reading them cannot tell #22c55e from #ef4444.
    expect(rampDecls.toLowerCase()).not.toContain("#22c55e");
    expect(rampDecls.toLowerCase()).not.toContain("#ef4444");
  });

  it("POSITIVE CONTROL: the ramp scanner can see a stop, and comment-stripping did not eat the file", () => {
    // A scan of an empty or unread file passes both assertions above - and so
    // does a comment-stripper that accidentally removed everything.
    expect(rampDecls.toLowerCase()).toContain("#2dd4bf");
  });
});

describe("the accessibility pass has somewhere to stand", () => {
  for (const theme of [":root", ".dark"]) {
    it(`${theme}: --link exists and is NOT --primary`, () => {
      // They pull in opposite directions: --primary is a surface with white on
      // it, --link is ink on a page. Collapsing them back into one token is the
      // regression this cell exists to catch, and it reads as a tidy-up.
      expect(value(tokens, theme, "link")).not.toBeNull();
      expect(value(tokens, theme, "link")).not.toEqual(value(tokens, theme, "primary"));
    });
  }

  it("the ramp carries a light-theme set as well as a dark one", () => {
    // The same five stops measure 9.02:1 on #0f1117 and 1.86:1 on white. A ramp
    // is a relationship between an ink and a surface, so one set cannot serve
    // two surfaces however carefully it was chosen.
    expect(ramp).toMatch(/:root:not\(\.dark\)/);
    for (const stop of ["b-good", "b-mid", "b-warn", "b-poor"]) {
      expect(ramp, `${stop} has no light value`).toMatch(new RegExp(`--${stop}:`));
    }
  });

  it("no ramp stop is still pointing at a variable that does not exist", () => {
    // .b-none read `var(--color-text-dim)`, a name from the app this replaced.
    // An undefined var makes --fav INVALID, and an invalid custom property is
    // not an error - the chip silently inherits its parent's colour.
    // Comments stripped FIRST. The comment above .b-none names the dead
    // variable in order to explain it, and a scanner that counts its own
    // documentation reports the bug it was written to prove is fixed.
    const code = ramp.replace(/\/\*[\s\S]*?\*\//g, "");
    const names = [...code.matchAll(/var\(\s*(--[a-z-]+)/g)].map((m) => m[1]);
    const declared = new Set([
      ...[...tokens.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]),
      ...[...code.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]),
    ]);
    const dangling = [...new Set(names)].filter((n) => !declared.has(n));
    expect(dangling, "an undefined var makes --fav invalid, silently").toEqual([]);
  });

  it("motion is reduced when the reader has asked for that", () => {
    expect(globals).toMatch(/prefers-reduced-motion:\s*reduce/);
    // Near-zero, not `none`: Radix waits for animationend before unmounting.
    expect(globals).not.toMatch(/animation-duration:\s*0s/);
  });

  it("the keyboard has a visible cursor", () => {
    expect(globals).toMatch(/:focus-visible/);
    expect(globals).toMatch(/outline:\s*2px solid hsl\(var\(--ring\)\)/);
  });
});

describe("every colour class names a role that exists", () => {
  /**
   * This cell exists because of a real one-line mistake, and it is the cheapest
   * possible guard against its whole class.
   *
   * A blanket `text-primary` -> `text-link` rename over the tree also rewrote
   * `text-primary-foreground` to `text-link-foreground` inside three GENERATED
   * shadcn components. There is no `--link-foreground`, so Tailwind emitted no
   * class at all: every default Button, Badge and Tooltip silently lost its
   * white ink on the indigo surface. Nothing failed. TypeScript cannot see a
   * class name, the build does not check one, and the rendered-pixel probe only
   * catches it if such a control happens to be on a page it visited.
   *
   * A colour utility naming a token that does not exist is not a style bug, it
   * is a class that never gets generated - always silent, never an error.
   */
  const SRC = join(process.cwd(), "src");

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
    });

  it("no className references a *-foreground role that tokens.css does not declare", () => {
    const declared = new Set([...tokens.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]));
    const bad: string[] = [];
    for (const file of walk(SRC)) {
      // Comments stripped. THIS file's own header names the broken class in
      // order to explain it, and that is the third time in one arc that a
      // matcher has counted its own documentation as a finding.
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of body.matchAll(/\b(?:text|bg|border|ring)-([a-z]+(?:-[a-z]+)*-foreground)\b/g)) {
        if (!declared.has(`--${m[1]}`)) bad.push(`${file.replace(SRC, "src")}: ${m[0]}`);
      }
    }
    expect(bad, "a colour class naming a role that does not exist emits nothing at all").toEqual([]);
  });

  it("POSITIVE CONTROL: the scanner reads real files and would see a bad one", () => {
    // Without this the assertion above passes on an empty walk, which is what
    // a wrong SRC path or a changed extension would produce.
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20);
    const uses = files
      .map((f) => readFileSync(f, "utf8"))
      .join("")
      .match(/\btext-[a-z]+-foreground\b/g);
    expect(uses, "no *-foreground classes found at all - the matcher is broken").not.toBeNull();
    expect((uses ?? []).length).toBeGreaterThan(5);
  });
});

describe("the brand blue is ONE value", () => {
  // --primary was nudged for contrast on 2026-09-05. --ring, --sidebar-primary
  // and --sidebar-ring are the same colour and had to move with it; a future
  // nudge that moves one and forgets the others leaves two blues a hex digit
  // apart in the same rail, which is invisible to the eye and exactly what a
  // token file is for.
  for (const theme of [":root", ".dark"]) {
    it(`${theme}: every brand-blue role carries the same value`, () => {
      const primary = value(tokens, theme, "primary");
      expect(primary, `${theme} has no --primary`).toBeTruthy();
      for (const role of ["ring", "sidebar-primary", "sidebar-ring"]) {
        expect(value(tokens, theme, role), `--${role} in ${theme}`).toBe(primary);
      }
    });
  }

  it("POSITIVE CONTROL: the comparison can fail", () => {
    // --accent is deliberately NOT the brand. If this ever matches, the check
    // above is comparing something to itself.
    expect(value(tokens, ".dark", "accent")).not.toBe(value(tokens, ".dark", "primary"));
  });
});
