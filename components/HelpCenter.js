import Link from "next/link";
import { SUPPORT_EMAIL } from "../lib/legal";
import { HELP_GUIDES, actionState, helpHref, helpReturn, isHelpLink } from "../lib/help";
import { HelpGuidePicker, HelpSearch } from "./HelpTools";
import { HelpAsk } from "./HelpAsk";
import { popularAnswers } from "../lib/help-answers";

/**
 * Help & Getting Started (V1, 2026-11).
 *
 * Server-rendered and read-only: nothing here writes. Every product action a
 * guide offers is one that already exists, and an action the person can't
 * complete is replaced by a sentence saying why (actionState).
 *
 * `from` is the exact screen the person came from. It is carried between Help
 * pages and drives "Back to …", so returning reopens the same tab and drawer.
 */

export function HelpBack({ from }) {
  const back = helpReturn(from);
  if (!back) return null;
  return (
    <Link href={back.href} className="hc-back">
      <span aria-hidden="true">←</span> Back to {back.label}
    </Link>
  );
}

/** A guide action, or the reason it isn't offered. */
function GuideAction({ action, access, from }) {
  if (!action) return null;
  const state = actionState(action, access);
  if (!state.ok) return <p className="hc-unavailable">{state.reason}</p>;

  const href = isHelpLink(action.href) ? helpHref(action.href, from) : action.href;
  return (
    <Link href={href} className="btn btn-secondary hc-action">
      {action.label} <span aria-hidden="true">→</span>
    </Link>
  );
}

/* ---------------- /help ---------------- */

/**
 * "How can we help?" (2026-11): question first, answer first, guides second.
 * The nine guides are one tap away (Browse all guides) but don't fill the
 * page.
 */
