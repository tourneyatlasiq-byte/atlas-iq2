"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Wordmark } from "./SeasonMark";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/product", label: "Product" },
  { href: "/about", label: "About" },
];

const PHONE_QUERY = "(max-width: 760px)";

/**
 * Public site header.
 *
 * On a phone the navigation is a disclosure: a menu button (three lines when
 * closed, an X when open) that reveals the links directly below the header.
 * It is not a modal, so focus is not trapped. Escape closes it and returns
 * focus to the button; choosing a link closes it; widening the window past
 * the phone breakpoint closes it.
 */
export function SiteHeader({ signedIn = false, appHref = "/dashboard" }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef(null);
  const firstLinkRef = useRef(null);

  const close = useCallback((returnFocus) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (open) firstLinkRef.current?.focus();
  }, [open]);

  // Escape closes; leaving the phone layout closes.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = (e) => {
      if (!e.matches) close(false);
    };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onChange);
    };
  }, [open, close]);

  const primary = signedIn
    ? { href: appHref, label: "Open Season Tempo", short: "Open app" }
    : { href: "/login?new=1", label: "Get started", short: "Get started" };

  return (
    <header className="st-header" data-open={open ? "true" : "false"}>
      <div className="st-wrap st-header-in">
        <Link className="st-logo" href="/" aria-label="Season Tempo home">
          <Wordmark />
        </Link>

        <nav className="st-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="st-header-cta">
          {!signedIn && (
            <Link className="st-signin" href="/login">
              Sign in
            </Link>
          )}
          <Link className="st-btn st-btn-light st-btn-sm" href={primary.href}>
            {primary.label}
          </Link>
        </div>

        <Link className="st-btn st-btn-light st-btn-sm st-ph-cta" href={primary.href}>
          {primary.short}
        </Link>

        <button
          ref={buttonRef}
          type="button"
          className="st-menu-btn"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      <div id={panelId} className="st-menu-panel" hidden={!open}>
        <nav aria-label="Main menu">
          {NAV.map((n, i) => (
            <Link key={n.href} href={n.href} ref={i === 0 ? firstLinkRef : undefined} onClick={() => close(false)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="st-actions-row">
          <Link className="st-btn st-btn-light st-btn-lg st-menu-primary" href={primary.href} onClick={() => close(false)}>
            {primary.label}
          </Link>
          {!signedIn && (
            <Link className="st-btn st-btn-ghost st-btn-lg" href="/login" onClick={() => close(false)}>
              Sign in
            </Link>
          )}
        </div>
        <p className="st-note">Free during early access. We&rsquo;ll give you advance notice before that changes.</p>
      </div>
    </header>
  );
}
