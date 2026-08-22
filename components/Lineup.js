"use client";

import { useState, useRef } from "react";

/**
 * The Lineup — sequence prototype.
 *
 * Five product objects on one persistent stage. Selecting a module features
 * it; its stages reveal what that object actually does.
 *
 * EVERY STATE IS A REAL CAPTURE. Nothing was drawn, redrawn, composited or
 * inferred. Cropping is the only thing done to them, which is what makes the
 * transitions honest: moving from "Tournament" to "Games" shows two things the
 * product genuinely renders, one after the other, rather than an animation
 * pretending an interface responded.
 *
 * The stages are NOT a carousel. No auto-advance, no arrows, no dots floating
 * over the image, no "1 of 3". They are named views attached to the object —
 * Season, Tournament, Games — so a visitor reads what is available instead of
 * discovering it by clicking through.
 *
 * Desktop and mobile objects are deliberately NOT normalised. A lineup is set
 * on a phone in a dugout; a budget is reviewed on a laptop. That contrast is
 * part of what the product is, so the prototype keeps it.
 */

const MODULES = [
  {
    key: "tournaments",
    name: "Tournaments",
    spec: [
      ["Tracks", "Every weekend you are considering, committed to, or have played"],
      ["Know", "Where you are going, what it costs, and who is registered"],
      ["Carries", "The facility, the fees and the games that belong to it"],
    ],
    stages: [
      { label: "Season", img: "/lineup/tour-1-season.webp", wide: true,
        alt: "A season of eight committed tournaments with dates, providers, facilities and costs" },
      { label: "Tournament", img: "/lineup/tour-2-tournament.webp",
        alt: "One tournament opened, showing games, roster, costs and registration status" },
      { label: "Games", img: "/lineup/tour-3-games.webp", wide: true,
        alt: "The games inside that tournament, each with an opponent, date and bracket" },
    ],
  },
  {
    key: "finance",
    name: "Finance",
    spec: [
      ["Tracks", "The season budget, player dues and every expense"],
      ["Know", "What is spent, what is promised, and what is genuinely left"],
      ["Carries", "A tournament's entry fee, from the weekend to the budget line"],
    ],
    stages: [
      { label: "Budget", img: "/lineup/fin-1-budget.webp", wide: true,
        alt: "A season budget of $29,480 showing paid, still to pay, and available" },
      { label: "Category", img: "/lineup/fin-2-fees.webp", wide: true,
        alt: "The tournament fees category opened, showing the budget line beneath it" },
      { label: "Linked", img: "/lineup/fin-3-linked.webp",
        alt: "A paid transaction of $575 linked to the Peach State Showdown tournament" },
    ],
  },
  {
    key: "facilities",
    name: "Facilities",
    spec: [
      ["Tracks", "A shared catalog of fields, with verified addresses"],
      ["Know", "Where the parking is, what the gate is like, how long the walk is"],
      ["Carries", "Your own notes on a field, private to your organization"],
    ],
    stages: [
      { label: "Directory", img: "/lineup/fac-1-directory.webp", wide: true,
        alt: "A directory of facilities with location, number of fields, surface and amenities" },
      { label: "Facility", img: "/lineup/fac-2-facility.webp",
        alt: "One facility showing team notes on parking, gates and concessions, and its tournament history" },
    ],
  },
  {
    key: "performance",
    name: "Performance",
    premium: true,
    spec: [
      ["Tracks", "Quality at-bats, recorded live by the coach who saw them"],
      ["Know", "How the team is hitting, game by game and player by player"],
      ["Carries", "The reason behind every one, across the whole season"],
    ],
    stages: [
      { label: "Lineup", img: "/lineup/perf-1-lineup.webp", phone: true,
        alt: "A batting order of twelve players set for a game, on a phone" },
      { label: "Live", img: "/lineup/perf-2-liveqab.webp", phone: true,
        alt: "A coach recording a quality at-bat, with hard hit ball selected" },
      { label: "Season", img: "/lineup/perf-3-season.webp", phone: true,
        alt: "The reasons cited across the season: walks, hits, sacrifices and long at-bats" },
    ],
  },
  {
    key: "reports",
    name: "Reports",
    spec: [
      ["Tracks", "Nothing new — it reads the season you already have"],
      ["Know", "What to hand a family, without assembling it first"],
      ["Carries", "The budget and the schedule, as documents rather than screens"],
    ],
    stages: [
      { label: "Reports", img: "/lineup/rep-1-hub.webp", wide: true,
        alt: "The reports available for a season, grouped by planning, performance and wrap-up" },
      { label: "Budget", img: "/lineup/rep-2-budget.webp",
        alt: "A planned season budget written for families, showing where the money goes" },
      { label: "Schedule", img: "/lineup/rep-3-schedule.webp",
        alt: "A tournament schedule for the season, with dates, facilities and opponents" },
    ],
  },
];

export function Lineup({ tone = "dark" }) {
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState(0);
  const tabs = useRef([]);

  function pick(i) {
    setActive(i);
    setStage(0);
    tabs.current[i]?.focus();
    tabs.current[i]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(e) {
    const last = MODULES.length - 1;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = active === last ? 0 : active + 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = active === 0 ? last : active - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    pick(next);
  }

  const m = MODULES[active];

  return (
    <div className={`ln ln-${tone}`}>
      {/* Fixed-height stage, so neither changing module nor changing view can
          move the page. */}
      <div className="ln-stage">
        {m.stages.map((s, i) => (
          <div
            key={s.label}
            className={`ln-object${i === stage ? " on" : ""}${s.phone ? " phone" : ""}${s.wide ? " wide" : ""}`}
            aria-hidden={i !== stage}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.img} alt={i === stage ? s.alt : ""} decoding="async" />
          </div>
        ))}

        {/* Named views attached to the object, not slideshow controls. */}
        <div className="ln-views" role="tablist" aria-label={`${m.name} views`}>
          {m.stages.map((s, i) => (
            <button
              key={s.label}
              role="tab"
              aria-selected={i === stage}
              tabIndex={i === stage ? 0 : -1}
              className={`ln-view${i === stage ? " on" : ""}`}
              onClick={() => setStage(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ln-detail">
        <h3 className="ln-name">
          {m.name}
          {m.premium && <span className="ln-premium">Premium</span>}
        </h3>

        <dl className="ln-spec" key={m.key}>
          {m.spec.map(([label, value], i) => (
            <div className="ln-spec-row" key={label} style={{ "--i": i }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="ln-rail" role="tablist" aria-label="Season Tempo modules" onKeyDown={onKeyDown}>
        {MODULES.map((mod, i) => (
          <button
            key={mod.key}
            ref={(el) => (tabs.current[i] = el)}
            role="tab"
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            className={`ln-tab${i === active ? " on" : ""}`}
            onClick={() => pick(i)}
          >
            {mod.name}
          </button>
        ))}
      </div>
    </div>
  );
}
