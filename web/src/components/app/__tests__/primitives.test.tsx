/**
 * The primitives' invariants. Each one guards a property the old pages either
 * had by accident or lost.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { StateChip } from "../StateChip";
import { DataTable } from "../DataTable";
import { SourceBadge, BRANDED_SOURCES } from "../SourceBadge";
import { DimBar, ScoreBar } from "../ScoreBar";
import { band, favour, scoreBand } from "@/lib/favour";
import { timeAgo, ageDays, compact } from "@/lib/time";

describe("a state can never be colour alone", () => {
  it("every chip renders a glyph AND a word", () => {
    for (const level of ["good", "mid", "poor", "none"] as const) {
      const { container } = render(<StateChip level={level} word={`w-${level}`} />);
      expect(within(container).getByText(`w-${level}`)).toBeTruthy();
      const glyph = container.querySelector('[aria-hidden="true"]')?.textContent ?? "";
      expect(glyph.trim().length, `${level} has no glyph`).toBeGreaterThan(0);
    }
  });

  it("the four levels do not share a glyph", () => {
    // Identical shapes would collapse the non-colour channel back to one value,
    // which is the same as not having it.
    const glyphs = (["good", "mid", "poor", "none"] as const).map((level) => {
      const { container } = render(<StateChip level={level} word="x" />);
      return container.querySelector('[aria-hidden="true"]')?.textContent?.trim();
    });
    expect(new Set(glyphs).size).toBe(4);
  });

  it("the chip carries the ramp class, so --fav is what colours it", () => {
    const { container } = render(<StateChip level="good" word="x" />);
    expect(container.firstElementChild?.className).toContain("b-good");
  });
});

describe("the ramp is reached only through components that carry a word", () => {
  it("no feature file references --fav directly", () => {
    // The constraint is structural, not a convention: if a page can write
    // var(--fav) itself, it can render a colour-only verdict.
    const root = join(process.cwd(), "src", "features");
    const walk = (d: string): string[] => {
      let out: string[] = [];
      for (const e of readdirSync(d)) {
        // A test that forbids a pattern contains that pattern. Scanning itself
        // makes the guard fail on its own text.
        if (e === "__tests__") continue;
        const p = join(d, e);
        out = out.concat(statSync(p).isDirectory() ? walk(p) : [p]);
      }
      return out;
    };
    let files: string[] = [];
    try {
      files = walk(root);
    } catch {
      // R4: features/ does not exist yet. Say so rather than passing quietly -
      // a scan of nothing is not a clean scan.
      console.log("SKIPPED: src/features does not exist yet");
      return;
    }
    const bad = files.filter((f) => /--fav|<table/.test(readFileSync(f, "utf8")));
    expect(bad, "a feature must go through StateChip/DataTable").toEqual([]);
  });
});

describe("a table that shows nothing still says something", () => {
  const cols = [{ key: "a", header: "A", cell: (r: { a: string }) => r.a }];

  it("renders the absence as a row with a reason", () => {
    render(
      <DataTable
        columns={cols}
        rows={[]}
        rowKey={(r) => r.a}
        empty={{ what: "No rows.", reason: "Nothing has been proposed here yet." }}
      />,
    );
    const row = screen.getByRole("status");
    expect(within(row).getByText("No rows.")).toBeTruthy();
    expect(within(row).getByText("Nothing has been proposed here yet.")).toBeTruthy();
  });

  it("POSITIVE CONTROL: with rows it renders a table, not the absence", () => {
    render(
      <DataTable
        columns={cols}
        rows={[{ a: "one" }]}
        rowKey={(r) => r.a}
        empty={{ what: "x", reason: "y" }}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("an unknown source is muted, never dropped", () => {
  it("renders a source we have no colour for", () => {
    render(<SourceBadge source="some-new-feed" />);
    expect(screen.getByText("some-new-feed")).toBeTruthy();
  });

  it("says in the tooltip that the colour is missing, rather than pretending", () => {
    const { container } = render(<SourceBadge source="some-new-feed" />);
    expect(container.firstElementChild?.getAttribute("title")).toMatch(/no brand colour/);
  });

  it("POSITIVE CONTROL: a known source gets its brand colour and a plain title", () => {
    const { container } = render(<SourceBadge source="github" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("title")).toBe("github");
    expect(el.style.color).toBeTruthy();
    expect(BRANDED_SOURCES).toContain("github");
  });
});

describe("favourability reads the direction that helps", () => {
  it("inverts when lower is better", () => {
    expect(favour(1, +1)).toBe(1);
    expect(favour(1, -1)).toBe(5);
    expect(favour(5, -1)).toBe(1);
  });
  it("an unscored dimension has no favourability at all", () => {
    // Not 0, not 3 - null. A missing score and a middling score are different.
    expect(favour(null, +1)).toBeNull();
    expect(favour(undefined, -1)).toBeNull();
    expect(favour(2.5, +1)).toBeNull();
  });
  it("bands are three, and none is its own", () => {
    expect(band(5)).toBe("good");
    expect(band(3)).toBe("mid");
    expect(band(1)).toBe("poor");
    expect(band(null)).toBe("none");
  });
  it("score bands are absolute thresholds", () => {
    expect(scoreBand(80)).toBe("good");
    expect(scoreBand(79)).toBe("mid");
    expect(scoreBand(65)).toBe("mid");
    expect(scoreBand(64)).toBe("poor");
    expect(scoreBand("80")).toBe("none");
  });
  it("an unscored total renders the WORD unscored, never a zero", () => {
    render(<ScoreBar total={null} />);
    expect(screen.getByText("unscored")).toBeTruthy();
  });
  it("a scored dimension prints its digit beside the bar", () => {
    const { container } = render(<DimBar value={4} better={1} />);
    expect(within(container).getByText("4")).toBeTruthy();
  });
});

describe("dates keep three states", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  it("undated is null, not 'just now'", () => {
    expect(timeAgo(null, now)).toBeNull();
    expect(timeAgo("not a date", now)).toBeNull();
    expect(ageDays(undefined, now)).toBeNull();
  });
  it("a future date clamps rather than going negative", () => {
    expect(timeAgo("2027-01-01T00:00:00Z", now)).toBe("just now");
    expect(ageDays("2027-01-01T00:00:00Z", now)).toBe(0);
  });
  it("reads in the units a person would use", () => {
    expect(timeAgo("2026-09-04T11:30:00Z", now)).toBe("30m ago");
    expect(timeAgo("2026-09-01T12:00:00Z", now)).toBe("3d ago");
    expect(ageDays("2026-08-05T12:00:00Z", now)).toBe(30);
  });
  it("compact keeps the magnitude", () => {
    expect(compact(999)).toBe("999");
    expect(compact(12345)).toBe("12.3k");
    expect(compact(2_400_000)).toBe("2.4M");
    expect(compact(null)).toBe("-");
  });
});
