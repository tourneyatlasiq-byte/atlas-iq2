"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { actionState, helpHref, findGuide } from "../lib/help";
import { findAnswer } from "../lib/help-answers";
import { useHelpContext } from "./HelpContext";

/**
 * Contextual Help (H3, 2026-11): help at the moment of confusion.
 *
 * One small "How this works" / "Need help?" control per screen or section.
 * It opens IN PLACE — an inline panel directly below, never a navigation and
 * never a floating popover — so a coach in the middle of tracking a game
 * stays where they are. Content is the existing Help content:
 *
 *   questions  [{ id, ask? }] — Help answers (lib/help-answers.js). `ask`
 *              rephrases the question for this screen; the answer is reused
 *              word for word, never rewritten here.
 *   pieces     a guide slug whose "how the pieces fit" block to show.
 *   learnMore  "slug#anchor", only where the full guide adds something.
 *   context    which presentation variant to use (answer.in[context]) when
 *              the answer is shown on the screen it talks about; falls back
 *              to the canonical answer.
 *   actions    whether answer buttons may show. Off on tracking screens so
 *              nothing pulls the coach away; a button for the screen you are
 *              already on is never shown.
 *
 * Permission- and QAB-aware through HelpContext (provided by the app
 * layout): QAB answers are dropped where QAB is off, and an action the
 * person can't complete says why instead.
 */
export function ContextHelp({ label = "How this works", questions = [], pieces = null, learnMore = null, actions = true, align = "start", title = null, initialOpen = false, context = null }) {
  const access = useHelpContext();
  const [open, setOpen] = useState(initialOpen);
  const [openQ, setOpenQ] = useState(0);
  const panelId = useId();
  const pathname = usePathname() ?? "";
  const qs = useSearchParams()?.toString() ?? "";
  const here = `${pathname}${qs ? `?${qs}` : ""}`;

  const items = questions
    .map((q) => ({ ...q, answer: findAnswer(q.id) }))
    .filter((q) => q.answer && (access.qab || q.answer.action?.requires !== "qab"));
  const block = pieces ? findGuide(pieces)?.pieces : null;
  if (items.length === 0 && !block) return null;

  const [lmSlug, lmAnchor] = String(learnMore ?? "").split("#");
  const lmGuide = lmSlug ? findGuide(lmSlug) : null;

  return (
    <div className={`ch ch-${align}${open ? " open" : ""}`}>
      <button
        type="button"
        className="ch-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="ch-icon" aria-hidden="true">?</span>
        <span>{label}</span>
      </button>

      {open && (
        <div className="ch-panel" id={panelId} role="region" aria-label={title ?? label}>
          {title && <p className="ch-title">{title}</p>}

          {block && (
            <dl className="ch-pieces">
              {block.items.map((p) => (
                <div key={p.term}>
                  <dt>{p.term}</dt>
                  <dd>{p.text}</dd>
                </div>
              ))}
            </dl>
          )}

          {items.length > 0 && (
            <ul className="ch-questions">
              {items.map((q, i) => {
                const a = q.answer;
                const isOpen = openQ === i;
                const actionPath = a.action ? a.action.href.split(/[?#]/)[0] : null;
                const state = actions && a.action && actionPath !== pathname ? actionState(a.action, access) : null;
                return (
                  <li key={q.id} className={isOpen ? "on" : undefined}>
                    <button
                      type="button"
                      className="ch-q"
                      aria-expanded={isOpen}
                      onClick={() => setOpenQ(isOpen ? -1 : i)}
                    >
                      <span>{q.ask ?? a.title}</span>
                      <span className="ch-q-mark" aria-hidden="true">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && (
                      <div className="ch-a">
                        <p>{(context && a.in?.[context]) || a.answer}</p>
                        {state?.ok && (
                          <Link href={a.action.href} className="ch-action">
                            {a.action.label} →
                          </Link>
                        )}
                        {state && !state.ok && state.reason && <p className="ch-reason">{state.reason}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="ch-foot">
            {lmGuide && (
              <Link href={helpHref(`/help/${lmSlug}${lmAnchor ? `#${lmAnchor}` : ""}`, here)} className="ch-more">
                Learn more in {lmGuide.title} →
              </Link>
            )}
            <button type="button" className="ch-close" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
