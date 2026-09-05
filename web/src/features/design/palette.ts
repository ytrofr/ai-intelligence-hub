import { contrast } from "@/lib/contrast";
import type { Band } from "@/lib/favour";

/**
 * The arithmetic behind the design-system page.
 *
 * The point of this file is that the gallery reads the RESOLVED value of every
 * role - what the browser actually computed for the theme currently painted -
 * rather than a list of hexes typed beside the swatches. A gallery whose
 * colours are its own constants is a picture of what someone believed the
 * tokens were, and it stays green through the exact drift it exists to catch.
 *
 * So the reader is INJECTED. In the app it is getComputedStyle; in a test it is
 * a map. Neither the parsing nor the contrast maths knows the difference, which
 * is the only reason either can be tested at all - jsdom applies no stylesheet,
 * so a live read there resolves to nothing.
 */

/** How a shadcn role is stored: bare HSL channels, e.g. `225 21.1% 7.5%`. */
const CHANNELS = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/;

/**
 * `225 21.1% 7.5%` -> `#0f1117`.
 *
 * Returns null rather than a fallback colour for anything it cannot parse. An
 * unresolved role must render as "not resolved" on the page: inventing a hex
 * for it would put a swatch on screen for a token that does not exist, which is
 * the one failure this page is supposed to make visible.
 */
export function hslChannelsToHex(channels: string): string | null {
  const m = CHANNELS.exec(channels);
  if (!m) return null;
  const h = (((Number(m[1]) % 360) + 360) % 360) / 60;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const rgb =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const base = l - c / 2;
  return (
    "#" +
    rgb
      .map((v) => Math.round((v + base) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Reads one custom property. `getComputedStyle(...).getPropertyValue` shaped. */
export type RoleReader = (name: string) => string;

export interface Swatch {
  role: string;
  /** The raw channels as declared, kept so the page can show what it read. */
  channels: string;
  /** null when the role is absent or unparseable - never a substitute colour. */
  hex: string | null;
}

export function swatch(read: RoleReader, role: string): Swatch {
  const channels = (read(`--${role}`) ?? "").trim();
  return { role, channels, hex: hslChannelsToHex(channels) };
}

/** The role groups, in the order the page shows them. */
export const ROLE_GROUPS: { title: string; note: string; roles: string[] }[] = [
  {
    title: "Surfaces",
    note: "What things are painted ON. Nothing here is ever a text colour.",
    roles: ["background", "card", "popover", "muted", "secondary", "accent", "primary", "destructive"],
  },
  {
    title: "Ink",
    note: "Text colours. Each one belongs to a surface, and is measured against it below.",
    roles: [
      "foreground", "card-foreground", "muted-foreground", "text-dim", "link",
      "primary-foreground", "secondary-foreground", "accent-foreground", "destructive-foreground",
    ],
  },
  {
    title: "Semantics",
    note: "The hub's own, not shadcn's. Always beside a glyph and a word - never the only channel.",
    roles: ["success", "warning", "info"],
  },
  {
    title: "Lines",
    note: "Borders, field outlines and the focus ring.",
    roles: ["border", "input", "ring"],
  },
  {
    title: "The rail",
    note: "The sidebar is a shade under the page, so it reads as a rail rather than as more page.",
    roles: [
      "sidebar-background", "sidebar-foreground", "sidebar-primary",
      "sidebar-primary-foreground", "sidebar-accent", "sidebar-accent-foreground",
      "sidebar-border", "sidebar-ring",
    ],
  },
];

/**
 * The ink/surface pairs that actually occur in the app.
 *
 * A contrast number is meaningless without naming the surface, so every pair
 * here is one the app really paints - `--text-dim` on the card is the single
 * most-used piece of text in the product, and it is the one that measured
 * 4.18:1 and had to be re-solved.
 */
export const PAIRS: { ink: string; on: string; where: string }[] = [
  { ink: "foreground", on: "background", where: "body text on the page" },
  { ink: "card-foreground", on: "card", where: "text inside a card" },
  { ink: "muted-foreground", on: "card", where: "a card's secondary line" },
  { ink: "text-dim", on: "card", where: "the app's own dim - the most-used text there is" },
  { ink: "link", on: "card", where: "a link inside a card" },
  { ink: "primary-foreground", on: "primary", where: "a primary button's label" },
  { ink: "secondary-foreground", on: "secondary", where: "a secondary button's label" },
  { ink: "accent-foreground", on: "accent", where: "a hovered row" },
  { ink: "destructive-foreground", on: "destructive", where: "a destructive button's label" },
  { ink: "sidebar-foreground", on: "sidebar-background", where: "the rail's own text" },
];

export interface Measured {
  ink: Swatch;
  surface: Swatch;
  where: string;
  /** null when either side failed to resolve - "not measured", never 0. */
  ratio: number | null;
}

export function measure(read: RoleReader, pair: { ink: string; on: string; where: string }): Measured {
  const ink = swatch(read, pair.ink);
  const surface = swatch(read, pair.on);
  return {
    ink,
    surface,
    where: pair.where,
    ratio: ink.hex && surface.hex ? contrast(ink.hex, surface.hex) : null,
  };
}

/**
 * The verdict, as a band AND a word.
 *
 * `none` is "not measured" and is deliberately not the same as "failed": a
 * value we could not read and a value that is too low are different findings,
 * and collapsing them would let a broken reader report a clean page.
 */
export function verdict(ratio: number | null): { band: Band; word: string } {
  if (ratio === null) return { band: "none", word: "not measured" };
  if (ratio >= 7) return { band: "good", word: "AAA" };
  if (ratio >= 4.5) return { band: "good", word: "AA" };
  if (ratio >= 3) return { band: "mid", word: "large text only" };
  return { band: "poor", word: "under the floor" };
}

/**
 * What was asked for and never arrived.
 *
 * One side of this is DERIVED from the filesystem and the other is declared, so
 * the gap list cannot quietly agree with itself: a component that is deleted
 * reappears here, and one that is added disappears from here without anybody
 * remembering to edit a list.
 */
export function missing(requested: readonly string[], present: readonly string[]): string[] {
  const have = new Set(present);
  return requested.filter((r) => !have.has(r)).sort();
}

/**
 * The `shadcn add` batch this app's plan asked for. The eight that never landed
 * are not an oversight - nothing in ten routes has needed a modal, a toast or a
 * command palette yet - but an unbuilt primitive that nobody has written down
 * is indistinguishable from one that was forgotten.
 */
export const REQUESTED_UI = [
  "alert", "badge", "breadcrumb", "button", "card", "collapsible", "command",
  "dialog", "dropdown-menu", "input", "label", "popover", "scroll-area",
  "select", "separator", "sheet", "sidebar", "skeleton", "sonner", "switch",
  "table", "tabs", "tooltip",
] as const;
