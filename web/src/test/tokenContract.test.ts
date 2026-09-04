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
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolved from the vitest root, NOT from import.meta.url. Under vitest that
 * URL is a bundler-virtual path ("/src/test/"), so building a filesystem path
 * from it reads `/src/styles/tokens.css` at the root of the disk. vitest.config
 * pins `root` to web/, so cwd is the stable anchor.
 */
const read = (f: string) => readFileSync(join(process.cwd(), "src", "styles", f), "utf8");

const tokens = read("tokens.css");
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
    expect(value(tokens, ".dark", "primary")).toBe("238.7 83.5% 66.7%"); // #6366f1 exactly
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
