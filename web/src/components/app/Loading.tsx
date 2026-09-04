import { Skeleton } from "@/components/ui/skeleton";
import { AbsenceRow } from "./AbsenceRow";
import type { Async } from "@/lib/useApi";
import type { ReactNode } from "react";

/**
 * The three states of a fetch, rendered so they cannot be mistaken for one
 * another: a skeleton while it is in flight, a LOUD row naming the failure when
 * it fails, and the content when it arrives.
 *
 * A component that renders `null` while loading and `null` on error tells the
 * reader the same thing in both cases, and that thing is false in one of them.
 */
export function Async<T>({
  query,
  what,
  children,
}: {
  query: Async<T>;
  /** What was being fetched, in the reader's words - "the ledger", not "/api/ledger". */
  what: string;
  children: (data: T) => ReactNode;
}) {
  if (query.state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={`Loading ${what}`}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-11/12" />
        <Skeleton className="h-9 w-10/12" />
      </div>
    );
  }
  if (query.state === "error") {
    return (
      <AbsenceRow
        tone="loud"
        what={`Could not load ${what}.`}
        reason={query.error.message}
      />
    );
  }
  return <>{children(query.data)}</>;
}
