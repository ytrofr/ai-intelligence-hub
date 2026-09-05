/**
 * The scorecard page: per-project, shape-first, honest about absence.
 *
 * Source-level guards in the style of lens.test.tsx - the route half of these
 * guarantees lives in tests/adoption-scorecard.test.js on the server.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESTINATIONS } from "@/components/app/nav";

const src = readFileSync(join(process.cwd(), "src", "features", "scorecard", "ScorecardPage.tsx"), "utf8");

describe("the scorecard is a project lens", () => {
  it("passes ?project= through to the API rather than filtering client-side", () => {
    expect(src).toMatch(/\/adoption-scorecard\?project=\$\{encodeURIComponent\(project\)\}/);
  });

  it("is a project-section destination at /p/:project/scorecard", () => {
    const d = DESTINATIONS.find((x) => x.id === "scorecard");
    expect(d).toBeDefined();
    expect(d!.section).toBe("project");
    expect(d!.path).toBe("/p/:project/scorecard");
    expect(d!.href("apollo")).toBe("/p/apollo/scorecard");
  });
});

describe("the measure is a SHAPE before it is a colour", () => {
  // The reader cannot tell red from green. Every measure state must be a
  // StateChip (glyph + word), and the four states must be four DIFFERENT
  // levels so the glyphs differ - not one level recoloured.
  it("renders the four measure states through StateChip with distinct levels", () => {
    const block = src.slice(src.indexOf("function measureChip"), src.indexOf("function verdictCell"));
    expect(block).toMatch(/level="poor" word="taken, no bench"/);
    expect(block).toMatch(/level="good" word="measured"/);
    expect(block).toMatch(/level="mid" word="estimated"/);
    expect(block).toMatch(/level="none" word="not run"/);
  });

  it("maps the State column through a named stateChip on deriveState's literal values, not a suffix guess", () => {
    const block = src.slice(src.indexOf("function stateChip"), src.indexOf("function benchCell"));
    expect(block).toMatch(/r\.state === "done-unseen"/);
    expect(block).toMatch(/r\.state === "accepted-without-evidence"/);
    expect(block).not.toMatch(/endsWith/);
    expect(src).toMatch(/cell: stateChip/);
  });

  it("never renders an absent bench, verdict or before/after as a blank cell", () => {
    expect(src).toMatch(/if \(!r\.bench\) return <NoValue/);
    expect(src).toMatch(/if \(!r\.before_after\) return <NoValue/);
    expect(src).toMatch(/if \(!r\.eyeballed\) return/);
  });
});

describe("the empty state says why, and the caption states the law", () => {
  it("names the reason a project has no rows and the one bench per project rule", () => {
    expect(src).toMatch(/has ruled on nothing yet/);
    expect(src).toMatch(/one project's bench never counts for another/);
  });
});
