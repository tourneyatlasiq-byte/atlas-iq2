"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { SUPPORT_EMAIL } from "../lib/legal";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HELP_GROUPS, tasksForPath, searchTasks } from "../lib/help";

/**
 * In-app help.
 *
 * Task-based rather than a list of instructions: each entry names something a
 * coach wants to do and takes them there. Where the interface can open the
 * actual form we link straight to it; where a record has to be chosen first,
 * the sentence says so instead of implying otherwise.
 */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const pathname = usePathname();

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
    // Straight into search — typing is faster than scanning for most people.
    searchRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  const results = useMemo(() => searchTasks(query), [query]);
  const contextual = useMemo(() => tasksForPath(pathname ?? ""), [pathname]);

  const groups = results ?? HELP_GROUPS;
  const searching = results !== null;
  const nothingFound = searching && groups.length === 0;

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

          <div className="help-search">
            <input
              ref={searchRef}
              type="search"
              placeholder="Search help…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search help"
            />
          </div>

          <div className="help-body">
            {/* Hidden while searching — you're looking for something specific,
                not for what happens to be nearby. */}
            {!searching && contextual.length > 0 && (
              <section className="help-group">
                <p className="help-group-label">On this page</p>
                {contextual.map((t) => (
                  <HelpTask key={t.id} task={t} onNavigate={close} featured />
                ))}
              </section>
            )}

            {nothingFound ? (
              <p className="help-none">
                Nothing matches “{query.trim()}”. Try a word like payment, roster, game or facility.
              </p>
            ) : (
              <>
                {!searching && <p className="help-section-title">Common tasks</p>}
                {groups.map((g) => (
                  <section key={g.id} className="help-group">
                    <p className="help-group-label">{g.label}</p>
                    {g.tasks.map((t) => (
                      <HelpTask key={t.id} task={t} onNavigate={close} />
                    ))}
                  </section>
                ))}
              </>
            )}

            <p className="help-contact">
              Still stuck?{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function HelpTask({ task, onNavigate, featured = false }) {
  const body = (
    <>
      <span className="help-task-title">{task.title}</span>
      <span className="help-task-text">{task.text}</span>
      {task.cta && <span className="help-task-cta">{task.cta} →</span>}
    </>
  );

  // No destination: the control lives somewhere this panel cannot open, so the
  // sentence has to do the work rather than a dead button.
  if (!task.href) {
    return <div className={`help-task help-task-static${featured ? " featured" : ""}`}>{body}</div>;
  }

  return (
    <Link
      href={task.href}
      className={`help-task${featured ? " featured" : ""}`}
      onClick={onNavigate}
    >
      {body}
    </Link>
  );
}
