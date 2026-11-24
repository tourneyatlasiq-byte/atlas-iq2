"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { hideGettingStarted } from "../lib/actions/onboarding";
import { setupComplete, completedLabel, QAB_PITCH, QAB_REQUEST_LABEL, QAB_REQUEST_HREF } from "../lib/onboarding";

/**
 * Getting started card.
 *
 * Four steps (dues are optional), each launching a workflow that already exists. Completion is
 * derived from real data, so there is nothing to tick off and nothing that can
 * fall out of step with reality.
 *
 * Once the required steps are done the card becomes a short "You're set up"
 * note. Hide is there for a coach who doesn't want it, and Help > Setup can
 * bring it back.
 */
export function GettingStarted({ steps, qab = false }) {
  const complete = setupComplete(steps);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  const done = steps.filter((s) => s.done).length;
  if (hidden) return null;

  const next = steps.find((s) => !s.done && s.href);

  if (complete) {
    return (
      <div className="card gs-complete">
        <div>
          <p className="gs-complete-title">You&rsquo;re set up</p>
          <p className="gs-complete-body">
            Your team, roster and first tournament are in. Season Tempo has what it needs to
            run the season from here.{steps.some((s) => s.optional && !s.done) ? " Player dues are optional; set them whenever you are ready." : ""}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => {
            setHidden(true);
            startTransition(async () => {
              await hideGettingStarted();
            });
          }}
        >
          {pending ? "Hiding…" : "Got it"}
        </button>
      </div>
    );
  }

  return (
    <div className="card getting-started">
      <div className="gs-head">
        <div>
          <h2>Getting started</h2>
          <p className="gs-sub">Set up the basics and Season Tempo will take it from here.</p>
        </div>
        <div className="gs-progress">
          <span className="gs-count">{completedLabel(done, steps.length)}</span>
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await hideGettingStarted();
                setHidden(true);
              })
            }
          >
            Hide
          </button>
        </div>
      </div>

      <ol className="gs-list">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "gs-done" : undefined}>
            <span className="gs-mark" aria-hidden="true">{s.done ? "✓" : ""}</span>
            <span className="gs-text">
              <span className="gs-title">{s.title}{s.optional && !s.done && <span className="gs-optional"> (optional)</span>}</span>
              <span className="gs-detail">{s.detail}</span>
            </span>
            {!s.done && s.href && (
              <Link
                href={s.href}
                className={`btn ${s.id === next?.id ? "btn-primary" : "btn-secondary"} gs-cta`}
              >
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>

      {!qab && (
        <div className="gs-qab">
          <p className="gs-qab-title">Quality at-bat tracking</p>
          <p className="gs-qab-text">{QAB_PITCH}</p>
          <a className="btn btn-secondary" href={QAB_REQUEST_HREF}>{QAB_REQUEST_LABEL}</a>
        </div>
      )}
    </div>
  );
}
