"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { SUPPORT_EMAIL } from "../lib/legal";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { searchHelp, helpHref } from "../lib/help";
import { questionsForPath } from "../lib/help-answers";
import { useHelpContext } from "./HelpContext";

/**
 * The Help popover (2026-11): aware of the screen it's opened from.
 *
 * Questions about this screen first, each opening its direct answer in Help
 * & Getting Started; Search Help underneath for anything else, answered by
 * the same engine as /help. Every link carries this exact screen (`from`) so
 * "Back to …" returns here.
 */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams?.toString() ?? "";
  const here = `${pathname ?? ""}${qs ? `?${qs}` : ""}`;

  useEffect(() => {
    if (!open) return;
    function away(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) close();
    }
    function key(e) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  // QAB questions only where QAB is on; otherwise this screen's non-QAB ones.
  const { qab } = useHelpContext();
  const questions = useMemo(() => questionsForPath(pathname ?? "", { qab }), [pathname, qab]);
  const results = useMemo(() => searchHelp(query, 5), [query]);
  const searching = results !== null;

  return (
    <div className="help-menu" ref={panelRef}>
      <button
        className="help-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Help
      </button>

      {open && (
        <div className="help-panel" role="dialog" aria-label="Help">
          <div className="help-head">
            <h2>How can we help?</h2>
            <button className="help-close" onClick={close} aria-label="Close help">✕</button>
          </div>

          <div className="help-body">
            {!searching && questions.length > 0 && (
              <section className="help-group" aria-label="Questions about this page">
                <p className="help-group-label">On this page</p>
                <ul className="help-questions">
                  {questions.map((a) => (
                    <li key={a.id}>
                      <Link href={helpHref(`/help?a=${a.id}`, here)} className="help-question" onClick={close}>
                        <span>{a.title}</span>
                        <span className="help-question-go" aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="help-search help-search-inline">
              <input
                ref={searchRef}
                type="search"
                placeholder="Search Help"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && query.trim()) {
                    e.preventDefault();
                    close();
                    router.push(helpHref(`/help?q=${encodeURIComponent(query.trim())}`, here));
                  }
                }}
                aria-label="Search Help"
              />
            </div>

            {searching && (
              results.length === 0 ? (
                <p className="help-none">
                  Nothing matches “{query.trim()}” yet. Try describing what you&rsquo;re trying to do.
                </p>
              ) : (
                <ul className="help-questions help-results">
                  {results.map((r) => (
                    <li key={r.href}>
                      <Link href={helpHref(r.href, here)} className="help-question" onClick={close}>
                        <span>
                          {r.title}
                          {r.kind !== "answer" && <span className="help-question-meta">{r.kind === "step" ? r.guideTitle : "Guide"}</span>}
                        </span>
                        <span className="help-question-go" aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            )}

            <Link href={helpHref("/help", here)} className="help-center-link" onClick={close}>
              <span className="help-center-title">Help &amp; Getting Started</span>
              <span className="help-center-text">All help, guides and your setup progress</span>
              <span className="help-center-go" aria-hidden="true">→</span>
            </Link>

            <p className="help-contact">
              Still stuck? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
