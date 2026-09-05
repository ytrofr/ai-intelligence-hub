import { useNavigate, useParams } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi, useApiText } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { digestDate, digestLabel } from "./digestFile";

interface DigestList { digests: string[] }

/**
 * The written-up version, one per week.
 *
 * The URL carries the DATE, not the filename - it is the shorter, stabler half
 * and it is what the API already speaks. `digestFile.ts` holds the translation
 * between the two vocabularies, which is where this page was broken.
 *
 * The raw-markdown link is kept. It is the only way to read a digest that the
 * renderer cannot mangle, and it is how the operator checks a digest against
 * what was actually written.
 */
export function DigestsPage() {
  const { date } = useParams<{ date?: string }>();
  const nav = useNavigate();
  const list = useApi<DigestList>("/digest");
  const d = destinationById("digests")!;

  return (
    <PageShell
      title="Digests"
      blurb={d.blurb}
      width="prose"
      actions={
        <Async query={list} what="the digest list">
          {(l) => {
            const dates = l.digests.map(digestDate).filter((x): x is string => x !== null);
            const chosen = date ?? dates[0] ?? "";
            return (
              <Select value={chosen} onValueChange={(v) => nav(`/digests/${v}`)}>
                <SelectTrigger className="h-8 w-40 sm:w-56" aria-label="Choose a digest">
                  <SelectValue placeholder="pick a week" />
                </SelectTrigger>
                <SelectContent>
                  {l.digests.map((f) => {
                    const iso = digestDate(f);
                    if (!iso) return null;
                    return <SelectItem key={f} value={iso}>{digestLabel(f)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            );
          }}
        </Async>
      }
    >
      <Async query={list} what="the digest list">
        {(l) => {
          const named = l.digests.map((f) => ({ file: f, date: digestDate(f) }));
          const usable = named.filter((n) => n.date !== null);
          // A file we cannot name is a ROW, not a silent omission - and it is a
          // different finding from having no digests at all. Forwarding it to
          // the API to be refused there would read to the operator as a broken
          // backend rather than a file we could not parse.
          const unnamed = named.filter((n) => n.date === null).map((n) => n.file);

          if (usable.length === 0) {
            return (
              <AbsenceRow
                tone="loud"
                what={unnamed.length ? "No digest could be named." : "No digests have been written."}
                reason={
                  unnamed.length
                    ? `${unnamed.length} file(s) do not match weekly-YYYY-MM-DD.md: ${unnamed.join(", ")}`
                    : "Nothing has run the weekly write-up yet, so there is no file to read."
                }
              />
            );
          }

          const chosen = date ?? usable[0].date!;
          return (
            <div className="space-y-4">
              <One date={chosen} />
              {unnamed.length > 0 && (
                <AbsenceRow
                  what={`${unnamed.length} file(s) in the digests folder could not be named.`}
                  reason={`Expected weekly-YYYY-MM-DD.md, got: ${unnamed.join(", ")}`}
                />
              )}
            </div>
          );
        }}
      </Async>
    </PageShell>
  );
}

function One({ date }: { date: string }) {
  // `/api/digest/:date` answers text/markdown, so this reads TEXT. The JSON
  // reader threw on the content type before the body was ever seen, which is
  // half of why this page had never worked.
  const body = useApiText(`/digest/${encodeURIComponent(date)}`);
  return (
    <div className="space-y-4">
      <Async query={body} what={`the digest for ${date}`}>
        {(text) => {
          if (!text.trim()) {
            return (
              <AbsenceRow
                what="That digest is empty."
                reason="The file exists but has no content - which is a different problem from it being missing."
              />
            );
          }
          return (
            // Rendered as preformatted text on purpose: this is the operator's
            // own writing and a markdown renderer that re-flows or drops a line
            // makes it harder, not easier, to check against the source.
            // break-words as well as pre-wrap: pre-wrap breaks at spaces, and a
            // markdown line carrying a long URL or a table rule has none, so it
            // pushed the whole page sideways on a phone - 228px over at 390.
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-card p-5 font-mono text-xs leading-relaxed">
              {text}
            </pre>
          );
        }}
      </Async>
      <p className="text-xs text-muted-foreground">
        <a href={`/api/digest/${encodeURIComponent(date)}`} target="_blank" rel="noreferrer"
           className="text-primary hover:underline">
          read the raw markdown →
        </a>{" "}
        the one view nothing here can have mangled.
      </p>
    </div>
  );
}
