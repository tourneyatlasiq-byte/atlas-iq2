"use client";

import { useState } from "react";

/**
 * The Arrangement.
 *
 * The products are the artwork. Five real Season Tempo objects share one
 * ground at deliberately different scales, overlapping where it helps the
 * composition. There is no frame, no card, no browser chrome, no rail, no tab
 * bar and no grid — the objects themselves are the layout.
 *
 * Each object keeps the form the product actually gave it: Performance is a
 * phone, Reports is a sheet of paper, Finance is a wide horizontal bar,
 * Facilities stands upright, Tournaments is the large dim anchor at the back.
 * Normalising them into equal rectangles is exactly what made the previous
 * attempt read as a feature tour.
 *
 * AT REST the composition is not trying to be readable. It is trying to show
 * that Season Tempo is several substantial things that belong together. Only a
 * selected object grows large enough to inspect, and only then do its other
 * real states appear.
 *
 * Every image is a real capture, cropped. Nothing drawn or composited.
 */

const OBJECTS = [
  {
    key: "tournaments",
    name: "Tournaments",
    // The anchor: largest footprint, furthest back, quietest.
    rest: { left: "0%", top: "11.5%", w: "30%", rot: -1.1, z: 1, dim: 0.66 },
    states: [
      { label: "Season", img: "/lineup/tour-1-season.webp",
        alt: "Eight committed tournaments with dates, providers, facilities and costs" },
      { label: "Tournament", img: "/lineup/tour-2-tournament.webp",
        alt: "One tournament opened, showing games, roster and costs" },
      { label: "Games", img: "/lineup/tour-3-games.webp",
        alt: "The games inside that tournament, with opponents and brackets" },
    ],
  },
  {
    key: "facilities",
    name: "Facilities",
    // Upright, overlapping the anchor's right edge.
    rest: { left: "21.5%", top: "49.5%", w: "19%", rot: 1.6, z: 2, dim: 0.8 },
    states: [
      { label: "Directory", img: "/lineup/fac-1-directory.webp",
        alt: "A directory of facilities with location, fields, surface and amenities" },
      { label: "Facility", img: "/lineup/fac-2-facility.webp",
        alt: "One facility with team notes on parking, gates and concessions" },
    ],
  },
  {
    key: "reports",
    name: "Reports",
    // A sheet of paper, laid at a shallow angle.
    rest: { left: "64.5%", top: "2%", w: "23.5%", rot: 2.2, z: 2, dim: 0.86 },
    states: [
      { label: "Budget", img: "/lineup/rep-2-budget.webp",
        alt: "A planned season budget written for families" },
      { label: "Schedule", img: "/lineup/rep-3-schedule.webp",
        alt: "A tournament schedule with dates, facilities and opponents" },
      { label: "Reports", img: "/lineup/rep-1-hub.webp",
        alt: "The reports available for a season" },
    ],
  },
  {
    key: "finance",
    name: "Finance",
    // Wide and horizontal, cutting across the lower composition and bleeding
    // off the right edge.
    rest: { left: "44%", top: "60%", w: "50.5%", rot: -0.8, z: 3, dim: 0.94 },
    states: [
      { label: "Budget", img: "/lineup/fin-1-budget.webp",
        alt: "A season budget of $29,480 showing paid, still to pay and available" },
      { label: "Category", img: "/lineup/fin-2-fees.webp",
        alt: "The tournament fees category opened, showing the budget line beneath" },
      { label: "Linked", img: "/lineup/fin-3-linked.webp",
        alt: "A paid transaction of $575 linked to the Peach State Showdown tournament" },
    ],
  },
  {
    key: "performance",
    name: "Performance",
    premium: true,
    // Fully forward, unobscured, the tallest thing on the ground.
    rest: { left: "40%", top: "4.5%", w: "20.5%", rot: 0, z: 4, dim: 1 },
    states: [
      { label: "Live", img: "/lineup/perf-2-liveqab.webp",
        alt: "A coach recording a quality at-bat, with hard hit ball selected" },
      { label: "Lineup", img: "/lineup/perf-1-lineup.webp",
        alt: "A batting order of twelve players set for a game" },
      { label: "Season", img: "/lineup/perf-3-season.webp",
        alt: "The reasons cited across the season" },
    ],
  },
];

export function Arrangement({ tone = "dark" }) {
  const [focus, setFocus] = useState(null);
  const [state, setState] = useState(0);

  function select(key) {
    if (focus === key) return;
    setFocus(key);
    setState(0);
  }

  const active = OBJECTS.find((o) => o.key === focus) ?? null;

  return (
    <div className={`ar ar-${tone}${focus ? " focused" : ""}`}>
      <div
        className="ar-ground"
        onClick={(e) => {
          // Clicking the ground itself returns to the composition.
          if (e.target === e.currentTarget) setFocus(null);
        }}
      >
        {OBJECTS.map((o) => {
          const isFocus = o.key === focus;
          const src = isFocus ? o.states[state] : o.states[0];
          return (
            <button
              key={o.key}
              type="button"
              className={`ar-obj${isFocus ? " on" : ""}${focus && !isFocus ? " back" : ""}`}
              style={{
                "--l": o.rest.left,
                "--t": o.rest.top,
                "--w": o.rest.w,
                "--rot": `${o.rest.rot}deg`,
                "--z": o.rest.z,
                "--dim": o.rest.dim,
              }}
              aria-pressed={isFocus}
              onClick={() => (isFocus ? setFocus(null) : select(o.key))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src.img} alt={isFocus ? src.alt : o.name} decoding="async" />
              <span className="ar-tag">
                {o.name}
                {o.premium && <i className="ar-dot" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* The deeper controls belong to the selected object, not to the resting
          composition. They sit under the focused object rather than in a rail,
          so it still reads as part of the arrangement while being inspected. */}
      {active && (
        <div className="ar-states">
          <span className="ar-states-name">
            {active.name}
            {active.premium && <span className="ar-premium">Premium</span>}
          </span>
          <span className="ar-states-list">
            {active.states.map((s, i) => (
              <button
                key={s.label}
                type="button"
                className={`ar-state${i === state ? " on" : ""}`}
                onClick={() => setState(i)}
              >
                {s.label}
              </button>
            ))}
          </span>
          <button type="button" className="ar-close" onClick={() => setFocus(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
