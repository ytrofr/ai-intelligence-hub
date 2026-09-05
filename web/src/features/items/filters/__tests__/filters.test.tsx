/**
 * The filter bar, and the URL it writes.
 *
 * The URL is the point. Filter state used to live in a module-level object, so
 * a filtered view could not be linked, the back button did nothing, and saving
 * a search needed a modal (`saved_searches` holds 0 rows). These cells guard
 * the round trip, because a filter that does not reach the URL looks identical
 * to one that does until somebody pastes a link.
 */

import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FilterBar } from "../FilterBar";
import { useItemFilters, activeCount, toQuery, EMPTY, LIMIT } from "../useItemFilters";
import { POPULARITY, STARS, daysAgoIso } from "../dimensions";

const SOURCES = [
  { id: "github-discovery-tech", count: 1540 },
  { id: "openai", count: 1233 },
  { id: "arxiv-ai", count: 884 },
];

function Harness() {
  const filters = useItemFilters();
  const loc = useLocation();
  return (
    <TooltipProvider>
      <FilterBar {...filters} sources={SOURCES} />
      <output data-testid="url">{loc.search || "(none)"}</output>
      <output data-testid="api">{filters.path}</output>
      <output data-testid="active">{filters.active}</output>
    </TooltipProvider>
  );
}

function at(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes><Route path="/" element={<Harness />} /></Routes>
    </MemoryRouter>,
  );
}

const url = () => screen.getByTestId("url").textContent;
const api = () => screen.getByTestId("api").textContent;
const moreBtn = () => screen.getByRole("button", { name: /More filters/ });

describe("filter state lives in the URL", () => {
  it("a clean feed has a clean URL - defaults are not written", () => {
    at("/");
    // ?sortBy=date&sortOrder=DESC on an unfiltered feed reads as a filtered
    // view when it is not one. The default sort is omitted for that reason.
    expect(url()).toBe("(none)");
    expect(screen.getByTestId("active").textContent).toBe("0");
  });

  it("typing a search puts it in the URL and in the request", () => {
    at("/");
    fireEvent.change(screen.getByLabelText("Search items"), { target: { value: "agent" } });
    expect(url()).toContain("q=agent");
    expect(api()).toContain("q=agent");
  });

  it("a pasted URL restores every filter it names", () => {
    at("/?q=rag&sources=openai,arxiv-ai&scoreMin=200&starsMin=500&addedDays=7");
    expect((screen.getByLabelText("Search items") as HTMLInputElement).value).toBe("rag");
    // sources + score + stars + added = 4. q is a search, not a filter, and is
    // counted separately - conflating them makes "clear 5" clear the search too.
    expect(screen.getByTestId("active").textContent).toBe("4");
    const req = api()!;
    expect(req).toContain("sources=openai%2Carxiv-ai");
    expect(req).toContain("scoreMin=200");
    expect(req).toContain("starsMin=500");
    expect(req).toContain(`dateFrom=${daysAgoIso("7")}`);
  });

  it("arriving on a link with a drawer filter OPENS the drawer", () => {
    // Otherwise the feed is narrowed with the reason folded out of sight, and
    // the reader cannot tell a filtered feed from an empty week.
    at("/?scoreMin=200");
    expect(moreBtn().textContent).toContain("▾");
    expect(moreBtn().textContent).toContain("1 on");
  });

  it("the drawer is CLOSED when no drawer filter is set", () => {
    // The negative control for the cell above. Without it, a trigger that is
    // always open would pass that test and prove nothing.
    at("/?q=rag");
    expect(moreBtn().textContent).toContain("▸");
  });

  it("clear removes the filters and leaves the URL clean", () => {
    at("/?scoreMin=200&starsMin=500");
    fireEvent.click(screen.getByRole("button", { name: /clear 2/ }));
    expect(url()).toBe("(none)");
  });
});

describe("the drawer label counts ACTIVE filters, not available ones", () => {
  it("says how much of the feed is hidden, never how many controls exist", () => {
    at("/");
    // Three controls live in the drawer. With none set the label must carry no
    // number at all - "3" here would mean "three controls", which is the whole
    // failure this wording exists to avoid.
    expect(moreBtn().textContent).not.toMatch(/\d/);
    fireEvent.click(moreBtn());
    const group = screen.getByText("popularity").parentElement!;
    fireEvent.click(within(group).getByRole("button", { name: /top 10%/ }));
    expect(moreBtn().textContent).toContain("1 on");
  });
});

describe("the query builder", () => {
  it("omits every empty field rather than sending blanks", () => {
    expect(toQuery(EMPTY)).toBe("/items?limit=60&sortBy=date&sortOrder=DESC");
  });

  it("counts a search separately from the filters", () => {
    expect(activeCount({ ...EMPTY, q: "rag" })).toBe(0);
    expect(activeCount({ ...EMPTY, scoreMin: "200" })).toBe(1);
  });

  it("every band value is a clean integer the API can honour", () => {
    // The bands are hand-written numbers. If one drifts into a non-numeric or
    // padded form the control silently filters to something nobody chose.
    for (const b of [...POPULARITY, ...STARS]) {
      if (!b.value) continue;
      expect(Number(b.value), b.label).toBeGreaterThan(0);
      expect(String(Number(b.value)), b.label).toBe(b.value);
    }
  });
});

describe("the count line never claims a filtered total it does not have", () => {
  // /api/items returns `total` = the STORE count; it does not move when
  // filters narrow the feed. Saying "of 9,315 matching" was a true number
  // wearing a false label, and it read as correct because the number was real.
  const line = (returned: number, stored: number) =>
    returned < LIMIT
      ? `${returned} item${returned === 1 ? "" : "s"} match · ${stored.toLocaleString()} stored`
      : `First ${returned} of more that match · ${stored.toLocaleString()} stored`;

  it("states an exact match count only when the page is not full", () => {
    // Verified live 2026-09-05: q=kubernetes -> 23, scoreMin=400000 -> 6.
    expect(line(23, 9315)).toBe("23 items match · 9,315 stored");
    expect(line(6, 9315)).toBe("6 items match · 9,315 stored");
    expect(line(1, 9315)).toBe("1 item match · 9,315 stored");
  });

  it("refuses to name a total when the page is full", () => {
    // starsMin=50000 really matches 206. The endpoint cannot say so, so the
    // page must not either.
    expect(line(LIMIT, 9315)).toBe("First 60 of more that match · 9,315 stored");
    expect(line(LIMIT, 9315)).not.toContain("9,315 match");
  });
});
