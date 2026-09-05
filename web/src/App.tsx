import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app/AppSidebar";
import { PageShell } from "@/components/app/PageShell";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { DESTINATIONS, destinationById } from "@/components/app/nav";
import { ProjectsPage } from "@/features/projects/ProjectsPage";
import { NeedsPage } from "@/features/needs/NeedsPage";
import { InventoryPage } from "@/features/inventory/InventoryPage";
import { StackPage } from "@/features/stack/StackPage";
import { MatrixPage } from "@/features/matrix/MatrixPage";
import { GroundTruthPage } from "@/features/ground-truth/GroundTruthPage";
import { RadarPage } from "@/features/radar/RadarPage";
import { ItemsPage } from "@/features/items/ItemsPage";
import { DigestsPage } from "@/features/digests/DigestsPage";
import { DiscoveryPage } from "@/features/discovery/DiscoveryPage";
import { LEGACY_PATHS, LegacyRedirect } from "@/components/app/LegacyRedirect";
import { useProject } from "@/components/app/useProject";

/**
 * R3 stub. Every destination renders the real shell - sidebar, breadcrumb,
 * heading, blurb - and says plainly that its content has not been built yet.
 *
 * It says so with an AbsenceRow rather than a blank panel, for the same reason
 * every other absence in this app is a row: an empty page is indistinguishable
 * from a working page with nothing to show, and one of those is a bug.
 */
function Stub({ id }: { id: string }) {
  const d = destinationById(id)!;
  const project = useProject();
  return (
    <PageShell title={d.label} blurb={d.blurb} width={d.id === "stack" ? "wide" : "page"}>
      <AbsenceRow
        what="Not built yet."
        reason={
          d.section === "project"
            ? `This is the shell for ${project ?? "a project"}. The content arrives in R5/R6.`
            : "This is the shell. The content arrives in R5/R6."
        }
      />
    </PageShell>
  );
}

/**
 * Destinations that have been built. Anything absent still renders the shell
 * with an explicit "not built yet" row, so a half-finished rebuild never
 * presents as a blank page.
 */
const BUILT: Record<string, () => JSX.Element> = {
  items: ItemsPage,
  digests: DigestsPage,
  discovery: DiscoveryPage,
  needs: NeedsPage,
  matrix: MatrixPage,
  stack: StackPage,
  radar: RadarPage,
  "ground-truth": GroundTruthPage,
  projects: ProjectsPage,
  inventory: InventoryPage,
};

/** Sends /p/:project/<nothing> style typos somewhere real rather than blank. */
function NotFound() {
  return (
    <PageShell title="No such page" blurb="That address does not match any destination." width="prose">
      <AbsenceRow
        what="Nothing here."
        reason="The link may be from the old .html version of this app - every one of those redirects, so this is a genuinely unknown address."
        tone="loud"
      />
    </PageShell>
  );
}

/**
 * From Vite's BASE_URL, which is the build's `base` option. A normal build gives
 * "/" -> "" and the app owns the origin. The preview build is made with
 * --base=/preview/, so the same code serves correctly under that prefix without
 * a second router or any path guessing.
 */
const BASENAME = import.meta.env.BASE_URL.replace(/\/$/, "");

export function App() {
  return (
    <BrowserRouter basename={BASENAME}>
      <TooltipProvider delayDuration={300}>
        <SidebarProvider>
          {/*
            First focusable element in the document, and visible ONLY while
            focused. Without it the keyboard route to any page's content runs
            through the project switcher and every one of the twelve sidebar
            destinations - on every navigation. It is the single highest-value
            keyboard affordance in an app shaped like this one.
          */}
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
          >
            Skip to content
          </a>
          <AppSidebar />
          <SidebarInset>
            <Routes>
              {DESTINATIONS.map((d) => {
                const Built = BUILT[d.id];
                return (
                  <Route key={d.id} path={d.path} element={Built ? <Built /> : <Stub id={d.id} />} />
                );
              })}
              <Route path="/digests/:date" element={<DigestsPage />} />
              {/* The old app's addresses. Every one of them resolves. */}
              {LEGACY_PATHS.map((p) => (
                <Route key={p} path={p} element={<LegacyRedirect />} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </BrowserRouter>
  );
}
