/**
 * The shell's invariants.
 *
 * Two of these guard failures the old app actually had:
 *
 *  - a page with no nav. Every one of the ten HTML pages hand-wrote its own
 *    header, which is why there were two header patterns, six container widths
 *    and a link to a page that had been deleted.
 *  - a nav entry pointing nowhere. `nav.ts` is now the single list the sidebar,
 *    the breadcrumbs and the router all read, so this file's job is to prove
 *    they cannot drift apart.
 */

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DESTINATIONS, destinationById } from "../nav";
import { PageShell } from "../PageShell";
import { AbsenceRow } from "../AbsenceRow";

/**
 * The same provider tree the app mounts. PageShell renders a SidebarTrigger,
 * which reads the sidebar context - so a harness without the provider is not a
 * lighter version of the app, it is a different one that throws.
 */
function renderAt(path: string, ui: React.ReactNode, pattern: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <SidebarProvider>
          <Routes>
            <Route path={pattern} element={ui} />
          </Routes>
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("nav.ts is the single list", () => {
  it("POSITIVE CONTROL: the list is not empty and the lookup works", () => {
    // Every assertion below iterates DESTINATIONS. An empty list would make
    // all of them pass without testing anything.
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(10);
    expect(destinationById("stack")?.label).toBe("Stack Ledger");
    expect(destinationById("no-such-destination")).toBeUndefined();
  });

  it("every id is unique", () => {
    const ids = DESTINATIONS.map((d) => d.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("every path is unique", () => {
    const paths = DESTINATIONS.map((d) => d.path);
    expect(paths).toEqual([...new Set(paths)]);
  });

  it("href() produces the destination's own path pattern", () => {
    // The sidebar links with href(); the router matches on path. If those two
    // disagree the link renders, resolves, and shows the wrong page.
    for (const d of DESTINATIONS) {
      const built = d.href("demo");
      const asPattern = built.replace("/p/demo", "/p/:project");
      expect(asPattern, `${d.id}: href() -> ${built}, path -> ${d.path}`).toBe(d.path);
    }
  });

  it("only the project section takes a project, and it always does", () => {
    for (const d of DESTINATIONS) {
      const takesOne = d.href("demo") !== d.href();
      expect(takesOne, `${d.id}`).toBe(d.section === "project");
    }
  });

  it("every destination carries a blurb that is not its own label", () => {
    // The blurb is the page subtitle AND the sidebar tooltip. Repeating the
    // label there is the same as having none.
    for (const d of DESTINATIONS) {
      expect(d.blurb.length, d.id).toBeGreaterThan(15);
      expect(d.blurb.toLowerCase()).not.toBe(d.label.toLowerCase());
    }
  });
});

describe("every destination renders the shell", () => {
  for (const d of DESTINATIONS) {
    it(`${d.id} has a breadcrumb ending in its own title`, () => {
      renderAt(d.href("demo"), <PageShell title={d.label} blurb={d.blurb}>x</PageShell>, d.path);
      const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
      expect(within(nav).getByText("Hub")).toBeTruthy();
      expect(within(nav).getByText(d.label)).toBeTruthy();
    });
  }

  it("a project route puts the project in the breadcrumb; a fleet route does not", () => {
    renderAt("/p/demo/stack", <PageShell title="Stack Ledger">x</PageShell>, "/p/:project/stack");
    expect(within(screen.getByRole("navigation", { name: /breadcrumb/i })).getByText("demo")).toBeTruthy();

    renderAt("/inventory", <PageShell title="What we have">x</PageShell>, "/inventory");
    const bars = screen.getAllByRole("navigation", { name: /breadcrumb/i });
    expect(within(bars[bars.length - 1]).queryByText("demo")).toBeNull();
  });
});

describe("an absence is a row", () => {
  it("renders what is missing AND why, never just an empty panel", () => {
    render(<AbsenceRow what="No candidates." reason="Nothing has been proposed for this slot." />);
    const row = screen.getByRole("status");
    expect(within(row).getByText("No candidates.")).toBeTruthy();
    expect(within(row).getByText("Nothing has been proposed for this slot.")).toBeTruthy();
  });

  it("carries a glyph as well as a colour, in both tones", () => {
    // The person reading these cannot distinguish red from green. Tone must
    // survive with the colour removed, so the glyph has to differ too.
    const { container: neutral } = render(<AbsenceRow what="a" reason="b" />);
    const { container: loud } = render(<AbsenceRow what="a" reason="b" tone="loud" />);
    const glyph = (c: HTMLElement) => c.querySelector('[aria-hidden="true"]')?.textContent;
    expect(glyph(neutral)).toBeTruthy();
    expect(glyph(loud)).toBeTruthy();
    expect(glyph(neutral)).not.toBe(glyph(loud));
  });
});

describe("the header row can run out of space without losing the actions", () => {
  /**
   * The failure this guards is not visible in jsdom - it is a layout defect, and
   * it was found by measuring right edges in a real browser at 320px, where the
   * Stack search box sat 44px past the viewport with no way to reach it. What
   * jsdom CAN hold is the contract that made the fix work, so that is what these
   * assert: the breadcrumb is the part allowed to shrink, and the actions slot
   * is allowed to shrink rather than being pushed out of the row.
   *
   * The browser-level check is `web/scripts/no-sideways-scroll.mjs`, which
   * carries its own positive control and is the thing to run after any header
   * change. It is not in `npm test` because playwright is not a dependency of
   * this repo and installing one here is not free.
   */
  const renderShell = () =>
    renderAt(
      "/p/demo/stack",
      <PageShell title="Stack Ledger" actions={<input aria-label="probe" />}>
        x
      </PageShell>,
      "/p/:project/stack",
    );

  it("POSITIVE CONTROL: the header renders both a breadcrumb and the actions", () => {
    // Every assertion below reads one of these two nodes. If either is missing
    // the queries throw rather than passing vacuously - which is the point.
    renderShell();
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeTruthy();
    expect(screen.getByLabelText("probe")).toBeTruthy();
  });

  /**
   * Read the class LIST, never the class STRING. `toContain("min-w-0")` is
   * satisfied by `[&>*]:min-w-0`, so the first version of the actions cell below
   * survived a mutation that deleted the very class it names - it was asserting
   * a substring of a different class. Caught by the mutation run, not by review.
   */
  const classes = (el: Element) => [...el.classList];

  it("the breadcrumb takes the leftover room and is allowed to shrink", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    // flex-1 without min-w-0 does nothing: a flex item's default minimum is its
    // content, so the trail refuses to shorten and pushes the row wider instead.
    expect(classes(nav)).toContain("min-w-0");
    expect(classes(nav)).toContain("flex-1");
  });

  it("the page title truncates rather than widening the row", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: /breadcrumb/i });
    const page = within(nav).getByText("Stack Ledger");
    expect(classes(page)).toContain("truncate");
    // A wrapping list inside a fixed-height header does not save space, it
    // spills vertically - so the list must stay on one line.
    expect(classes(page.closest("ol")!)).toContain("flex-nowrap");
  });

  it("the actions slot may shrink, and so may a fixed-width control inside it", () => {
    renderShell();
    const slot = screen.getByLabelText("probe").parentElement!;
    expect(classes(slot)).toContain("min-w-0");
    expect(classes(slot)).toContain("shrink");
    // Without this the child keeps its declared width whatever the slot does,
    // and escapes the row on its own.
    expect(classes(slot)).toContain("[&>*]:min-w-0");
  });
});
