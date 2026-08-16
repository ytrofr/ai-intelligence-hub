/**
 * One phrasing for "why is this repo relevant" - used at discovery time
 * (github-discovery.calculateRelevanceScore, with the project name) and at
 * serve time (recommend.enrich, for the queried project).
 */
function formatMatchReason(mp, { projectName = null } = {}) {
  if (!mp) return "";
  const parts = [];
  if (mp.specificDeps && mp.specificDeps.length) parts.push(`${mp.specificDeps.length} key deps (${mp.specificDeps.slice(0, 4).join(", ")})`);
  if (mp.specificTopics && mp.specificTopics.length) parts.push(`${mp.specificTopics.length} topics (${mp.specificTopics.slice(0, 3).join(", ")})`);
  if (!parts.length && mp.genericDeps && mp.genericDeps.length) parts.push(`${mp.genericDeps.length} common deps (${mp.genericDeps.slice(0, 3).join(", ")})`);
  const suffix = projectName ? ` with ${projectName}` : "";
  if (parts.length) return `Shares ${parts.join(" + ")}${suffix}`;
  if (mp.overlap >= 10) return "Direct dependency";
  if (mp.viaQuery) return `Found via "${mp.viaQuery}" search${projectName ? ` (${projectName})` : ""}`;
  return projectName ? `Matched to ${projectName}` : "";
}
module.exports = { formatMatchReason };
