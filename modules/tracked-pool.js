/**
 * The tracked pool — which repos we check upstream every day, and why.
 *
 * Three sources, plus one repo that is always present:
 *   adopted  radar rows at status accepted or done — things we committed to
 *   watch    radar rows with verdict WATCH — things we said we would revisit
 *   dep      resolved package names from all project repos
 *   control  a permanently-archived repo, see below
 *
 * The pool is RETIRED as decisions are made: a row rejected on the radar leaves
 * it. An unbounded 'things we care about' list degrades into noise nobody reads,
 * and a proposed ADOPT is not a commitment either — only accepting one is.
 *
 * The positive control is load-bearing. A tracker that reports zero alarms is
 * indistinguishable from a tracker that is broken, unless the set it just checked
 * contains something it MUST alarm on. This repo was archived by Google and will
 * stay archived, so a run that does not report it did not really run.
 */

const POSITIVE_CONTROL = "google-gemini/deprecated-generative-ai-js";

const RANK = { control: 3, adopted: 2, watch: 1, dep: 0 };
const TRACKED_STATUSES = new Set(["accepted", "done"]);

function buildPool({ radarRows = [], depRepos = [], control = POSITIVE_CONTROL } = {}) {
  const byRepo = new Map();

  const add = (repo, project, role) => {
    if (!repo || repo === "unresolved") return;
    const existing = byRepo.get(repo);
    if (!existing) {
      byRepo.set(repo, { repo, projects: project ? [project] : [], role });
      return;
    }
    if (project && !existing.projects.includes(project)) existing.projects.push(project);
    if (RANK[role] > RANK[existing.role]) existing.role = role;
  };

  for (const row of radarRows) {
    if (row.status === "rejected") continue;
    if (TRACKED_STATUSES.has(row.status)) add(row.repo, row.project, "adopted");
    else if (row.verdict === "WATCH") add(row.repo, row.project, "watch");
  }

  for (const d of depRepos) add(d.repo, d.project, "dep");

  // Added last and unconditionally, so no input can remove it.
  add(control, null, "control");
  byRepo.get(control).role = "control";

  return [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

module.exports = { buildPool, POSITIVE_CONTROL };
