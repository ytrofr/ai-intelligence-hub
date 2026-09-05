/**
 * The theme's invariants.
 *
 * The one that matters most is the LAST one: the snippet in index.html and the
 * module in theme.ts each hold the storage key and the default, and nothing in
 * the type system connects them. A drift there is invisible from inside the
 * module - every cell below would still pass while the real app forgot the
 * reader's choice on every load and flashed the wrong theme on the way.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEME_KEY, applyTheme, readTheme, writeTheme } from "../theme";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
  vi.restoreAllMocks();
});

describe("which theme is painted", () => {
  it("defaults to dark, which is the operator's ruling and not the OS's", () => {
    expect(readTheme()).toBe("dark");
    expect(DEFAULT_THEME).toBe("dark");
  });

  it("returns light only for the exact opt-in value", () => {
    localStorage.setItem(THEME_KEY, "light");
    expect(readTheme()).toBe("light");
    for (const junk of ["LIGHT", "lite", "", "true", "{}"]) {
      localStorage.setItem(THEME_KEY, junk);
      expect(readTheme(), `"${junk}" must not become a third state`).toBe("dark");
    }
  });

  it("survives storage being blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readTheme()).toBe("dark");
    expect(() => writeTheme("light")).not.toThrow();
  });

  it("applies the class AND tells the browser's own chrome", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

describe("the boot snippet and the module agree", () => {
  it("index.html applies a theme BEFORE the bundle loads", () => {
    const script = html.indexOf('localStorage.getItem("theme")');
    const bundle = html.indexOf("/src/main.tsx");
    expect(script, "no boot snippet - the app will flash the wrong theme").toBeGreaterThan(-1);
    expect(script, "the snippet must run before the bundle, or it is pointless").toBeLessThan(bundle);
  });

  it("the snippet uses this module's key and this module's default", () => {
    expect(html).toContain(`localStorage.getItem("${THEME_KEY}")`);
    // The snippet's own fallback, spelled where a drift would show.
    expect(html).toMatch(/var t = "(\w+)"/);
    expect(RegExp(`var t = "${DEFAULT_THEME}"`).test(html)).toBe(true);
  });

  it("the snippet does not hardcode a theme onto <html> as well", () => {
    // A `class="dark"` attribute would win against a stored `light` for as long
    // as it took the snippet to run, which is the flash this exists to remove.
    expect(html).not.toMatch(/<html[^>]*class=/);
  });
});
