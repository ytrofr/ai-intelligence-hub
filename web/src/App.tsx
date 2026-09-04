import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app/AppSidebar";
import { PageShell } from "@/components/app/PageShell";
import { AbsenceRow } from "@/components/app/AbsenceRow";
import { DESTINATIONS, destinationById } from "@/components/app/nav";
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
          <AppSidebar />
          <SidebarInset>
            <Routes>
              {DESTINATIONS.map((d) => (
                <Route key={d.id} path={d.path} element={<Stub id={d.id} />} />
              ))}
              <Route path="/digests/:date" element={<Stub id="digests" />} />
              {/* The old app's addresses. Every one of them resolves. */}
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </BrowserRouter>
  );
}
