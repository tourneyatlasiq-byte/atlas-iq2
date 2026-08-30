"use client";

import { useState, useRef } from "react";

/**
 * The product story.
 *
 * Five steps inside ONE bounded frame. Choosing a step swaps the copy and the
 * screenshot in place; nothing navigates, nothing reloads, and the frame keeps
 * a fixed aspect so switching cannot shift the page.
 *
 * Replaces a four-beat vertical timeline that consumed most of the homepage.
 * The same argument in roughly a fifth of the height, and the visitor drives
 * it rather than scrolling past it.
 *
 * No carousel dependency, no auto-advance, no 3D, no page-turn. Tabs are the
 * honest semantics for this, so it is built as tabs: roving focus, arrow keys,
 * Home/End, and the active step marked by weight, rule and aria-selected
 * rather than colour alone.
 */
const STEPS = [
  {
    n: "01",
    tab: "Tournament",
    title: "Commit to the weekend.",
    body: "Track the tournament, facility, registration and entry fee together.",
    img: "/mk-tournaments.webp",
    mobileImg: "/mk-tournaments-mobile.webp",
    alt: "A season of committed tournaments with dates, providers and facilities",
  },
  {
    n: "02",
    tab: "Finance",
    title: "Know what it changes.",
    body:
      "Committed tournament costs become part of the season budget, so you can see what's spoken for before it's paid.",
    img: "/mk-finance.webp",
    mobileImg: "/mk-finance-mobile.webp",
    alt: "Season budget showing paid, still to pay, and available",
  },
  {
    n: "03",
    tab: "Game day",
    title: "Track what happens.",
    body: "Set the lineup, record the score and track quality at-bats from the dugout.",
    img: "/mk-qab-phone.webp",
    alt: "Recording what made a plate appearance a quality at-bat, on a phone",
    phone: true,
  },
  {
    n: "04",
    tab: "Performance",
    title: "See what the season is showing you.",
    body: "Review quality at-bats by game, player and the reasons coaches recorded.",
    img: "/mk-qab-reasons.webp",
    alt:
      "Reasons cited across the season: walks, hits, situational success, sacrifices and long at-bats",
  },
  {
    n: "05",
    tab: "Reports",
    title: "Share what matters.",
    body:
      "Turn the information already in Season Tempo into reports coaches and families can actually use.",
    img: "/mk-report.webp",
    mobileImg: "/mk-report-mobile.webp",
    alt: "Planned Season Budget report showing the season budget and where the money goes",
  },
];

export function ProductStory() {
  const [active, setActive] = useState(0);
  const tabRefs = useRef([]);

  /** Arrow keys move between steps, as a tablist should. */
  function onKeyDown(e) {
    const last = STEPS.length - 1;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active === last ? 0 : active + 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active === 0 ? last : active - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  const step = STEPS[active];

  return (
    <div className="ps">
      <div
        className="ps-tabs"
        role="tablist"
        aria-label="How Season Tempo works across a season"
        onKeyDown={onKeyDown}
      >
        {STEPS.map((s, i) => (
          <button
            key={s.n}
            ref={(el) => (tabRefs.current[i] = el)}
            role="tab"
            id={`ps-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`ps-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            className={`ps-tab${i === active ? " on" : ""}`}
            onClick={() => setActive(i)}
          >
            <span className="ps-tab-n">{s.n}</span>
            <span className="ps-tab-label">{s.tab}</span>
          </button>
        ))}
      </div>

      <div
        className="ps-panel"
        role="tabpanel"
        id={`ps-panel-${active}`}
        aria-labelledby={`ps-tab-${active}`}
        tabIndex={0}
      >
        <div className="ps-copy">
          <p className="ps-step">
            Step {step.n} of 05 &middot; {step.tab}
          </p>
          <h3 className="ps-title">{step.title}</h3>
          <p className="ps-body">{step.body}</p>
        </div>

        <div className={`ps-visual${step.phone ? " phone" : ""}`}>
          {/* Every step's image is rendered and hidden rather than swapped, so
              the browser has it decoded before the visitor asks for it. No
              flash, no layout shift, and the frame height never changes. */}
          {STEPS.map((s, i) => (
            <picture key={s.n} className={i === active ? "ps-img on" : "ps-img"} aria-hidden={i !== active}>
              {s.mobileImg && <source media="(max-width: 720px)" srcSet={s.mobileImg} />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.img}
                alt={i === active ? s.alt : ""}
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            </picture>
          ))}
        </div>
      </div>
    </div>
  );
}
