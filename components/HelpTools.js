"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HELP_GUIDES, helpHref, isHelpLink, searchHelp } from "../lib/help";

/**
 * Help & Getting Started tools (2026-11): a compact guide selector and Help
 * search, in place of a permanent list of all nine guides.
 *
 * Both carry `from` — the screen the person came from — into every link, so
 * "Back to …" keeps working however they move around Help.
 */

/** Closes a disclosure on outside click and Escape, like the Help popover. */
function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    function away(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function key(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open, setOpen, ref]);
}

const linkFor = (href, from) => (isHelpLink(href) ? helpHref(href, from) : href);

export function HelpGuidePicker({ current, from, initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef(null);
  useDismiss(open, setOpen, ref);
  const guide = HELP_GUIDES.find((g) => g.slug === current);

  return (
    <div className="hc-picker" ref={ref}>
      <button
        type="button"
        className="hc-picker-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="hc-picker-label">Guide</span>
        <span className="hc-picker-current">{guide?.title ?? "Choose a guide"}</span>
        <span className="hc-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="hc-picker-panel">
          <Link href={`${helpHref("/help?view=guides", from)}#all-guides`} className="hc-picker-all" onClick={() => setOpen(false)}>
            All guides
          </Link>
          <ul>
            {HELP_GUIDES.map((g) => (
              <li key={g.slug}>
                <Link
                  href={helpHref(`/help/${g.slug}`, from)}
                  className={`hc-picker-item${g.slug === current ? " active" : ""}`}
                  aria-current={g.slug === current ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {g.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HelpSearch({ from, initialQuery = "", compact = false }) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(Boolean(initialQuery));
  const ref = useRef(null);
  const router = useRouter();
  useDismiss(open, setOpen, ref);

  const results = useMemo(() => searchHelp(query), [query]);
  const showPanel = open && results !== null;

  function go(r) {
    setOpen(false);
    router.push(linkFor(r.href, from));
  }

  return (
    <div className={`hc-search${compact ? " compact" : ""}`} ref={ref}>
      <input
        type="search"
        className="hc-search-input"
        placeholder="Search Help"
        aria-label="Search help"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results?.length) {
            e.preventDefault();
            go(results[0]);
          }
        }}
      />

      {showPanel && (
        <div className="hc-search-panel" role="region" aria-label="Help search results">
          {results.length === 0 ? (
            <p className="hc-search-none">
              Nothing matches &ldquo;{query.trim()}&rdquo;. Try a word like dues, roster, lineup or invite.
            </p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.href}>
                  <Link href={linkFor(r.href, from)} className="hc-result" onClick={() => setOpen(false)}>
                    <span className="hc-result-title">{r.title}</span>
                    <span className="hc-result-meta">
                      {r.kind === "answer" ? "Answer" : r.kind === "guide" ? "Guide" : `In ${r.guideTitle}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
