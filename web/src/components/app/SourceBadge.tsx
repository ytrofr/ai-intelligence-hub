import { cn } from "@/lib/utils";

/**
 * A source's own brand colour. The ONLY route to them.
 *
 * These are not shadcn roles and never will be - they are eleven third parties'
 * marks, not semantics of ours. A source we have no colour for renders MUTED
 * rather than vanishing or falling back to the brand, because a page that
 * quietly drops an unrecognised source is a page that under-reports.
 */
const BRAND: Record<string, string> = {
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

export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const colour = BRAND[source];
  return (
    <span
      title={colour ? source : `${source} - no brand colour on file`}
      style={colour ? { color: colour, borderColor: `${colour}59`, background: `${colour}1a` } : undefined}
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs",
        !colour && "border-border bg-muted text-dim",
        className,
      )}
    >
      {source}
    </span>
  );
}

/** Exported so a test can assert the list only ever grows. */
export const BRANDED_SOURCES = Object.keys(BRAND);
