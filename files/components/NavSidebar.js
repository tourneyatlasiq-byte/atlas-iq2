"use client";

import { lockScroll as lockPageScroll } from "../lib/scrollLock";
import { useState, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LogoLockup } from "./SeasonTempoLogo";
import { helpHref } from "../lib/help";
import { SignOutButton } from "./SignOutButton";
import { SUPPORT_EMAIL } from "../lib/legal";
import { TeamIdentity, initialsOf } from "./TeamMark";
import {
  IconHome, IconTournaments, IconTeam, IconFacilities, IconFinance, IconPerformance,
  IconFiles, IconContacts, IconReports, IconMore, IconSettings, IconHelp,
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
  // Route stays /facilities: it is referenced across the app and in saved
  // links, and the URL need not match the label any more than the table name
  // does.
  { href: "/facilities", label: "Locations & Resources", Icon: IconFacilities },
  { href: "/finance", label: "Finance", Icon: IconFinance },
  { href: "/performance", label: "Performance", Icon: IconPerformance, feature: "qab", primary: true },
  /* Reports spans Finance, Tournaments and Performance, so it belongs to no
     one of them — top level, but NOT primary. The mobile bar is a designed
     five positions (four primary plus More); promoting Reports would make six.
     It is also not feature-gated: the budget and schedule reports are
     available to every organization, and the hub gates the QAB group itself. */
  { href: "/reports", label: "Reports", Icon: IconReports },
  { href: "/files", label: "Files", Icon: IconFiles },
  { href: "/contacts", label: "Contacts", Icon: IconContacts },
];

export function NavSidebar({ email, organization, team, season, seasons, seasonPhase, features = {} }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href) => pathname === href || pathname.startsWith(href + "/");

  // Derived from the one NAV array. There is deliberately no second mobile
  // route list: adding `primary` to an entry is what promotes it to the bar.
  const primary = NAV.filter((i) => i.primary);
  const overflow = NAV.filter((i) => !i.primary);

  // More reads as active whenever the current route lives inside it, so a coach
  // on Finance is never looking at a bar with nothing lit.
  const moreActive = overflow.some((i) => isActive(i.href)) || isActive("/settings") || isActive("/help");

  // Same convention as the existing drawers: Escape closes, body scroll locks.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    const unlock = lockPageScroll();
    document.addEventListener("keydown", onKey);
    return () => {
      unlock();
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Navigating always dismisses it.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Phone header: show the full wordmark when there is room, and fall back to
  // the mark alone when the team line would otherwise be cut off. The class is
  // toggled on the element directly because it is a pure layout measurement.
  const asideRef = useRef(null);
  useEffect(() => {
    const el = asideRef.current;
    if (!el || typeof window === "undefined") return undefined;
    const phone = window.matchMedia("(max-width: 720px)");
    const cut = (n) => !!n && n.scrollWidth > n.clientWidth + 1;
    const fit = () => {
      el.classList.remove("brand-compact");
      if (!phone.matches) return;
      const tight = cut(el.querySelector(".team-identity-sub"));
      if (tight) el.classList.add("brand-compact");
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    window.addEventListener("resize", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [team?.name, organization?.name, season?.id, seasonPhase, seasons?.length]);

  return (
    <aside className="sidebar" ref={asideRef}>
      <div className="sidebar-brand">
        <LogoLockup size={30} tone="ink" wordSize={17} />
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

            {/* A visible, labeled way out (2026-11-18). Tapping outside the
                sheet and Escape still close it too. Sticky, so it stays
                reachable when the list scrolls or the keyboard is up. */}
            <div className="sheet-head">
              <h2 className="sheet-title">More</h2>
              <button type="button" className="sheet-close" onClick={() => setMoreOpen(false)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                Close
              </button>
            </div>

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

              {/* Help & Getting Started (2026-11). A plain link: the row used
                  to hold the Help popover, which drew a second "Help" button
                  beside this label and opened a panel from inside the sheet.
                  The page-header Help button still opens the popover. */}
              <Link
                href={helpHref("/help", `${pathname}${qs ? `?${qs}` : ""}`)}
                className={`sheet-row${isActive("/help") ? " active" : ""}`}
                aria-current={isActive("/help") ? "page" : undefined}
              >
                <span className="sheet-row-icon">
                  <IconHelp />
                </span>
                <span className="sheet-row-label">Help &amp; Getting Started</span>
              </Link>

              {/* Phones hide the sidebar footer, so Sign out lives here too
                  (2026-11): a user must always be able to end their session. */}
              <SignOutButton className="sheet-row sheet-row-signout">
                <span className="sheet-row-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h11" />
                  </svg>
                </span>
                <span className="sheet-row-label">Sign out</span>
              </SignOutButton>
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
          <Link href="/settings" style={{ color: "var(--muted)", textDecoration: "underline" }}>
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
