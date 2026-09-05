/**
 * Discovery's filters.
 *
 * The dimensions here were measured before they were built (2026-09-05, a
 * 200-row pool per project) and two candidates were REJECTED by that
 * measurement: dependency overlap reads 3+ for all 200 rows on two of the
 * projects, and "hide what we already ruled on" has nothing to hide because
 * modules/recommend.js drops those rows before they arrive. The cells below
 * pin the three that survived.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { applyFilters, countBy, activeCount, starBands, EMPTY, WHY_LABEL } from "../useDiscoveryFilters";
import { DiscoveryPage } from "../DiscoveryPage";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const ROWS = [
  { id: "a", source: "github-watchlist", stars: 9000, relevance: { strategy: "tech-stack" } },
  { id: "b", source: "github-discovery-rising", stars: 400, relevance: { strategy: "rising-stars" } },
  { id: "c", source: "huggingface", stars: null, relevance: { strategy: "unknown" } },
  { id: "d", source: "github-watchlist", stars: 600, relevance: undefined },
];

describe("applyFilters", () => {
  it("POSITIVE CONTROL: an empty filter set returns the whole pool", () => {
    // Without this, every assertion below would pass against a function that
    // returns [] for everything.
    expect(applyFilters(ROWS, EMPTY)).toHaveLength(4);
  });

  it("why narrows to one strategy, and a row with none counts as unknown", () => {
    expect(applyFilters(ROWS, { ...EMPTY, why: "tech-stack" }).map((r) => r.id)).toEqual(["a"]);
    // `d` has no relevance object at all. It is unknown, not excluded from
    // every bucket - a row that answers no filter is a row nobody can find.
    expect(applyFilters(ROWS, { ...EMPTY, why: "unknown" }).map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("a null star count is EXCLUDED by a floor, never counted as zero", () => {
    // A Hugging Face model has no star count at all. Treating that as 0 would
    // rank it as the least popular thing we know of, which is a claim.
    const out = applyFilters(ROWS, { ...EMPTY, starsMin: "500" }).map((r) => r.id);
    expect(out).toEqual(["a", "d"]);
    expect(out).not.toContain("c");
  });

  it("starsMin=0 still excludes a row with NO star count", () => {
    // The distinguishing case, and the reason this cell exists: for any
    // positive floor `?? -1` and `?? 0` behave identically, so mutating one
    // into the other survived every other cell here. Only a floor of 0 tells
    // them apart - and the filters live in the URL, so ?starsMin=0 is a real
    // input. "No star count" is not "zero stars": a Hugging Face model has no
    // such number, and answering a popularity floor on its behalf is a claim.
    expect(applyFilters(ROWS, { ...EMPTY, starsMin: "0" }).map((r) => r.id))
      .toEqual(["a", "b", "d"]);
  });

  it("sources are OR within the dimension and AND across dimensions", () => {
    expect(applyFilters(ROWS, { ...EMPTY, sources: ["github-watchlist", "huggingface"] }).map((r) => r.id))
      .toEqual(["a", "c", "d"]);
    expect(applyFilters(ROWS, { ...EMPTY, sources: ["github-watchlist"], starsMin: "5000" }).map((r) => r.id))
      .toEqual(["a"]);
  });

  it("counts are taken over the UNFILTERED pool", () => {
    // A hint that moved with the selection would only tell the reader what
    // they just picked.
    expect(countBy(ROWS, (r) => r.relevance?.strategy ?? "unknown"))
      .toEqual({ "tech-stack": 1, "rising-stars": 1, unknown: 2 });
  });

  it("activeCount counts what is NARROWING, not what is available", () => {
    expect(activeCount(EMPTY)).toBe(0);
    expect(activeCount({ project: "apollo", why: "tech-stack", starsMin: "500", sources: ["x"] })).toBe(3);
    // The project is a LENS, not a filter: it changes which pool is ranked
    // rather than hiding rows from one, so it must not inflate the count.
    expect(activeCount({ ...EMPTY, project: "apollo" })).toBe(0);
  });

  it("star band hints count THIS pool, never the feed's", () => {
    // The feed's STARS constant ships hints like "1,380" - items above that
    // floor. Reused here it put a feed count under a Discovery control: a
    // number that is real and about something else entirely.
    const bands = starBands(ROWS);
    expect(bands.find((b) => b.value === "500")?.hint).toBe("2");
    expect(bands.find((b) => b.value === "5000")?.hint).toBe("1");
    // No rows above 50k, so no hint at all rather than a "0" that reads as a
    // measurement of nothing.
    expect(bands.find((b) => b.value === "50000")?.hint).toBeUndefined();
    expect(bands.find((b) => b.value === "")?.label).toBe("any");
  });

  it("every strategy the module stamps has a plain-English label", () => {
    // modules/recommend.js stamps these four. A fifth arriving unlabelled
    // would render as a raw slug in a control.
    for (const k of ["tech-stack", "rising-stars", "curated-lists", "unknown"]) {
      expect(WHY_LABEL[k], `no label for ${k}`).toBeTruthy();
    }
  });
});

describe("the page's honest mode", () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>
          <SidebarProvider>
            <Routes><Route path="/discovery" element={<DiscoveryPage />} /></Routes>
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  it("with no project selected the page SAYS these are not project matches", async () => {
    // routes/recommendations.js falls back to the top-scored feed when no
    // project is given: 20 of 20 rows come back strategy "unknown" with no
    // match reason. Rendering that under the word "recommendations" without
    // saying so is the defect this cell guards.
    renderAt("/discovery");
    expect(await screen.findByText(/not matches for a project/i)).toBeTruthy();
  });
});
