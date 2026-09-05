/**
 * The digest renderer, measured against what the generator actually writes.
 *
 * The cell that matters is the GUARD: it drives the REAL generator and asserts
 * the renderer has a rule for every construct that comes out. The others would
 * all pass against a renderer handling only the four constructs I happened to
 * think of while writing it.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isBlankBullet, renderMarkdown, unsupportedConstructs } from "../markdown";

const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, "../../../..");

function draw(src: string) {
  return render(<div data-testid="md">{renderMarkdown(src)}</div>);
}

describe("the digest renderer", () => {
  it("POSITIVE CONTROL: unsupportedConstructs FIRES on what it claims to catch", () => {
    // Without this, an empty result below is indistinguishable from a scanner
    // whose patterns never match anything.
    expect(unsupportedConstructs("| a | b |")).toContain("table row");
    expect(unsupportedConstructs("```js\nx\n```")).toContain("fenced code block");
    expect(unsupportedConstructs("![alt](x.png)")).toContain("image");
    expect(unsupportedConstructs("<div>")).toContain("raw HTML block");
  });

  it("a horizontal rule is NOT reported as an unsupported setext heading", () => {
    // The digest ends with one. A scanner that flagged it would red forever
    // and get switched off, which is worse than not having it.
    expect(unsupportedConstructs("---")).toEqual([]);
  });

  it("headings become headings, at the right level", () => {
    draw("# Weekly\n## TL;DR\n### Rising Stars");
    expect(screen.getByRole("heading", { level: 2, name: "Weekly" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "TL;DR" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Rising Stars" })).toBeTruthy();
  });

  it("a link becomes a real link, opening away from the app", () => {
    draw("- **[QuantumNous/new-api](https://github.com/QuantumNous/new-api)** · 47,181★");
    const a = screen.getByRole("link", { name: "QuantumNous/new-api" });
    expect(a.getAttribute("href")).toBe("https://github.com/QuantumNous/new-api");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("a javascript: href renders as text and NEVER as a link", () => {
    // The digest is built from third-party titles and URLs. This is the one
    // place generated content reaches an href.
    draw("[click me](javascript:alert(1))");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("md").textContent).toContain("click me");
  });

  it("nesting is preserved - a sub-bullet is indented, not flattened", () => {
    const { container } = draw("- top\n  - detail\n    - deeper");
    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(3);
    expect(items[0].className).not.toContain("ml-");
    expect(items[1].className).toContain("ml-5");
    expect(items[2].className).toContain("ml-10");
  });

  it("no markup survives into the reader's text", () => {
    const t = draw("**bold** and _quiet_ and `code`").container.textContent ?? "";
    expect(t).toBe("bold and quiet and code");
  });

  it("THE GUARD: the real generator emits nothing this renderer cannot draw", () => {
    // Drives modules/weekly-digest.js itself rather than a fixture, so a new
    // construct in the generator reds HERE instead of printing pipes at a
    // reader. Hermetic: fixture items, no database.
    const { formatDigest } = require(path.join(REPO, "modules", "weekly-digest.js"));
    const md: string = formatDigest({
      runDate: "2026-09-03",
      channelStats: { fetch: "skipped" },
      items: [
        { title: "acme/thing", url: "https://github.com/acme/thing", stars: 4200,
          description: "A thing.",
          metadata: JSON.stringify({ language: "Go", match_reason: "Found via watchlist" }) },
        { title: "acme/other", url: "https://github.com/acme/other", stars: 300,
          description: "", metadata: "{}" },
      ],
    });
    expect(md.length).toBeGreaterThan(200);
    expect(unsupportedConstructs(md)).toEqual([]);
    // And the empty-emphasis regression: an item with no reason must not
    // produce a bullet whose entire content is `__`.
    expect(md).not.toMatch(/^\s*- __\s*$/m);
  });

  it("THE LOCAL CORPUS: every digest on this machine renders, or says it was not measured", () => {
    let files: string[] = [];
    try {
      files = readdirSync(path.join(REPO, "digests")).filter((f) => f.endsWith(".md"));
    } catch { /* no digests dir - reported below, never silently passed */ }
    if (files.length === 0) {
      // Not a pass. The digests are gitignored, so CI legitimately has none -
      // this states that plainly instead of reading as a clean check.
      console.warn("markdown.test: NOT MEASURED - no local digests/*.md to check against");
      expect(files).toEqual([]);
      return;
    }
    const bad: string[] = [];
    for (const f of files) {
      const found = unsupportedConstructs(readFileSync(path.join(REPO, "digests", f), "utf8"));
      if (found.length) bad.push(`${f}: ${found.join(", ")}`);
    }
    expect(bad, `population: ${files.length} digest(s)`).toEqual([]);
  });
});

describe("bullets that carry nothing", () => {
  it("POSITIVE CONTROL: a bullet WITH content is never dropped", () => {
    // Without this, `isBlankBullet` returning true for everything would make
    // the drop-test below pass against a renderer that draws no bullets at all.
    const { container } = draw("- real content\n- __");
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("real content");
  });

  it("the historical `- __` bullets are dropped, not drawn as a stray dash", () => {
    // Four digests on disk still carry these. Rewriting the operator's own
    // archive to fix a display bug is the wrong half to change.
    const { container } = draw("- **[a/b](https://x.test)** · 5★\n  - a description\n  - __");
    expect(container.textContent).not.toContain("__");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("isBlankBullet reads content, not length", () => {
    expect(isBlankBullet("__")).toBe(true);
    expect(isBlankBullet("****")).toBe(true);
    expect(isBlankBullet("  ")).toBe(true);
    expect(isBlankBullet("_x_")).toBe(false);
    expect(isBlankBullet("0")).toBe(false);
  });
});
