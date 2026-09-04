import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * An absence is a ROW, never a missing row.
 *
 * The house rule this app is built on: a project with nothing in it renders as
 * zeros, a slot nobody proposed anything for renders LOUDEST, and a repo we
 * cannot read reports "unknown" rather than 0. Rendering nothing is the one
 * answer that is always wrong, because it is indistinguishable from "everything
 * here is fine".
 *
 * `reason` is required. "No data" is not a reason - it repeats the observation.
 * The reason says what would have to be true for there to be data.
 */
export function AbsenceRow({
  what,
  reason,
  tone = "neutral",
  action,
}: {
  what: string;
  reason: string;
  tone?: "neutral" | "loud";
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm",
        tone === "loud" ? "border-warning/40 bg-warning/5" : "border-dashed bg-muted/30",
      )}
    >
      {/* A glyph and a word, so the state survives without colour. */}
      <span aria-hidden className={cn("font-mono", tone === "loud" ? "text-warning" : "text-dim")}>
        {tone === "loud" ? "▲" : "◇"}
      </span>
      <span className="font-medium">{what}</span>
      <span className="text-muted-foreground">{reason}</span>
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}
