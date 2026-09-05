/**
 * A markdown renderer for the digest, and only for the digest.
 *
 * The digest page shipped the file inside a <pre>. The reasoning written in
 * that component was that a renderer can re-flow or drop a line, so raw text
 * is safer to check against the source. That is true and it is beside the
 * point: a 700-line wall of `**[repo](url)** · 47,181★` is not something a
 * person reads, so the safety was bought with the whole purpose of the page.
 * The raw link stays for checking. This is for reading.
 *
 * It is deliberately NOT a general markdown implementation. The input is
 * written by modules/weekly-digest.js and modules/digest-sections.js, so the
 * vocabulary is finite and known: headings, a blockquote, bullets at three
 * depths, an ordered list, a rule, and inline link / bold / italic / code.
 *
 * markdown.test.tsx runs the REAL generator's output through it and asserts
 * NOTHING is left unrendered - if the generator learns a new construct, that
 * cell reds instead of the page quietly printing `| --- | --- |` at a reader.
 * That is the negative-space half: a renderer tested only on the constructs it
 * already knows can never discover the one it does not.
 */

import type { ReactNode } from "react";

/** Only these schemes become an <a>. Anything else renders as its own text -
 *  the digest is generated from third-party titles and URLs, and a
 *  `javascript:` href would be a live one. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url, "http://localhost");
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Inline spans, in one pass so a link's own label cannot be re-tokenised into
 * a broken bold. Order matters: code first (it suppresses everything inside),
 * then links, then bold before italic - `**x**` also matches the italic rule.
 */
const INLINE_SOURCE =
  "(`[^`]+`)|(\\[[^\\]]*\\]\\([^)\\s]+\\))|(\\*\\*[^*]+\\*\\*)|(_[^_\\n]+_)";

export function inline(text: string, keyPrefix = ""): ReactNode[] {
  // A FRESH regex per call, deliberately. `inline` recurses into a link's
  // label and a bold span's contents, and a shared /g regex is stateful: the
  // inner call resets lastIndex under the outer loop, which never terminates.
  // It does not throw - the worker just dies, which reads as an out-of-memory
  // machine rather than as a bug in this file.
  const re = new RegExp(INLINE_SOURCE, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}i${n++}`;
    const [tok] = m;
    if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      const label = tok.slice(1, cut);
      const href = safeHref(tok.slice(cut + 2, -1));
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener"
             className="text-link hover:underline">
            {inline(label, key)}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={key} className="font-semibold text-foreground">{inline(tok.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key} className="text-dim not-italic">{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Bullet { depth: number; text: string }

/** Empty after the emphasis, code and bold markers come off: `__`, `**`, `` `` ``. */
export function isBlankBullet(text: string): boolean {
  return text.replace(/[*_`~\s]/g, "") === "";
}

/** Indent -> depth. The generator writes 0, 2 and 4 spaces; anything deeper is
 *  clamped rather than dropped, because dropping is the failure this replaces. */
function depthOf(indent: string): number {
  return Math.min(2, Math.floor(indent.length / 2));
}

const DEPTH_CLASS = ["", "ml-5", "ml-10"] as const;

function List({ items, k }: { items: Bullet[]; k: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((b, i) => (
        <li key={`${k}-${i}`} className={`flex gap-2 ${DEPTH_CLASS[b.depth]}`}>
          <span aria-hidden className="select-none pt-[0.15rem] text-xs text-dim">
            {b.depth === 0 ? "▪" : "·"}
          </span>
          <span className="min-w-0 flex-1">{inline(b.text, `${k}-${i}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Block parse. Returns nodes; every input line lands in exactly one of them,
 * which is what lets the test assert full coverage.
 */
export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let bullets: Bullet[] = [];
  let para: string[] = [];
  let k = 0;

  const flushBullets = () => {
    if (!bullets.length) return;
    out.push(<List key={`ul${k++}`} items={bullets} k={`ul${k}`} />);
    bullets = [];
  };
  const flushPara = () => {
    if (!para.length) return;
    out.push(
      <p key={`p${k++}`} className="leading-relaxed text-foreground/90">
        {inline(para.join(" "), `p${k}`)}
      </p>,
    );
    para = [];
  };
  const flush = () => { flushBullets(); flushPara(); };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) { flush(); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const size = ["text-2xl", "text-xl", "text-base", "text-sm"][level - 1];
      const Tag = (["h2", "h3", "h4", "h5"] as const)[level - 1];
      out.push(
        <Tag key={`h${k++}`}
             className={`${size} font-semibold tracking-tight text-foreground ${level <= 2 ? "mt-8 border-t pt-6 first:mt-0 first:border-0 first:pt-0" : "mt-5"}`}>
          {inline(h[2], `h${k}`)}
        </Tag>,
      );
      continue;
    }

    if (/^(---|___|\*\*\*)\s*$/.test(line)) {
      flush();
      out.push(<hr key={`hr${k++}`} className="my-6" />);
      continue;
    }

    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flush();
      out.push(
        <blockquote key={`bq${k++}`} className="border-l-2 pl-4 text-sm text-dim">
          {inline(q[1], `bq${k}`)}
        </blockquote>,
      );
      continue;
    }

    const b = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (b) {
      flushPara();
      // A bullet with no content is dropped, not drawn. The generator used to
      // append `_${reason}_` unconditionally, so every item without a match
      // reason carries a literal `- __` - four digests on disk still do, and
      // rewriting the operator's own archive to fix a display bug is the wrong
      // half to change. Rendered, `__` reads as a stray dash between every
      // entry. The generator no longer writes them; this covers the ones
      // already written.
      if (isBlankBullet(b[2])) continue;
      bullets.push({ depth: depthOf(b[1]), text: b[2] });
      continue;
    }

    const ol = /^(\s*)\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      bullets.push({ depth: depthOf(ol[1]), text: ol[2] });
      continue;
    }

    flushBullets();
    para.push(line.trim());
  }
  flush();
  return out;
}

/**
 * The negative-space half.
 *
 * Every line this parser does not recognise falls into the paragraph bucket
 * and renders as its own literal markup - `| --- | --- |` printed at a reader.
 * A renderer tested only on the constructs it already handles can never find
 * the one it does not, so this names the constructs it CANNOT do and a test
 * asserts the real generator emits none of them.
 *
 * Add a construct here the moment the generator learns it; the alternative is
 * a page that silently prints pipes.
 */
const UNSUPPORTED: [RegExp, string][] = [
  [/^\s*\|.*\|\s*$/, "table row"],
  [/^\s*```/, "fenced code block"],
  [/!\[[^\]]*\]\([^)]*\)/, "image"],
  [/^\s*<[a-zA-Z/]/, "raw HTML block"],
  [/^\s*[-=]{3,}\s*$/, "setext heading rule"],
  [/^\s*[-*]\s+\[[ x]\]/, "task list item"],
];

export function unsupportedConstructs(src: string): string[] {
  const found = new Set<string>();
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    // A real horizontal rule is legal and handled; only flag `===` and the
    // dashed form when it is UNDER text, which is the setext case. Handled
    // by the block parser's own `---` rule first, so exclude it here.
    if (/^(---|___|\*\*\*)\s*$/.test(raw.trim())) continue;
    for (const [re, name] of UNSUPPORTED) if (re.test(raw)) found.add(name);
  }
  return [...found];
}
