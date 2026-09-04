import { Link, useLocation } from "react-router-dom";
import { Check, ChevronsUpDown, Circle } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DESTINATIONS, SECTION_LABEL, type Section } from "./nav";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/utils";
import { useProject } from "./useProject";

interface HubPayload {
  projects: { id: string; name: string }[];
}

/**
 * The rail. A project switcher at the top, then the three groups.
 *
 * The project section is only meaningful once a project is picked, so when none
 * is it renders DISABLED rather than hidden. A section that disappears teaches
 * the reader that the app is inconsistent; one that is visibly unavailable
 * teaches them what to do next.
 */
export function AppSidebar() {
  const project = useProject();
  const { pathname } = useLocation();
  const hub = useApi<HubPayload>("/projects-hub");

  const projects = hub.state === "ready" ? hub.data.projects : [];
  const current = projects.find((x) => x.id === project);

  const groups: Section[] = ["discover", "project", "fleet"];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                    AI
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-semibold">
                      {current ? current.id : "Intelligence Hub"}
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/70">
                      {current ? current.name : "no project selected"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {/* An absence is a row. An empty switcher with no explanation
                    reads as "you have no projects", which is a different and
                    much worse claim than "the list has not arrived". */}
                {hub.state === "loading" && (
                  <DropdownMenuItem disabled>Loading projects…</DropdownMenuItem>
                )}
                {hub.state === "error" && (
                  <DropdownMenuItem disabled>
                    Could not load projects - {hub.error.message}
                  </DropdownMenuItem>
                )}
                {hub.state === "ready" && projects.length === 0 && (
                  <DropdownMenuItem disabled>
                    No projects configured - copy config/projects.example.json
                  </DropdownMenuItem>
                )}
                {projects.map((x) => (
                  <DropdownMenuItem key={x.id} asChild>
                    <Link to={`/p/${encodeURIComponent(x.id)}`} className="gap-2">
                      <Check className={cn("size-4", x.id === project ? "opacity-100" : "opacity-0")} />
                      <span className="font-mono text-xs">{x.id}</span>
                      <span className="ml-auto truncate text-xs text-muted-foreground">{x.name}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((section) => (
          <SidebarGroup key={section}>
            <SidebarGroupLabel>{SECTION_LABEL[section]}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {DESTINATIONS.filter((d) => d.section === section).map((d) => {
                  const needsProject = d.section === "project";
                  const href = d.href(project);
                  const active = pathname === href;
                  return (
                    <SidebarMenuItem key={d.id}>
                      {/*
                        asChild in BOTH arms. Rendering the disabled arm without
                        it made the button wrap a plain span, which does not
                        inherit the row's flex layout - the marker dropped onto
                        its own line and every label in the section wrapped.
                        Same element shape, one class difference.
                      */}
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={needsProject && !project ? "Pick a project first" : d.blurb}
                        aria-disabled={needsProject && !project || undefined}
                        className={cn(needsProject && !project && "pointer-events-none opacity-40")}
                      >
                        {needsProject && !project ? (
                          <span>
                            <Circle className="size-2" />
                            <span>{d.label}</span>
                          </span>
                        ) : (
                          <Link to={href}>
                            {/* The active item carries a FILLED marker and a
                                semibold label. Colour is the third channel
                                here, never the only one. */}
                            <Circle className={cn("size-2", active && "fill-current")} />
                            <span className={cn(active && "font-semibold")}>{d.label}</span>
                          </Link>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <HealthPill />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The server's own health, which today is invisible unless someone curls it.
 * Degraded says WHICH part is degraded, because "degraded" alone sends the
 * reader to the logs anyway.
 */
function HealthPill() {
  const health = useApi<{
    status?: string;
    sources_failed_last_run?: number;
    sources_total?: number;
  }>("/health");

  // "degraded" on its own sends the reader to the logs, which is where they
  // were going anyway. The count is the whole reason to render this at all.
  let label: string;
  if (health.state === "loading") label = "checking…";
  else if (health.state === "error") label = "unreachable";
  else if (health.data.status === "ok") label = "healthy";
  else {
    const bad = health.data.sources_failed_last_run;
    const all = health.data.sources_total;
    label =
      typeof bad === "number" && typeof all === "number"
        ? `${bad} of ${all} sources failing`
        : (health.data.status ?? "unknown");
  }
  const ok = health.state === "ready" && health.data.status === "ok";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-sidebar-foreground/70">
      <span aria-hidden className={cn("font-mono", ok ? "text-success" : "text-warning")}>
        {ok ? "●" : "▲"}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}
