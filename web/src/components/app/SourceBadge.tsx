import { cn } from "@/lib/utils";
import { over, readableInk } from "@/lib/contrast";

/**
 * A source's own brand colour. The ONLY route to them.
 *
 * These are not shadcn roles and never will be - they are eleven third parties'
 * marks, not semantics of ours. A source we have no colour for renders MUTED
 * rather than vanishing or falling back to the brand, because a page that
 * quietly drops an unrecognised source is a page that under-reports.
 */
export const BRAND: Record<string, string> = {
  github: "#238636",
  huggingface: "#ff9d00",
  hackernews: "#ff6600",
  producthunt: "#da552f",
  anthropic: "#d97706",
  openai: "#10a37f",
  mcp: "#6366f1",
  ainews: "#8b5cf6",
  techcrunch: "#00aa00",
  "claude-code-releases": "#cc785c",
  "claude-code-docs": "#e8956a",
};

/**
 * The two surfaces a badge is ever painted on: its own 10% tint, over the card
 * of each theme. The tint is what the label actually sits on, not the card.
 */
const TINT_UNDER = { light: "#ffffff", dark: "#1a1d28" } as const;

/**
 * The label's ink, per theme, derived rather than chosen.
 *
 * A brand colour is picked to work on the owner's own site and owes us nothing.
 * Six of these eleven measured under 4.5:1 on their own tint in one theme or
 * the other - huggingface's orange came out at 1.93:1 on white, which is a
 * source name nobody can read. The BORDER and the TINT keep the brand exactly;
 * only the ink moves, and only as far as the floor requires.
 */
export const BRAND_INK: Record<string, { light: string; dark: string }> = Object.fromEntries(
  Object.entries(BRAND).map(([id, c]) => [
    id,
    {
      light: readableInk(c, over(c, TINT_UNDER.light, 0.1)),
      dark: readableInk(c, over(c, TINT_UNDER.dark, 0.1)),
    },
  ]),
);

export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const colour = BRAND[source];
  const ink = BRAND_INK[source];
  return (
    <span
      title={colour ? source : `${source} - no brand colour on file`}
      style={
        colour
          ? ({
              borderColor: `${colour}59`,
              background: `${colour}1a`,
              "--brand-ink-light": ink.light,
              "--brand-ink-dark": ink.dark,
            } as React.CSSProperties)
          : undefined
      }
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs",
        colour
          ? "text-[color:var(--brand-ink-light)] dark:text-[color:var(--brand-ink-dark)]"
          : "border-border bg-muted text-dim",
        className,
      )}
    >
      {source}
    </span>
  );
}

/** Exported so a test can assert the list only ever grows. */
export const BRANDED_SOURCES = Object.keys(BRAND);
