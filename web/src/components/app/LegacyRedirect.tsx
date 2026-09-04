import { Navigate, useLocation } from "react-router-dom";

/**
 * The old app's addresses.
 *
 * Every one of these is in somebody's history, in a report, in a plan file, or
 * on the Visual Hall. A rewrite that breaks them is a rewrite that makes the
 * previous year's notes wrong, so all nine resolve - and the ones that carried
 * ?project= carry it through to the new nested route rather than dropping the
 * reader on a fleet page and leaving them to find their project again.
 *
 * The hash form matters too: /projects.html#/apollo was the drill-down, and
 * BrowserRouter does not see a hash as a route, so it is read explicitly.
 */
const MAP: Record<string, (project: string) => string> = {
  "/index.html": () => "/",
  "/digest.html": () => "/digests",
  "/project-radar.html": () => "/discovery",
  "/inventory.html": () => "/inventory",
  "/projects.html": (p) => (p ? `/p/${encodeURIComponent(p)}` : "/projects"),
  "/adoption-matrix.html": (p) => (p ? `/p/${encodeURIComponent(p)}/matrix` : "/projects"),
  "/stack.html": (p) => (p ? `/p/${encodeURIComponent(p)}/stack` : "/projects"),
  "/radar.html": (p) => (p ? `/p/${encodeURIComponent(p)}/radar` : "/projects"),
  "/ground-truth.html": (p) => (p ? `/p/${encodeURIComponent(p)}/ground-truth` : "/projects"),
  // The SIGMA Radar shim was itself a redirect to a project radar, and the
  // project it forced no longer exists as a literal anywhere.
  "/sigma-radar.html": () => "/projects",
};

export const LEGACY_PATHS = Object.keys(MAP);

export function LegacyRedirect() {
  const loc = useLocation();
  const to = MAP[loc.pathname];
  if (!to) return <Navigate to="/" replace />;

  // ?project= wins; then #/<id>, which is how the hub's own drill-down worked.
  const query = new URLSearchParams(loc.search).get("project") ?? "";
  const hash = loc.hash.startsWith("#/") ? decodeURIComponent(loc.hash.slice(2).split("/")[0]) : "";
  return <Navigate to={to(query || hash)} replace />;
}
