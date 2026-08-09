"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { hideGettingStarted } from "../lib/actions/onboarding";
import { setupComplete } from "../lib/onboarding";

/**
 * Getting started card.
 *
 * Five steps, each launching a workflow that already exists. Completion is
 * derived from real data, so there is nothing to tick off and nothing that can
 * fall out of step with reality.
 *
 * The card disappears on its own once all five are done. Hide it is there for
 * a coach who genuinely doesn't need one of them.
 */
export function GettingStarted({ steps }) {
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
            Your team, roster, first tournament and dues are in. Season Tempo has what it needs to
            run the season from here.
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
          <span className="gs-count">{done} of {steps.length} done</span>
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
              <span className="gs-title">{s.title}</span>
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
    </div>
  );
}
