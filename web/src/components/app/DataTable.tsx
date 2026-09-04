import type { ReactNode } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AbsenceRow } from "./AbsenceRow";
import { cn } from "@/lib/utils";

/**
 * The ONE table.
 *
 * The pages this replaces had six independent table implementations and no
 * shared table style, which is why no two of them aligned, sorted or wrapped
 * the same way. `features/**` may not render a <table> at all - a test asserts
 * it - so every table in the app comes through here.
 *
 * `empty` is required. A table that renders zero rows and says nothing is
 * indistinguishable from a table that failed to load, and this app's whole
 * premise is that an absence is a row.
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Right-align numbers so they can be compared down the column. */
  numeric?: boolean;
  /** Hidden below `sm`. For columns that are context rather than content. */
  secondary?: boolean;
  width?: string;
  cell: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: { what: string; reason: string };
  caption?: ReactNode;
}) {
  if (rows.length === 0) {
    return <AbsenceRow what={empty.what} reason={empty.reason} />;
  }
  return (
    <div className="space-y-3">
      {/* Wide content scrolls INSIDE its own container. The page body never
          scrolls sideways - that is what makes a table unusable on a phone. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(
                    "whitespace-nowrap",
                    c.numeric && "text-right",
                    c.secondary && "hidden sm:table-cell",
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={rowKey(r)}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      "align-top",
                      c.numeric && "text-right tabular-nums",
                      c.secondary && "hidden sm:table-cell",
                    )}
                  >
                    {c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
