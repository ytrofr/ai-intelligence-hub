import "@testing-library/jest-dom/vitest";

/**
 * jsdom has no matchMedia, and the sidebar's mobile hook calls it on mount.
 * Defaulting `matches` to false means components render their DESKTOP branch in
 * tests - stated here rather than left implicit, because a suite that silently
 * only ever exercised the mobile branch would look identical from the outside.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
