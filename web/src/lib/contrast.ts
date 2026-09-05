/**
 * WCAG contrast arithmetic, and one derivation built on it.
 *
 * This exists because eleven third-party brand colours have to be readable on
 * two different surfaces, and hand-picking twenty-two values means the twelfth
 * source someone adds gets whatever they guessed. Deriving them from the one
 * list of brands means a new source cannot ship an unreadable badge - and a
 * test can assert every combination, which no amount of care can.
 */

const HEX = /^#?([0-9a-f]{6})$/i;

export function toRgb(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = (hex: string): number => {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export function contrast(a: string, b: string): number {
  const [hi, lo] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** src painted over dst at `alpha` - what the compositor puts on the screen. */
export function over(src: string, dst: string, alpha: number): string {
  const s = toRgb(src);
  const d = toRgb(dst);
  return toHex(s.map((v, i) => v * alpha + d[i] * (1 - alpha)));
}

/**
 * The nearest version of `colour` that clears `target` against `surface`.
 *
 * Moves toward black or white - whichever direction the surface is not - in
 * small steps, and returns the FIRST value that clears. Nearest, so the brand
 * is recognisably itself: hue and saturation are untouched, only how light it
 * is moves, and only as far as it has to.
 *
 * Returns the extreme (black or white) if the target is unreachable, which is
 * honest: that is the most readable version of the colour that exists.
 */
export function readableInk(colour: string, surface: string, target = 4.5): string {
  if (contrast(colour, surface) >= target) return toHex(toRgb(colour));
  const toward = luminance(surface) > 0.18 ? 0 : 255;
  const src = toRgb(colour);
  let best = toHex(src.map(() => toward));
  for (let step = 1; step <= 100; step++) {
    const t = step / 100;
    const candidate = toHex(src.map((v) => v * (1 - t) + toward * t));
    if (contrast(candidate, surface) >= target) {
      best = candidate;
      break;
    }
  }
  return best;
}
