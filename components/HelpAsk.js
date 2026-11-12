"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { searchHelp, actionState, helpHref, isHelpLink, findGuide } from "../lib/help";
import { findAnswer } from "../lib/help-answers";

/**
 * "How can we help?" (2026-11): question first, answer first, guide second.
 *
 * A query is answered with one direct answer card (the best result), then a
 * few related results. /help?q=<query> and /help?a=<answer id> are linkable,
 * so the Help popover and guide pages can open an answer directly, and Back
 * still works. The query is kept in the address bar with replaceState, never
 * a navigation per keystroke.
 *
 * Results come from searchHelp(), deterministic today. A conversational or AI
 * layer can return the same result shape later without redesigning this.
 */

const EXAMPLES = ["wrong batter", "player doesn't owe dues", "add a hotel", "coach can't sign in"];

export function HelpAsk({ from = null, access = {}, popular = [], initialQuery = "", initialAnswer = null, children = null }) {
  const [query, setQuery] = useState(initialQuery);
  const [answerId, setAnswerId] = useState(initialQuery ? null : initialAnswer);
  const inputRef = useRef(null);

  const results = useMemo(() => searchHelp(query, 6), [query]);
  const chosen = answerId ? findAnswer(answerId) : null;

  // Keep the address bar in step (q or a), preserving from=, without a
  // navigation on every keystroke.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("a");
    if (query.trim()) url.searchParams.set("q", query.trim());
    else if (answerId) url.searchParams.set("a", answerId);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [query, answerId]);

  const showResults = results !== null;
  const idle = !showResults && !chosen;

  return (
    <div className="ha">
      <form className="ha-form" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="ha-input" className="visually-hidden">Search Help</label>
        <input
          id="ha-input"
          ref={inputRef}
          type="search"
          className="ha-input"
          placeholder="Search Help"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAnswerId(null);
          }}
        />
      </form>

      {idle && (
        <p className="ha-examples">
          <span>Try</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="ha-example" onClick={() => { setQuery(ex); inputRef.current?.focus(); }}>
              {ex}
            </button>
          ))}
        </p>
      )}

      {chosen && (
        <div className="ha-results">
          <AnswerCard result={{ kind: "answer", ...chosen, text: chosen.answer }} access={access} from={from} />
          <button type="button" className="ha-reset" onClick={() => { setAnswerId(null); inputRef.current?.focus(); }}>
            Ask something else
          </button>
        </div>
      )}

      {showResults && (
        <div className="ha-results" aria-live="polite">
          {results.length === 0 ? (
            <div className="ha-none">
              <p className="ha-none-title">No answer for &ldquo;{query.trim()}&rdquo; yet.</p>
              <p>Try describing what you&rsquo;re trying to do, like &ldquo;record a payment&rdquo; or &ldquo;add games&rdquo;. You can also browse all guides below.</p>
            </div>
          ) : (
            <>
              <AnswerCard result={results[0]} access={access} from={from} />
              {results.length > 1 && (
                <section className="ha-related" aria-label="Related">
                  <h2 className="ha-related-title">Related</h2>
                  <ul>
                    {results.slice(1).map((r) => (
                      <li key={r.href}>
                        {r.kind === "answer" ? (
                          <button type="button" className="ha-related-item" onClick={() => { setQuery(""); setAnswerId(r.id); window.scrollTo({ top: 0 }); }}>
                            <span className="ha-related-name">{r.title}</span>
                            <span className="ha-related-meta">Answer</span>
                          </button>
                        ) : (
                          <Link href={helpHref(r.href, from)} className="ha-related-item">
                            <span className="ha-related-name">{r.title}</span>
                            <span className="ha-related-meta">{r.kind === "step" ? `In ${r.guideTitle}` : "Guide"}</span>
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {idle && popular.length > 0 && (
        <section className="ha-popular" aria-labelledby="ha-popular-title">
          <h2 id="ha-popular-title" className="ha-section-title">Popular</h2>
          <ul>
            {popular.map((a) => (
              <li key={a.id}>
                <button type="button" className="ha-popular-item" onClick={() => setAnswerId(a.id)}>
                  <span>{a.title}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {idle && children}
    </div>
  );
}

/** The direct answer: what to do, the button that does it, the guide for more. */
export function AnswerCard({ result, access, from }) {
  const [slug, anchor] = String(result.guide ?? "").split("#");
  const guide = slug ? findGuide(slug) : null;
  const state = result.action ? actionState(result.action, access) : null;
  const guideHref = guide ? helpHref(`/help/${slug}${anchor ? `#${anchor}` : ""}`, from) : null;
  const label = result.kind === "guide" ? "Guide" : result.kind === "step" ? `From ${result.guideTitle}` : "Answer";

  return (
    <article className="ha-answer">
      <p className="ha-answer-kind">{label}</p>
      <h2 className="ha-answer-title">{result.title}</h2>
      <p className="ha-answer-text">{result.text}</p>
      <div className="ha-answer-actions">
        {result.kind === "guide" ? (
          <Link href={helpHref(result.href, from)} className="btn btn-primary">Open guide →</Link>
        ) : (
          <>
            {state?.ok && (
              <Link
                href={isHelpLink(result.action.href) ? helpHref(result.action.href, from) : result.action.href}
                className="btn btn-primary"
              >
                {result.action.label} →
              </Link>
            )}
            {guideHref && (
              <Link href={guideHref} className="ha-guide-link">
                Full guide: {guide.title} →
              </Link>
            )}
          </>
        )}
      </div>
      {state && !state.ok && state.reason && <p className="hc-unavailable">{state.reason}</p>}
    </article>
  );
}
