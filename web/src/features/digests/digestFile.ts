/**
 * The list endpoint and the fetch endpoint speak different vocabularies.
 *
 *   GET /api/digest        -> ["weekly-2026-09-03.md", ...]   FILENAMES
 *   GET /api/digest/:date  -> the markdown                    A DATE
 *
 * Passing a filename where a date is expected is what produced "Invalid date
 * format; expected YYYY-MM-DD" on a page that had never worked. The server is
 * not wrong - both shapes are documented and tested - but nothing sat between
 * them, so the translation lived nowhere and was therefore never done.
 *
 * Three states, never two. A filename that does not parse returns null and the
 * caller renders a row saying so; it must not be forwarded to the API to be
 * refused there, because a 400 from the server reads to the operator as a
 * broken backend rather than a file we could not name.
 */
const WEEKLY = /^weekly-(\d{4}-\d{2}-\d{2})\.md$/;

export function digestDate(file: string): string | null {
  return WEEKLY.exec(file)?.[1] ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "week of 3 Sep 2026". Built from the string, never from `new Date(...)`:
 * parsing a bare YYYY-MM-DD shifts it by the viewer's timezone, so a digest
 * written on the 3rd can render as the 2nd for anyone west of UTC. The digest
 * is named by its file, and the label must agree with the file.
 */
export function digestLabel(file: string): string {
  const date = digestDate(file);
  if (!date) return file;
  const [y, m, d] = date.split("-");
  return `week of ${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
