// Light/dark theme preference. A display setting only: it is not data and not a tracking
// identifier, and it is the one thing this app ever writes to browser storage (research.md R16).
//
// Default: follow the OS prefers-color-scheme, live. The first manual toggle sets an explicit
// override that persists until toggled again.

import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "synthetic-data-generator:theme-preference:v1";

function readStoredPreference(): ThemePreference | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

export function useTheme(): { theme: ThemePreference; toggleTheme: () => void } {
  const [override, setOverride] = useState<ThemePreference | null>(() => readStoredPreference());
  const systemPrefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  const theme: ThemePreference = override ?? (systemPrefersDark ? "dark" : "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    const next: ThemePreference = theme === "dark" ? "light" : "dark";
    setOverride(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Best effort: a failed write only means the preference resets next session.
    }
  }

  return { theme, toggleTheme };
}
