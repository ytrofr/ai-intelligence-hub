import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { applyTheme, readTheme, writeTheme, type Theme } from "./theme";

/**
 * The theme control. It lives in the sidebar footer so it is reachable from
 * every route without a settings page existing.
 *
 * It names the theme it will SWITCH TO, not the one you are in. Both readings
 * are defensible on their own and a toggle that shows the current state is the
 * commoner pattern, but this one is a button: a button says what it does. The
 * icon and the word carry the same message, so neither is doing the job alone.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  // The boot snippet already applied the stored theme before React mounted.
  // This keeps the DOM honest after a change, and re-asserts it on mount for
  // the case where the snippet was stripped (an embed, a test harness).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = next === "dark" ? Moon : Sun;

  return (
    <SidebarMenuButton
      onClick={() => {
        writeTheme(next);
        setTheme(next);
      }}
      tooltip={`Switch to the ${next} theme`}
      aria-label={`Switch to the ${next} theme`}
    >
      <Icon className="size-4" />
      <span>{next === "dark" ? "Dark theme" : "Light theme"}</span>
    </SidebarMenuButton>
  );
}
