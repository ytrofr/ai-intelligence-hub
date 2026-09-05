/**
 * Every destination in the app, in one place.
 *
 * The sidebar, the breadcrumbs and the router all read this list, so a route
 * that exists cannot be missing from the nav and a nav entry cannot point at a
 * route that does not exist. The pages this replaces had the opposite shape -
 * each page hand-wrote its own header - and that is why there were two header
 * patterns and a link to a page that had been deleted.
 */

export type Section = "discover" | "project" | "fleet" | "system";

export interface Destination {
  id: string;
  label: string;
  section: Section;
  /** Route pattern for react-router. */
  path: string;
  /** Build a concrete href. `project` is required by the project section. */
  href: (project?: string) => string;
  /** One line, shown as the page's subtitle and the sidebar tooltip. */
  blurb: string;
}

const p = (project?: string) => encodeURIComponent(project ?? "");

export const DESTINATIONS: Destination[] = [
  {
    id: "items", label: "Items", section: "discover",
    path: "/", href: () => "/",
    blurb: "Everything the fetchers found, newest first",
  },
  {
    id: "digests", label: "Digests", section: "discover",
    path: "/digests", href: () => "/digests",
    blurb: "The written-up version, one per week",
  },
  {
    id: "discovery", label: "Discovery", section: "discover",
    path: "/discovery", href: () => "/discovery",
    blurb: "What to look at next, and why",
  },

  {
    id: "needs", label: "Needs", section: "project",
    path: "/p/:project", href: (x) => `/p/${p(x)}`,
    blurb: "What this project needs and what we have for it",
  },
  {
    id: "matrix", label: "Adoption Matrix", section: "project",
    path: "/p/:project/matrix", href: (x) => `/p/${p(x)}/matrix`,
    blurb: "Candidates ranked, with the gates each one still owes",
  },
  {
    id: "scorecard", label: "Scorecard", section: "project",
    path: "/p/:project/scorecard", href: (x) => `/p/${p(x)}/scorecard`,
    blurb: "What this project measured on its own data, what it only guessed, and what each no taught",
  },
  {
    id: "stack", label: "Stack Ledger", section: "project",
    path: "/p/:project/stack", href: (x) => `/p/${p(x)}/stack`,
    blurb: "Every repo we use, how it turned out, what it taught us",
  },
  {
    id: "radar", label: "Adoption Radar", section: "project",
    path: "/p/:project/radar", href: (x) => `/p/${p(x)}/radar`,
    blurb: "The queue: what is proposed, tried, adopted or refused",
  },
  {
    id: "ground-truth", label: "Ground Truth", section: "project",
    path: "/p/:project/ground-truth", href: (x) => `/p/${p(x)}/ground-truth`,
    blurb: "Every instrument, and when it last actually said something",
  },

  {
    id: "projects", label: "All projects", section: "fleet",
    path: "/projects", href: () => "/projects",
    blurb: "Every project, five numbers each",
  },
  {
    id: "design", label: "Design system", section: "system",
    path: "/design", href: () => "/design",
    blurb: "Every token measured in the theme you are in, and every shared component",
  },

  {
    id: "inventory", label: "What we have", section: "fleet",
    path: "/inventory", href: () => "/inventory",
    blurb: "Live dependency counts, read from the checkouts",
  },
];

export const SECTION_LABEL: Record<Section, string> = {
  discover: "Discover",
  project: "This project",
  fleet: "Across the fleet",
  system: "This app",
};

export function destinationById(id: string): Destination | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}
