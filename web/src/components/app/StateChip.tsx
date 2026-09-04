import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Band } from "@/lib/favour";

/**
 * The ONLY route to the favourability ramp.
 *
 * `glyph` and `word` are required, not optional, so a colour-only verdict is
 * not expressible in this codebase. That is a hard constraint rather than a
 * convention: the person these pages are for cannot distinguish red from green,
 * and on a page where the ramp IS the signal a hue-only chip is an unreadable
 * page rather than an ugly one.
 *
 * shadcn's own <Badge> is deliberately NOT used for state. It is colour-only,
 * which is the one channel that cannot be relied on here.
 */
export type Level = Band;

const GLYPH: Record<Level, string> = {
  good: "✓",
  mid: "•",
  poor: "▲",
  none: "◇",
};

export function StateChip({
  level,
  word,
  title,
  glyph,
  className,
}: {
  level: Level;
  /** The state in words. Required - this is the channel that always survives. */
  word: string;
  title?: string;
  /** Override the default shape. Still required to BE a shape. */
  glyph?: string;
  className?: string;
}) {
  const mark = glyph ?? GLYPH[level];
  return (
    <span
      title={title}
      className={cn(
        "b-" + level,
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        "border-[color:var(--fav)]/35 bg-[color:var(--fav)]/10 text-[color:var(--fav)]",
        className,
      )}
    >
      <span aria-hidden className="font-mono leading-none">{mark}</span>
      <span className="truncate">{word}</span>
    </span>
  );
}

/** A dash that means "we have no value", never a blank cell. */
export function NoValue({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <span title={title} className="text-dim">
      {children ?? "-"}
    </span>
  );
}
