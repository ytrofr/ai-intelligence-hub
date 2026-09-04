import { useParams } from "react-router-dom";
import { PageShell } from "@/components/app/PageShell";
import { Async } from "@/components/app/Loading";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi } from "@/lib/useApi";
import { destinationById } from "@/components/app/nav";
import { useNavigate } from "react-router-dom";

interface DigestList { digests: string[] }

/**
 * The written-up version, one per week.
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
          {(l) => (
            <Select value={date ?? l.digests[0] ?? ""} onValueChange={(v) => nav(`/digests/${v}`)}>
              <SelectTrigger className="h-8 w-64" aria-label="Choose a digest">
                <SelectValue placeholder="pick a week" />
              </SelectTrigger>
              <SelectContent>
                {l.digests.map((f) => (
                  <SelectItem key={f} value={f} className="font-mono text-xs">{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Async>
      }
    >
      <Async query={list} what="the digest list">
        {(l) => {
          const chosen = date ?? l.digests[0];
          if (!chosen) {
            return (
              <AbsenceRow
                tone="loud"
                what="No digests have been written."
                reason="Nothing has run the weekly write-up yet, so there is no file to read."
              />
            );
          }
          return <One file={chosen} />;
        }}
      </Async>
    </PageShell>
  );
}

function One({ file }: { file: string }) {
  const body = useApi<{ content?: string; markdown?: string }>(`/digest/${encodeURIComponent(file)}`);
  return (
    <div className="space-y-4">
      <Async query={body} what={file}>
        {(b) => {
          const text = b.content ?? b.markdown ?? "";
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
            <pre className="whitespace-pre-wrap rounded-lg border bg-card p-5 font-mono text-xs leading-relaxed">
              {text}
            </pre>
          );
        }}
      </Async>
      <p className="text-xs text-muted-foreground">
        <a href={`/api/digest/${encodeURIComponent(file)}`} target="_blank" rel="noreferrer"
           className="text-primary hover:underline">
          read the raw markdown →
        </a>{" "}
        the one view nothing here can have mangled.
      </p>
    </div>
  );
}
