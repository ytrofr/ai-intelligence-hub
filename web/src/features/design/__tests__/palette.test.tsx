/**
 * The design-system page's arithmetic, and the one thing about the page itself
 * that a jsdom render can honestly assert.
 *
 * The interesting cell is the last one. jsdom applies no stylesheet, so every
 * role resolves to the empty string there - and the page must say "not
 * resolved" rather than paint something. A gallery that invents a colour when
 * it cannot read one is worse than no gallery, because it looks like evidence.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DesignPage } from "../DesignPage";
import {
  hslChannelsToHex, measure, missing, swatch, verdict,
  PAIRS, REQUESTED_UI, ROLE_GROUPS,
} from "../palette";

/**
 * A reader over the REAL tokens.css, dark block - not a hand-typed map.
 *
 * Typing the values here would make every assertion below a statement about
 * this test file. Reading the stylesheet means a token that changes on disk
 * changes what these cells measure, which is the entire premise of the page.
 */
function reader(selector: string) {
  const css = readFileSync(join(process.cwd(), "src", "styles", "tokens.css"), "utf8");
  const i = css.indexOf(selector + " {");
  const block = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return (name: string) => {
    const m = block.match(new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`));
    return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim() : "";
  };
}

describe("hslChannelsToHex", () => {
  it("POSITIVE CONTROL: reproduces the two signature colours the contract pins", () => {
    // Both are asserted by tokenContract.test.ts from the other direction. If
    // this conversion were wrong, every swatch and every ratio on the page
    // would be wrong together and consistently - which reads as fine.
    expect(hslChannelsToHex("225 21.1% 7.5%")).toBe("#0f1117");
    expect(hslChannelsToHex("238.7 83.5% 66.7%")).toBe("#6366f1");
  });

  it("returns null for anything it cannot parse, rather than a fallback colour", () => {
    expect(hslChannelsToHex("")).toBeNull();
    expect(hslChannelsToHex("#0f1117")).toBeNull();
    expect(hslChannelsToHex("225 21.1% 7.5")).toBeNull();
  });

  it("handles the achromatic and the wrapped-hue ends", () => {
    expect(hslChannelsToHex("0 0% 100%")).toBe("#ffffff");
    expect(hslChannelsToHex("0 0% 0%")).toBe("#000000");
    expect(hslChannelsToHex("360 100% 50%")).toBe(hslChannelsToHex("0 100% 50%"));
  });
});

/**
 * The pairs that are BELOW the floor today, and why each is still here.
 *
 * This is a RATCHET, not a licence: the assertion is a SUBSET check, so fixing
 * one of these passes and adding a new failure reds. Pinning the set exactly
 * would make a fix look like a regression, which is how a known-bad list stops
 * being a to-do and becomes a floor.
 *
 * Both were invisible until this page existed, and not by accident: R8b's probe
 * measures RENDERED PIXELS, and as of 2026-09-05 no route in the app paints a
 * default or a destructive button - every Button in ten routes is `ghost` or
 * `outline`. A token pair with no caller cannot be measured by an instrument
 * whose population is the screen. This gallery is the first thing that paints
 * them, and it reported both on its first run.
 *
 *   --primary-foreground on --primary       4.47 dark / 4.41 light  (needs 4.50)
 *   --destructive-foreground on --destructive  3.76 / 3.78
 *
 * Neither is fixed here on purpose. --primary is the operator's signature
 * colour, pinned by tokenContract.test.ts, and moving a brand to win 0.03 is
 * their call and not a session's. --destructive is free to move but is a
 * sibling of the same question, and shipping half an answer to it would leave
 * the pair looking resolved.
 */
const KNOWN_BELOW_FLOOR = [
  "--primary-foreground on --primary",
  "--destructive-foreground on --destructive",
];

const below = (read: (n: string) => string) =>
  PAIRS.map((p) => measure(read, p))
    .filter((m) => m.ratio !== null && m.ratio < 4.5)
    .map((m) => `--${m.ink.role} on --${m.surface.role}`);

describe("reading roles", () => {
  const read = reader(".dark");

  it("POSITIVE CONTROL: the reader resolves a role and refuses an invented one", () => {
    expect(swatch(read, "background").hex).toBe("#0f1117");
    expect(swatch(read, "definitely-not-a-role").hex).toBeNull();
  });

  for (const theme of [".dark", ":root"]) {
    it(`${theme} defines every role the page shows`, () => {
      const r = reader(theme);
      const roles = ROLE_GROUPS.flatMap((g) => g.roles);
      expect(roles.length).toBeGreaterThan(20);
      expect(roles.filter((x) => swatch(r, x).hex === null)).toEqual([]);
    });

    it(`${theme} adds no contrast failure beyond the two known ones`, () => {
      // Subset, not equality - see KNOWN_BELOW_FLOOR. A token edit that breaks
      // a real pair reds here long before anyone runs the pixel probe.
      const news = below(reader(theme)).filter((x) => !KNOWN_BELOW_FLOOR.includes(x));
      expect(news, `new contrast failures in ${theme}`).toEqual([]);
    });
  }

  it("POSITIVE CONTROL: the floor check can actually fail", () => {
    // Without this, a `below()` that returned nothing for any input would make
    // both assertions above pass against a theme with no readable text at all.
    const grey = (n: string) => (n === "--card" ? "0 0% 50%" : "0 0% 52%");
    expect(below(grey).length).toBeGreaterThan(0);
  });

  it("the two known failures are still real, not stale entries", () => {
    // A known-bad list nobody re-measures becomes a list of things that were
    // once wrong. If one of these has been fixed, this cell says so.
    expect(below(read).sort()).toEqual([...KNOWN_BELOW_FLOOR].sort());
  });

  it("an unreadable side reports 'not measured', never a ratio of zero", () => {
    const m = measure(() => "", { ink: "foreground", on: "background", where: "x" });
    expect(m.ratio).toBeNull();
    expect(verdict(m.ratio).word).toBe("not measured");
  });
});

describe("verdict bands", () => {
  it("separates not-measured from failed", () => {
    // Collapsing these lets a broken reader report a clean page.
    expect(verdict(null).band).toBe("none");
    expect(verdict(1.2).band).toBe("poor");
  });

  it("names the threshold it crossed", () => {
    expect(verdict(7.1).word).toBe("AAA");
    expect(verdict(4.5).word).toBe("AA");
    expect(verdict(3.2).word).toBe("large text only");
    expect(verdict(2.9).word).toBe("under the floor");
  });
});

describe("the gap list", () => {
  it("POSITIVE CONTROL: it can report both a gap and none", () => {
    expect(missing(["a", "b"], ["a"])).toEqual(["b"]);
    expect(missing(["a"], ["a", "b"])).toEqual([]);
  });

  it("the requested list is the plan's batch, with no duplicates", () => {
    expect(new Set(REQUESTED_UI).size).toBe(REQUESTED_UI.length);
    expect(REQUESTED_UI).toContain("sidebar");
  });
});

describe("the page itself", () => {
  function renderPage() {
    return render(
      <MemoryRouter initialEntries={["/design"]}>
        <TooltipProvider>
          <SidebarProvider>
            <DesignPage />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  it("says 'not resolved' when no stylesheet is applied, instead of inventing swatches", () => {
    renderPage();
    // jsdom resolves no custom properties. Every role must therefore report
    // absence - and the ratios beside them must be dashes, not numbers.
    expect(screen.getAllByText("not resolved").length).toBeGreaterThan(20);
    expect(screen.getAllByText("not measured").length).toBe(PAIRS.length);
  });

  it("still renders the components, which do not need the tokens to exist", () => {
    renderPage();
    expect(screen.getByText("adopted")).toBeTruthy();
    // Twice on purpose: the chip's word and ScoreBar's own no-value word. The
    // page shows both because they are different components saying it.
    expect(screen.getAllByText("unscored").length).toBe(2);
    // The unknown-source badge renders rather than vanishing.
    expect(screen.getByText("a-source-we-have-no-colour-for")).toBeTruthy();
  });

  it("names the missing primitives, derived - not a hand-written list", () => {
    renderPage();
    // sonner is in the plan's batch and has never been added. If someone adds
    // it, this cell reds and the page's own copy is what changes.
    expect(screen.getByText(/never landed:.*sonner/)).toBeTruthy();
  });
});
