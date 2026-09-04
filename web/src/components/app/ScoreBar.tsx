import { band, favour, scoreBand } from "@/lib/favour";
import { NoValue } from "./StateChip";
import { cn } from "@/lib/utils";

/**
 * A 1-5 dimension. The FILLED length is the raw value; the colour is the
 * favourability; the digit is printed beside it. Three channels for one number,
 * so removing any one of them still leaves the value readable.
 */
export function DimBar({ value, better }: { value: unknown; better: number }) {
  if (!Number.isInteger(value)) return <NoValue title="not scored on this dimension" />;
  const v = value as number;
  const b = band(favour(v, better));
  return (
    <span className={cn("b-" + b, "inline-flex items-center gap-1.5")}>
      <span className="flex gap-px" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <i
            key={i}
            className={cn(
              "block h-3 w-1 rounded-[1px]",
              i <= v ? "bg-[color:var(--fav)]" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="font-mono text-xs tabular-nums">{v}</span>
    </span>
  );
}

/**
 * The total. `unscored` is a WORD, not an empty cell and not a zero - a nobody-
 * looked-at-this row and a scored-badly row are different findings.
 */
export function ScoreBar({ total }: { total: unknown }) {
  if (typeof total !== "number") return <NoValue title="nobody has scored this yet">unscored</NoValue>;
  const b = scoreBand(total);
  return (
    <span className={cn("b-" + b, "inline-flex items-center gap-2")}>
      <span className="font-mono text-sm font-semibold tabular-nums text-[color:var(--fav)]">{total}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border" aria-hidden>
        <i className="block h-full bg-[color:var(--fav)]" style={{ width: `${Math.min(100, total)}%` }} />
      </span>
    </span>
  );
}
