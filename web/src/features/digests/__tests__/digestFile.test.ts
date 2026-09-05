/**
 * The translation the Digests page was missing.
 *
 * `/api/digest` returns FILENAMES and `/api/digest/:date` takes a DATE. Nothing
 * sat between them, so the page passed "weekly-2026-09-03.md" where a date was
 * expected and the operator got "Invalid date format; expected YYYY-MM-DD" on a
 * page that had never worked.
 */

import { describe, expect, it } from "vitest";
import { digestDate, digestLabel } from "../digestFile";

describe("digestDate", () => {
  it("extracts the date from the filename the API really returns", () => {
    // Verbatim from `curl localhost:4444/api/digest` on 2026-09-05.
    for (const f of [
      "weekly-2026-09-03.md",
      "weekly-2026-08-31.md",
      "weekly-2026-05-08.md",
    ]) {
      expect(digestDate(f)).toBe(f.slice(7, 17));
    }
  });

  it("returns null rather than a half-parsed guess", () => {
    // Each of these would become a 400 from the server if forwarded, which
    // reads to the operator as a broken backend rather than an odd filename.
    for (const bad of [
      "weekly-2026-9-3.md",       // not zero-padded
      "weekly-2026-09-03.txt",    // wrong extension
      "daily-2026-09-03.md",      // wrong prefix
      "weekly-2026-09-03",        // no extension
      "2026-09-03.md",            // no prefix
      "",
    ]) {
      expect(digestDate(bad), bad).toBeNull();
    }
  });
});

describe("digestLabel", () => {
  it("reads the date from the STRING, never through a Date object", () => {
    // new Date("2026-09-03") is UTC midnight, which is 2 Sep for any viewer
    // west of UTC. The label must agree with the filename, always.
    expect(digestLabel("weekly-2026-09-03.md")).toBe("week of 3 Sep 2026");
    expect(digestLabel("weekly-2026-01-01.md")).toBe("week of 1 Jan 2026");
    expect(digestLabel("weekly-2026-12-31.md")).toBe("week of 31 Dec 2026");
  });

  it("falls back to the raw filename when it cannot be named", () => {
    expect(digestLabel("something-else.md")).toBe("something-else.md");
  });
});
