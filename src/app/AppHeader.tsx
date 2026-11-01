// Persistent header shown above every screen. The logo variant follows the header width (not the
// screen): horizontal lockup on desktop, stacked below 1024px, abbreviated mark below 640px. Color
// versus white follows the current theme so a manual override stays consistent with the page.
// The text beside the logo never repeats "WFRC"; the logo already carries that identity.

import { CircleHelp } from "lucide-react";
import logoAbbreviatedColor from "../assets/logo/abbreviated/WFRC_logo_abbreviated_color_transparent.png";
import logoAbbreviatedWhite from "../assets/logo/abbreviated/WFRC_logo_abbreviated_white_transparent.png";
import logoHorizontalColor from "../assets/logo/horizontal/WFRC_logo_horizontal_color_transparent.png";
import logoHorizontalWhite from "../assets/logo/horizontal/WFRC_logo_horizontal_white_transparent.png";
import logoStackedColor from "../assets/logo/stacked/WFRC_logo_stacked_color_transparent.png";
import logoStackedWhite from "../assets/logo/stacked/WFRC_logo_stacked_white_transparent.png";
import { useMediaQuery } from "../theme/useMediaQuery";
import { useTheme } from "../theme/useTheme";
import { ThemeToggle } from "./ThemeToggle";
import { versionLabel } from "./version";

export interface AppHeaderProps {
  /** Shows the help button when provided (the help guide arrives in a later task). */
  onOpenHelp?: () => void;
  /** Extra header content, such as the network-request counter. */
  children?: React.ReactNode;
}

export function AppHeader({ onOpenHelp, children }: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isMobile = useMediaQuery("(max-width: 640px)");
  const isTablet = useMediaQuery("(max-width: 1024px)");
  const dark = theme === "dark";

  const logoSrc = isMobile
    ? dark
      ? logoAbbreviatedWhite
      : logoAbbreviatedColor
    : isTablet
      ? dark
        ? logoStackedWhite
        : logoStackedColor
      : dark
        ? logoHorizontalWhite
        : logoHorizontalColor;

  return (
    <header className="app-header no-print">
      <div className="app-header-brand">
        <img src={logoSrc} alt="WFRC" className="app-header-logo" />
        <h1 className="app-header-title">Synthetic Data Generator</h1>
        <span className="app-header-version" data-testid="app-version">
          {versionLabel()}
        </span>
      </div>
      <div className="app-header-actions">
        {children}
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        {onOpenHelp && (
          <button
            type="button"
            className="button-link icon-button"
            onClick={onOpenHelp}
            aria-label="Help & guide"
            title="Help & guide"
          >
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}
