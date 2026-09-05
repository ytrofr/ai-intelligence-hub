import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { useProject } from "./useProject";

/**
 * Every page's frame. There is exactly one of these.
 *
 * The pages this replaces used six different container widths and two different
 * header patterns, which is most of the reason the app read as several products
 * stapled together. Width is now a prop with three values and nothing else is
 * offered:
 *
 *   prose  a column of text stays readable - reading measure, not screen width
 *   page   the default: cards, forms, anything laid out in columns
 *   wide   a table that genuinely needs the room
 */
export type Width = "prose" | "page" | "wide";

const WIDTH: Record<Width, string> = {
  prose: "max-w-3xl",
  page: "max-w-6xl",
  wide: "max-w-[1600px]",
};

export function PageShell({
  title,
  blurb,
  width = "page",
  actions,
  children,
}: {
  title: string;
  blurb?: string;
  width?: Width;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const project = useProject();

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
        <SidebarTrigger className="-ml-1 shrink-0" />
        <Separator orientation="vertical" className="mr-2 h-4 shrink-0" />
        {/* The breadcrumb is the part that YIELDS. It takes the leftover room
            and truncates inside it, so a wide control in `actions` shortens the
            trail rather than being pushed off the right edge - which is what
            used to happen, silently, because a non-wrapping row with ml-auto
            has no way to tell you it ran out of space. Measured at 320: the
            Stack search box sat 44px past the edge and could not be reached. */}
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap">
            <BreadcrumbItem className="shrink-0">
              <BreadcrumbLink asChild>
                <Link to="/" className="tap">Hub</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {project && (
              <>
                <BreadcrumbSeparator className="shrink-0" />
                <BreadcrumbItem className="min-w-0 shrink">
                  <BreadcrumbLink asChild>
                    <Link
                      to={`/p/${encodeURIComponent(project)}`}
                      className="tap block truncate font-mono"
                    >
                      {project}
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            <BreadcrumbSeparator className="shrink-0" />
            <BreadcrumbItem className="min-w-0 shrink">
              <BreadcrumbPage className="tap truncate">{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        {/* min-w-0 on the slot AND on its children: a fixed-width control is a
            flex item with an intrinsic minimum, and without this it refuses to
            shrink and escapes the row instead. Pages still declare a sensible
            small-screen width of their own - this is the backstop that makes a
            page which forgets one survivable rather than broken. */}
        {actions && (
          <div className="ml-auto flex min-w-0 shrink items-center gap-2 [&>*]:min-w-0">
            {actions}
          </div>
        )}
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-8 sm:px-6">
        <div className={cn("mx-auto w-full", WIDTH[width])}>
          <div className="mb-8">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {blurb && <p className="mt-1.5 text-sm text-muted-foreground">{blurb}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
