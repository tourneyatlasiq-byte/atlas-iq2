"use client";

import { useState, useRef } from "react";

/**
 * The Console.
 *
 * Product's principal breadth mechanism. Nine areas in the application's own
 * navigation, each opening a real screen and the specifics of what that area
 * does.
 *
 * THE CONSOLE IS LOAD-BEARING. It exists so the page does not have to stack
 * nine capabilities vertically — eight of the nine areas are a single surface
 * in the product, so a panel expresses them as completely as a full section
 * would, and the visitor chooses depth instead of scrolling past it. Only two
 * things earn their own space below: how the areas connect (which a directory
 * cannot show, because a panel shows one area at a time) and game day (which
 * spans three routes and crosses devices).
 *
 * All nine panels render server-side and are toggled by visibility rather than
 * mounted on demand, so the copy is in the document for search and for anyone
 * reading without JavaScript.
 *
 * Areas without a capture yet show a placeholder naming what is missing. It
 * never draws an approximation of the interface: a fabricated screenshot on a
 * page arguing "this is real software" would undo the argument.
 */
const AREAS = [
  {
    key: "tournaments",
    label: "Tournaments",
    line: "Every weekend you are considering, committed to, or have already played.",
    points: [
      "Dates, provider, facility and age division",
      "Entry fees, registration and payment status",
      "Tournament roster, including pickups",
      "Games, scores and results for the weekend",
    ],
    img: "/mk-tournaments.webp",
    alt: "A season of committed tournaments with dates, providers and facilities",
  },
  {
    key: "team",
    label: "Team",
    line: "The roster, and everything attached to a player.",
    points: [
      "Players and staff, kept distinct",
      "Jersey numbers and uniform sizes",
      "Guardians and contact details",
      "Roster carried from one season to the next",
    ],
    img: null,
    alt: "Team roster screen",
  },
  {
    key: "finance",
    label: "Finance",
    line: "The budget, the dues, and what you have already promised to spend.",
    points: [
      "Committed tournament costs count before they are paid",
      "Player dues reconciled against your active roster",
      "Money In tracked apart from expenses",
      "Planned, used and left, by category",
    ],
    img: "/mk-finance.webp",
    alt: "Season budget showing paid, still to pay, and available",
  },
  {
    key: "facilities",
    label: "Facilities",
    line: "Where you have played, and what you learned there.",
    points: [
      "A shared catalog of fields, with verified addresses",
      "Your own notes on a facility, private to your organization",
      "Tournament history at each venue",
      "Duplicate fields caught before they are created",
    ],
    img: null,
    alt: "Facilities directory screen",
  },
  {
    key: "performance",
    label: "Performance",
    line: "Quality at-bats, by game, by player, and by what earned them.",
    premium: true,
    points: [
      "Season and per-game quality at-bat percentage",
      "The reasons coaches recorded, counted across the season",
      "Every tracked player, with plate appearances alongside",
      "Win, loss and tie beside each game as context",
    ],
    img: "/mk-qab-reasons.webp",
    alt: "Reasons cited across the season: walks, hits, situation success, sacrifices and long at-bats",
  },
  {
    key: "reports",
    label: "Reports",
    line: "Printable documents built from the season already in Season Tempo.",
    points: [
      "Planned Season Budget, written for families",
      "Tournament Schedule for the season ahead",
      "QAB Performance for coaches",
      "Nothing to assemble and nothing to keep in step by hand",
    ],
    img: "/mk-report.webp",
    alt: "Planned Season Budget report showing the season budget and where the money goes",
  },
  {
    key: "files",
    label: "Files",
    line: "The paperwork a season generates, where you will find it again.",
    points: [
      "Waivers, insurance and rosters",
      "Attached to the tournament, facility or player it belongs to",
    ],
    img: null,
    alt: "Files screen",
  },
  {
    key: "contacts",
    label: "Contacts",
    line: "The people a season depends on.",
    points: [
      "Tournament directors, facility contacts and team staff",
      "Kept with the tournament or facility they relate to",
    ],
    img: null,
    alt: "Contacts screen",
  },
];

export function ProductConsole() {
  const [active, setActive] = useState(0);
  const tabs = useRef([]);

  /**
   * Move to an area and make sure its control is visible.
   *
   * On mobile the rail scrolls inside the Console, so the selected item can
   * sit outside the initial viewport. scrollIntoView with block:"nearest"
   * brings it in without scrolling the page itself.
   */
  function select(i) {
    setActive(i);
    const el = tabs.current[i];
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(e) {
    const last = AREAS.length - 1;
    let next = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
  }

  const area = AREAS[active];

  return (
    <div className="pc">
      {/* CANVAS FIRST. The product is the first thing on screen; the selector
          and copy are attached beneath it, sharing one frame, so the component
          reads as a single designed object rather than a navigation layer in
          front of a screenshot.

          The canvas region is a FIXED height at every breakpoint. An area
          without a capture yet shows a smaller placeholder centred inside that
          region, so choosing Files or Contacts never collapses the frame or
          shifts the page. When those captures exist they drop in without any
          geometry changing. */}
      <div className="pc-canvas">
        {AREAS.map((a, i) => (
          <div
            key={a.key}
            role="tabpanel"
            id={`pc-panel-${a.key}`}
            aria-labelledby={`pc-tab-${a.key}`}
            hidden={i !== active}
            className="pc-canvas-slot"
          >
            {a.img ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={a.img}
                alt={a.alt}
                className="pc-canvas-img"
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            ) : (
              /* Names what is missing rather than drawing an approximation.
                 A fabricated screenshot on a page arguing "this is real
                 software" would undo the argument. */
              <div className="pc-canvas-pending">
                <p className="pc-pending-label">{a.label}</p>
                <p className="pc-pending-note">Screen capture coming soon</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Attached to the canvas, sharing its frame. One row: the eight labels
          need 752px of the 1072px available, so they size to content rather
          than being forced into equal cells. */}
      <div
        className="pc-rail"
        role="tablist"
        aria-label="Areas of Season Tempo"
        onKeyDown={onKeyDown}
      >
        {AREAS.map((a, i) => (
          <button
            key={a.key}
            ref={(el) => (tabs.current[i] = el)}
            role="tab"
            id={`pc-tab-${a.key}`}
            aria-selected={i === active}
            aria-controls={`pc-panel-${a.key}`}
            tabIndex={i === active ? 0 : -1}
            className={`pc-tab${i === active ? " on" : ""}`}
            onClick={() => select(i)}
          >
            {a.label}
            {/* A dot, not a pill: Premium must not change the width or
                alignment of the rail. The word itself appears below, where
                there is room for it. */}
            {a.premium && <span className="pc-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="pc-info">
        <div className="pc-info-main">
          <h3 className="pc-info-title">
            {area.label}
            {area.premium && <span className="mk-premium">Premium</span>}
          </h3>
          <p className="pc-info-line">{area.line}</p>
        </div>
        <ul className="pc-info-points">
          {area.points.map((pt) => (
            <li key={pt}>{pt}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