export function HelpHome({ progress, access, from, query = "", answer = null, showGuides = false }) {
  const back = helpReturn(from);
  const fromHref = back?.href ?? null;
  return (
    <div className="page hc-page hc-home">
      <HelpBack from={from} />

      <header className="hc-hero">
        <h1>How can we help?</h1>
        <p>Ask a question or describe what you&rsquo;re trying to do.</p>
      </header>

      <HelpAsk
        from={fromHref}
        access={access}
        popular={popularAnswers({ qab: access.qab })}
        initialQuery={query}
        initialAnswer={answer}
      >
        <SetupProgress progress={progress} access={access} from={fromHref} />

        <p className="hc-more">
          <Link href={`${helpHref("/help?view=guides", fromHref)}#all-guides`}>Browse all guides</Link>
          <span aria-hidden="true">|</span>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
        </p>

        {showGuides && (
          <section className="hc-section" id="all-guides" aria-labelledby="hc-guides">
            <h2 id="hc-guides" className="hc-section-title">All guides</h2>
            <ul className="hc-guides">
              {HELP_GUIDES.map((g) => (
                <li key={g.slug}>
                  <Link href={helpHref(`/help/${g.slug}`, fromHref)} className="hc-guide-card">
                    <span className="hc-guide-title">
                      {g.title}
                      {g.feature === "qab" && !access.qab && <span className="hc-premium">Premium</span>}
                    </span>
                    <span className="hc-guide-text">{g.summary}</span>
                    <span className="hc-guide-meta">{g.steps.length} steps</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </HelpAsk>
    </div>
  );
}

/**
 * Setup as progress (2026-11): the existing live checklist plus first game
 * and, with QAB, first batting order — all read from real data. Shown while
 * anything is left, including for a coach who hid the checklist on Home.
 */
function SetupProgress({ progress, access, from }) {
  if (!progress || progress.done === progress.total) return null;
  const next = progress.steps.find((s) => !s.done && s.href) ?? progress.steps.find((s) => !s.done);
  // A past season takes no new setup; say so rather than send anyone into it.
  const state = next?.href
    ? access.phase === "past"
      ? { ok: false, reason: "You're viewing a past season. Switch to the current season to keep setting up." }
      : actionState({ href: next.href, requires: "write", creates: next.creates }, access)
    : null;
  const pct = Math.round((progress.done / progress.total) * 100);
  // A new team sees every step. Once three are done, the card shrinks to the
  // next step, so it stops dominating the page (especially on a phone).
  const compact = progress.done >= 3;

  const list = (
    <ul className="hc-progress-list">
      {progress.steps.map((s) => (
        <li key={s.id} className={s.done ? "done" : undefined}>
          <span className="hc-progress-mark" aria-hidden="true">{s.done ? "✓" : ""}</span>
          <span>{s.label}{s.done && <span className="visually-hidden"> (done)</span>}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className={`hc-progress${compact ? " compact" : ""}`} id="checklist" aria-labelledby="hc-progress-title">
      <div className="hc-progress-head">
        <h2 id="hc-progress-title">Get your team ready</h2>
        <span className="hc-progress-count">{progress.done} of {progress.total} complete</span>
      </div>
      <div className="hc-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Setup progress">
        <span style={{ width: `${pct}%` }} />
      </div>

      {compact ? (
        next && <p className="hc-progress-next"><span>Next:</span> {next.label}</p>
      ) : (
        list
      )}

      <div className="hc-progress-actions">
        {state?.ok && (
          <Link href={next.href} className="btn btn-primary">Continue setup →</Link>
        )}
        {state && !state.ok && <span className="hc-unavailable">{state.reason}</span>}
        {!compact && <Link href={helpHref("/help/setup", from)} className="ha-guide-link">Setup guide →</Link>}
      </div>

      {compact && (
        <details className="hc-progress-all">
          <summary>View all steps</summary>
          {list}
          <Link href={helpHref("/help/setup", from)} className="ha-guide-link">Setup guide →</Link>
        </details>
      )}
    </section>
  );
}

/* ---------------- /help/[guide] ---------------- */

export function HelpGuide({ guide, access, from }) {
  const back = helpReturn(from);
  const fromHref = back?.href ?? null;
  const locked = guide.feature === "qab" && !access.qab;

  return (
    <div className="page hc-page">
      <HelpBack from={from} />

      {/* A compact selector and search instead of a permanent list of all nine
          guides (2026-11): more room for the guide, and nothing long above it
          on a phone. */}
      <div className="hc-toolbar">
        <HelpGuidePicker current={guide.slug} from={fromHref} />
        <HelpSearch from={fromHref} compact />
      </div>

      <div className="hc-guide-layout">
        <article className="hc-article">
          <h1 className="hc-title">{guide.title}</h1>
          <p className="hc-summary">{guide.summary}</p>
          <p className="hc-who">{guide.who}</p>

          {locked && (
            <p className="hc-locked">
              Performance is a Premium feature and isn&rsquo;t turned on for your organization. This
              guide shows how it works. To ask about it, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          )}

          {guide.pieces && (
            <section className="hc-pieces" aria-label={guide.pieces.title}>
              <h2 className="hc-pieces-title">{guide.pieces.title}</h2>
              <dl>
                {guide.pieces.items.map((p) => (
                  <div key={p.term} className="hc-piece">
                    <dt>{p.term}</dt>
                    <dd>{p.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <ol className="hc-steps">
            {guide.steps.map((s, i) => (
              <li key={s.id} id={s.id} className="hc-step">
                <span className="hc-step-num" aria-hidden="true">{i + 1}</span>
                <div className="hc-step-body">
                  <h2 className="hc-step-title">{s.title}</h2>
                  <p className="hc-step-text">{s.text}</p>
                  <GuideAction action={s.action} access={access} from={fromHref} />
                </div>
              </li>
            ))}
          </ol>

          {guide.goodToKnow?.length > 0 && (
            <aside className="hc-know" aria-label="Good to know">
              <h2 className="hc-know-title">Good to know</h2>
              <ul>
                {guide.goodToKnow.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </aside>
          )}

          {guide.related?.length > 0 && (
            <p className="hc-related">
              {guide.related.map((r, i) => (
                <span key={r.href}>
                  {i > 0 && <span className="hc-related-sep" aria-hidden="true"> · </span>}
                  <Link href={isHelpLink(r.href) ? helpHref(r.href, fromHref) : r.href}>
                    {r.label} →
                  </Link>
                </span>
              ))}
            </p>
          )}
        </article>
      </div>
    </div>
  );
}
