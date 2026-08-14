"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoLockup } from "./SeasonTempoLogo";
import { HelpMenu } from "./HelpMenu";
import { SUPPORT_EMAIL } from "../lib/legal";
import { TeamIdentity, initialsOf } from "./TeamMark";
import {
  IconHome, IconTournaments, IconTeam, IconFacilities, IconFinance, IconPerformance,
  IconFiles, IconContacts, IconMore, IconSettings, IconHelp,
} from "./NavIcons";

/**
 * Approved top-level navigation. These labels are the product vocabulary —
 * "Tournament Board", "Roster", "Payments" and "Game Log" are retired.
 * Games are not top level; they belong to tournaments and surface inside
 * Tournament IQ later.
 */
const NAV = [
  { href: "/dashboard", label: "Home", Icon: IconHome, primary: true },
  { href: "/tournaments", label: "Tournaments", Icon: IconTournaments, primary: true },
  { href: "/team", label: "Team", Icon: IconTeam, primary: true },
  { href: "/facilities", label: "Facilities", Icon: IconFacilities },
  { href: "/finance", label: "Finance", Icon: IconFinance },
  { href: "/performance", label: "Performance", Icon: IconPerformance, feature: "qab", primary: true },
  { href: "/files", label: "Files", Icon: IconFiles },
  { href: "/contacts", label: "Contacts", Icon: IconContacts },
];

export function NavSidebar({ email, organization, team, season, seasons, seasonPhase, features = {} }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href) => pathname === href || pathname.startsWith(href + "/");

  // Derived from the one NAV array. There is deliberately no second mobile
  // route list: adding `primary` to an entry is what promotes it to the bar.
  const primary = NAV.filter((i) => i.primary);
  const overflow = NAV.filter((i) => !i.primary);

  // More reads as active whenever the current route lives inside it, so a coach
  // on Finance is never looking at a bar with nothing lit.
  const moreActive = overflow.some((i) => isActive(i.href)) || isActive("/settings");

  // Same convention as the existing drawers: Escape closes, body scroll locks.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Navigating always dismisses it.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <LogoLockup size={30} tone="light" wordSize={17} />
      </div>

      {/* The organization is what a coach should feel they are operating.
          Season Tempo stays the platform brand above it. */}
      <TeamIdentity
        organization={organization}
        team={team}
        season={season}
        seasons={seasons}
        seasonPhase={seasonPhase}
        size={46}
      />

      {/* Desktop rail — unchanged. Renders every NAV entry in order. */}
      <nav className="nav" aria-label="Main">
        {NAV.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <item.Icon />
              <span>{item.label}</span>
              {item.feature && !features[item.feature] && (
                <span className="nav-premium" title="Premium feature">
                  Premium
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Mobile bar — five positions. Same NAV entries, same feature check. */}
      <nav className="navbar-mobile" aria-label="Main">
        {primary.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`navm-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="navm-icon">
                <item.Icon />
                {item.feature && !features[item.feature] && (
                  <span className="navm-dot" aria-hidden="true" />
                )}
              </span>
              <span className="navm-label">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className={`navm-item${moreActive ? " active" : ""}`}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen(true)}
        >
          <span className="navm-icon">
            <IconMore />
          </span>
          <span className="navm-label">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grip" aria-hidden="true" />

            <nav className="sheet-list" aria-label="More">
              {overflow.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sheet-row${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="sheet-row-icon">
                      <item.Icon />
                    </span>
                    <span className="sheet-row-label">{item.label}</span>
                    {item.feature && !features[item.feature] && (
                      <span className="nav-premium">Premium</span>
                    )}
                  </Link>
                );
              })}

              <Link
                href="/settings"
                className={`sheet-row${isActive("/settings") ? " active" : ""}`}
              >
                <span className="sheet-row-icon">
                  <IconSettings />
                </span>
                <span className="sheet-row-label">Settings</span>
              </Link>

              {/* The existing help system, not a mobile-only second one. */}
              <div className="sheet-row sheet-row-help">
                <span className="sheet-row-icon">
                  <IconHelp />
                </span>
                <span className="sheet-row-label">Help</span>
                <HelpMenu />
              </div>
            </nav>

            <div className="sheet-secondary">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
            </div>
          </div>
        </div>
      )}

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <span className="user-mark" aria-hidden="true">{initialsOf(email?.split("@")[0] ?? "?")}</span>
          <span className="user-email">{email}</span>
          <br />
          <Link href="/settings" style={{ color: "#b9c9dc", textDecoration: "underline" }}>
            Settings
          </Link>
        </div>
        <form action="/logout" method="post">
          <button type="submit" className="sidebar-signout">Sign out</button>
        </form>
      </div>
    </aside>
  );
}
