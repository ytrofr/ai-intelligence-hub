/**
 * The /trends page against a stubbed fetch.
 *
 * The payloads below are TEST DOUBLES, shaped like routes/lib/trends-builder.js
 * output - the builder itself is covered by tests/trends.test.js on the server.
 * They live in this test file only; the page has no fallback data of its own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TrendsPage } from "../TrendsPage";
import type { TrendRow, TrendsPayload } from "@/features/types";

const row = (over: Partial<TrendRow>): TrendRow => ({
  repo: "o/r", key: "o/r", url: "https://github.com/o/r", description: "", language: null,
  themes: ["agentic-ai"], stars: 1000, gain: 500, gain1: null, gain7: 500, gain7_origin: "snapshots",
  velocity: 10, origin: "snapshots", eligible: true, base_day: null, age_days: null, first_seen_days: 1,
  sources: ["gh-trending"], sparkline: [], status: { kind: "new", label: "new", projects: [] }, ...over,
});

const payload = (over: Partial<TrendsPayload> = {}): TrendsPayload => ({
  generated_at: "2026-10-06T00:00:00Z", today: "2026-10-06", period: 7, theme: null, min_gain: 0, include_ruled: false, include_other: false,
  population: {
    pool: 210, shown: 3, ranked: 2, unranked: 1, ruled_hidden: 4, other_hidden: 124, below_min_gain: 0, snapshots_today: 758,
    oldest_history_days: 0, sources: { "gh-trending": 210, "gh-theme": 0, "snapshots-only": 0 },
    missing_sources: ["gh-theme"], source_status: {}, gain_floor: 150,
  },
  themes: [
    { id: "agentic-ai", label: "Agentic AI", count: 2, projects: ["a", "b"] },
    { id: "evals", label: "Evals", count: 0, projects: [] },
    { id: "other", label: "Other", count: 124, projects: [] },
  ],
  rows: [
    row({ repo: "NVIDIA/OpenShell", key: "nvidia/openshell", gain: 5915, velocity: 61.9, origin: "trending-page", rank: 1, stars: 15058 }),
    row({ repo: "x/onradar", key: "x/onradar", rank: 2, status: { kind: "on-radar", label: "on radar: a", projects: ["a"] },
          sparkline: [{ day: "2026-09-29", stars: 900 }, { day: "2026-10-06", stars: 1400 }] }),
  ],
  unranked: [row({ repo: "y/young", key: "y/young", gain: null, velocity: null, origin: "insufficient_history", eligible: false })],
  surgedThoughKnown: [],
  candidates: [],
  ...over,
});

function stubFetch(body: TrendsPayload) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = url.startsWith("/api/radar/row") ? { ok: true, row: {} } : body;
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

function renderPage(path = "/trends") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarProvider>
          <Routes>
            <Route path="/trends" element={<TrendsPage />} />
          </Routes>
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("the trends page", () => {
  it("ranks rows, marks a trending-page gain, and prints the population footer", async () => {
    stubFetch(payload());
    renderPage();
    expect(await screen.findByText("NVIDIA/OpenShell")).toBeInTheDocument();
    expect(screen.getByText("+5,915")).toBeInTheDocument();
    expect(screen.getAllByTitle(/from the GitHub trending page/).length).toBeGreaterThanOrEqual(1);
    // State is a shape AND a word, never colour alone.
    expect(screen.getByText("on radar: a")).toBeInTheDocument();
    expect(screen.getByText("◉")).toBeInTheDocument();
    const footer = screen.getByText(/Population: pool 210 repos/);
    expect(footer).toHaveTextContent("snapshots today 758");
    expect(footer).toHaveTextContent("not running yet: gh-theme");
    expect(footer).toHaveTextContent("4 ruled and hidden");
    expect(footer).toHaveTextContent("124 with no theme hidden (see the Other tab)");
  });

  it("theme-less repos stay reachable: an Other tab with its count asks the API for theme=other", async () => {
    const calls = stubFetch(payload());
    renderPage();
    await screen.findByText("NVIDIA/OpenShell");
    // A theme with zero rows gets no tab; Other has 124, so it does.
    expect(screen.queryByRole("button", { name: /^Evals/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Other/ }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/trends?period=7&theme=other")).toBe(true));
  });

  it("the 30d column never wraps one reading over two lines, and no snapshot reads as no history", async () => {
    stubFetch(payload({ rows: [
      row({ repo: "one/reading", key: "one/reading", rank: 1, sparkline: [{ day: "2026-10-06", stars: 10 }] }),
      row({ repo: "zero/readings", key: "zero/readings", rank: 2, sparkline: [] }),
    ] }));
    renderPage();
    const one = await screen.findByText("1d");
    expect(one).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("no history yet")).toHaveClass("whitespace-nowrap");
  });

  it("asks the API for the window and theme in the URL", async () => {
    const calls = stubFetch(payload());
    renderPage("/trends?period=30&theme=agentic-ai");
    await screen.findByText("NVIDIA/OpenShell");
    expect(calls[0].url).toBe("/api/trends?period=30&theme=agentic-ai");
  });

  it("an empty pool is an honest absence, not an empty table", async () => {
    stubFetch(payload({ rows: [], unranked: [], population: { ...payload().population, pool: 0, shown: 0, ranked: 0, unranked: 0 } }));
    renderPage();
    expect(await screen.findByText("Nothing ranked.")).toBeInTheDocument();
    expect(screen.getByText(/have not stored any repo in the last 14 days/)).toBeInTheDocument();
    // With no snapshot history the surge list says it CANNOT fire yet, rather than "quiet week".
    expect(screen.getByText(/needs 7 days of our own snapshots/)).toBeInTheDocument();
  });

  it("insufficient history is a word in its own list, never a 0", async () => {
    stubFetch(payload());
    renderPage();
    await screen.findByText("NVIDIA/OpenShell");
    fireEvent.click(screen.getByText(/Not ranked yet/));
    expect(screen.getByText("insufficient history")).toBeInTheDocument();
    expect(screen.getAllByText("no history").length).toBeGreaterThanOrEqual(1);
  });

  it("Add to radar opens an inline confirm, needs a why, and POSTs a WATCH row", async () => {
    const calls = stubFetch(payload());
    renderPage();
    await screen.findByText("NVIDIA/OpenShell");
    // Only the `new` row offers the button; the on-radar row does not.
    const buttons = screen.getAllByRole("button", { name: "Add to radar as WATCH" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    const form = screen.getByRole("region", { name: "Add to radar" });
    const confirm = within(form).getByRole("button", { name: "Confirm WATCH" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Why"), { target: { value: "sandboxing for agents" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/radar/row")).toBe(true));
    const post = calls.find((c) => c.url === "/api/radar/row")!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toEqual({
      project: "a", repo: "NVIDIA/OpenShell", topic: "agentic-ai", verdict: "WATCH", why: "sandboxing for agents",
    });
    // The chip moves without a refetch, and the button goes away.
    expect(await screen.findAllByText("on radar: a")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add to radar as WATCH" })).toBeNull();
  });

  it("never uses window.confirm, and holds no data of its own", () => {
    const src = readFileSync(join(process.cwd(), "src", "features", "trends", "TrendsPage.tsx"), "utf8");
    expect(src).not.toMatch(/window\.confirm|confirm\(/);
    expect(src).not.toMatch(/OpenShell|openrig|PageIndex/);
  });
});
