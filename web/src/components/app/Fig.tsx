/** A stat tile: the number, then its label. Shared by the Matrix and Scorecard strips. */
export function Fig({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-mono text-lg tabular-nums">{n}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-dim">{label}</div>
    </div>
  );
}
