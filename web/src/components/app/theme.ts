/**
 * Which token set is painted.
 *
 * The palette for both themes already exists in tokens.css - `:root` is light,
 * `.dark` is dark - so switching is one class on <html>. What this file adds is
 * the part that is easy to get wrong: the choice has to be applied BEFORE the
 * first paint, or the app flashes the wrong theme on every load, and that means
 * a snippet in index.html runs before this module is even fetched.
 *
 * Two constants are therefore duplicated into that snippet, and `theme.test.ts`
 * reads index.html and asserts they still match. A boot script that disagrees
 * with this module about the storage key is invisible in every test that only
 * imports the module: the app works, remembers nothing, and flashes.
 */
export type Theme = "dark" | "light";

/** Also spelled in the index.html boot snippet. Changing one changes both. */
export const THEME_KEY = "theme";

/**
 * Dark, by the operator's ruling, and deliberately NOT `prefers-color-scheme`.
 * Light is a choice made here, not a default inherited from the OS.
 */
export const DEFAULT_THEME: Theme = "dark";

export function readTheme(): Theme {
  try {
    // Anything that is not the exact opt-in string is the default. A corrupted
    // or half-written value must not produce a third state.
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : DEFAULT_THEME;
  } catch {
    // Storage blocked is not a broken app; it just does not remember.
    return DEFAULT_THEME;
  }
}

export function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* see above */ }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Tells the BROWSER's own chrome - scrollbars, form controls, the caret, the
  // canvas behind an overscroll - which way round we are. Without it a light
  // page keeps dark scrollbars, which is the tell that a theme is a stylesheet
  // trick rather than a real mode.
  root.style.colorScheme = theme;
}
