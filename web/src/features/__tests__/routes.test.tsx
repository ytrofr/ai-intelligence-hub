/**
 * Every destination is BUILT, and the must-not-be-lost behaviours survive.
 *
 * The R0 inventory listed what the old pages did that lived only in their
 * markup. These are the assertions for the ones a file can hold; the rest are
 * eyeballed against the R0 screenshots.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DESTINATIONS } from "@/components/app/nav";

const appSrc = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

/**
 * The product files under features/, excluding tests.
 *
 * A test that forbids a pattern necessarily CONTAINS that pattern, so scanning
 * itself makes the guard fail on its own text - the third time this exact shape
 * has bitten in this arc (the ramp's header explains the rule it enforces; the
 * identity guard held the ids it forbade). A matcher must never be inside its
 * own population.
 */
function featureFiles(): string[] {
  const root = join(process.cwd(), "src", "features");
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      if (e === "__tests__") return [];
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return walk(root);
}

const built = () => [...appSrc.matchAll(/^\s+"?([a-z-]+)"?:\s*\w+Page,$/gm)].map((m) => m[1]);

describe("nothing is still a stub", () => {
  it("every destination maps to a real page component", () => {
    const missing = DESTINATIONS.map((d) => d.id).filter((id) => !built().includes(id));
    expect(missing, "these destinations still render the stub").toEqual([]);
  });

  it("POSITIVE CONTROL: the scan can see the map at all", () => {
    // If the regex stopped matching, the assertion above would report a clean
    // sweep of an empty list.
    expect(built().length).toBeGreaterThanOrEqual(10);
    expect(built()).toContain("stack");
  });
});

describe("the primitives are the only route to a table or a verdict colour", () => {
  it("no feature renders its own <table> or reaches for --fav", () => {
    // Six table implementations is what this rebuild exists to end. The rule is
    // structural: a page that can write its own table can also write its own
    // colour-only chip.
    const bad = featureFiles().filter((f) => /<table|--fav/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  it("POSITIVE CONTROL: the scan reads real files", () => {
    const files = featureFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((f) => f.endsWith("StackPage.tsx"))).toBe(true);
  });

  it("no feature imports shadcn's Badge, which is colour-only", () => {
    const bad = featureFiles().filter((f) => /from "@\/components\/ui\/badge"/.test(readFileSync(f, "utf8")));
    expect(bad, "state must go through StateChip, which requires a word").toEqual([]);
  });
});

describe("behaviours the old pages had that must not be lost", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), "src", "features", p), "utf8");

  it("the item view mode is still remembered per reader", () => {
    const src = read("items/ItemsPage.tsx");
    expect(src).toMatch(/localStorage/);
    expect(src, "a blocked-storage browser must not break the page").toMatch(/catch/);
  });

  it("the digest still offers the raw markdown", () => {
    expect(read("digests/DigestsPage.tsx")).toMatch(/api\/digest\//);
  });

  it("stack health is a separate section, never a recommendation", () => {
    const src = read("discovery/DiscoveryPage.tsx");
    expect(src).toMatch(/stackHealth/);
    expect(src.match(/<section/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("the radar does not offer a close button it cannot honour", () => {
    // Closing is gated server-side on evidence, a lesson and an eyeball. A
    // client control that might silently fail that gate is worse than none.
    expect(read("radar/RadarPage.tsx")).not.toMatch(/method:\s*"POST"/);
  });

  it("the ledger filters by project MEMBERSHIP, not by substring", () => {
    // A substring match against the whole row once pulled in repos whose
    // REASON merely mentioned the project - three it does not own.
    expect(read("stack/StackPage.tsx")).toMatch(/projects\.includes\(project\)/);
  });

  it("inventory reports an unreadable checkout as unknown, never zero", () => {
    const src = read("inventory/InventoryPage.tsx");
    expect(src).toMatch(/unknown/);
    expect(src).toMatch(/typeof p\.deps === "number"/);
  });

  it("ground truth treats never-run as a word, not a zero", () => {
    expect(read("ground-truth/GroundTruthPage.tsx")).toMatch(/never run/);
  });

  it("the matrix says out loud that it cannot show an unanswered need", () => {
    expect(read("matrix/MatrixPage.tsx")).toMatch(/keyed on the CANDIDATE/);
  });
});
