/**
 * The project lens: what changes when a reader picks a project, and what
 * deliberately does not.
 *
 * Ported from tests/project-lens.test.js when public/ was deleted. The route
 * half of those guarantees still lives there - a page can only be right about a
 * filter the server actually applied.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), "src", "features", p), "utf8");

describe("the lens narrows the request, not the render", () => {
  it("ground truth passes ?project= through to the API", () => {
    // Filtering client-side would leave the counts describing a population the
    // reader is not looking at, which is the bug the server-side filter fixed.
    expect(read("ground-truth/GroundTruthPage.tsx")).toMatch(
      /\/ground-truth\?project=\$\{encodeURIComponent\(project\)\}/,
    );
  });

  it("the matrix passes ?project= through too", () => {
    expect(read("matrix/MatrixPage.tsx")).toMatch(
      /\/adoption-matrix\?project=\$\{encodeURIComponent\(project\)\}/,
    );
  });
});

describe("a filtered table under an unfiltered strip must say so", () => {
  it("the ledger's caption states the counts are ledger-wide", () => {
    // The counts strip is deliberately NOT filtered - a denominator that moves
    // with the filter is not a denominator. Which means the page has to say so,
    // or the strip reads as this project's numbers.
    const src = read("stack/StackPage.tsx");
    expect(src).toMatch(/ledger-wide/);
    expect(src).toMatch(/denominator/);
  });

  it("POSITIVE CONTROL: the file being read is the ledger page", () => {
    // Against a wrong or empty path every assertion above fails loudly rather
    // than passing - but this makes the intent explicit.
    expect(read("stack/StackPage.tsx")).toMatch(/Stack Ledger/);
  });
});
