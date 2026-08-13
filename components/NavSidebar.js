"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoLockup } from "./SeasonTempoLogo";
import { TeamIdentity, initialsOf } from "./TeamMark";
import {
  IconHome, IconTournaments, IconTeam, IconFacilities, IconFinance, IconFiles, IconContacts,
} from "./NavIcons";

/**
 * Approved top-level navigation. These labels are the product vocabulary —
 * "Tournament Board", "Roster", "Payments" and "Game Log" are retired.
 * Games are not top level; they belong to tournaments and surface inside
 * Tournament IQ later.
 */
const NAV = [
  { href: "/dashboard", label: "Home", Icon: IconHome },
  { href: "/tournaments", label: "Tournaments", Icon: IconTournaments },
  { href: "/team", label: "Team", Icon: IconTeam },
  { href: "/facilities", label: "Facilities", Icon: IconFacilities },
  { href: "/finance", label: "Finance", Icon: IconFinance },
  { href: "/files", label: "Files", Icon: IconFiles },
  { href: "/contacts", label: "Contacts", Icon: IconContacts },
];

export function NavSidebar({ email, organization, team, season, seasons, seasonPhase }) {
  const pathname = usePathname();

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

      <nav className="nav" aria-label="Main">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <item.Icon />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

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
