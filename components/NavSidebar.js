"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LogoLockup } from "./Logo";

/**
 * Approved top-level navigation. These labels are the product vocabulary —
 * "Tournament Board", "Roster", "Payments" and "Game Log" are retired.
 * Games are not top level; they belong to tournaments and surface inside
 * Tournament IQ later.
 */
const NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/tournaments", label: "Tournament IQ" },
  { href: "/team", label: "Team" },
  { href: "/facilities", label: "Facilities" },
  { href: "/finance", label: "Finance" },
  { href: "/files", label: "Files" },
];

export function NavSidebar({ email }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <LogoLockup size={34} tone="light" />
      </div>

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
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user">
          {email}
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
