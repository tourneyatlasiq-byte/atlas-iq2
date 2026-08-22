import "./season.css";

export const dynamic = "force-static";
export const metadata = { title: "Season proof", robots: { index: false, follow: false } };

/**
 * ART DIRECTION PROOF — Variant B's language, resequenced.
 *
 * The previous proof established travel softball in the hero and then became a
 * Finance page. This one leads with the SEASON, and lets Finance arrive as a
 * consequence of a weekend rather than as a separate feature.
 *
 * The connection between them is expressed with evidence, not a diagram:
 * $6,365 appears on the tournaments screen as committed cost, and again inside
 * the budget as "committed to tournaments". Two screens, two paths, one
 * figure. No arrows, no console, no tabs, no workflow illustration.
 *
 * Every number and result is real Northgate 2026-27 production data.
 */

/* The only three games in the season with a recorded result. */
const RESULTS = [
  { date: "AUG 5", opp: "Northside Thunder", res: "W", score: "6–1" },
  { date: "AUG 5", opp: "Cobb Crush", res: "W", score: "8–2" },
  { date: "AUG 6", opp: "Lake City Lightning", res: "L", score: "6–7" },
];

export default function SeasonProof() {
  return (
    <div className="sp">
      <header className="sp-nav">
        <div className="sp-wrap sp-nav-inner">
          <span className="sp-mark">Season Tempo</span>
          <nav className="sp-nav-links"><span>Product</span><span>Pricing</span><span>About</span></nav>
          <span className="sp-signin">Sign in</span>
        </div>
      </header>

      {/* --- Statement -------------------------------------------------- */}
      <section className="sp-hero">
        <div className="sp-wrap">
          <p className="sp-eyebrow">Travel softball</p>

          {/* Composed, not wrapped. Each line is set to hold together at every
              width rather than letting the measure decide where to break and
              strand a word. */}
          <h1 className="sp-statement">
            <span>From the first entry fee</span>
            <span>to the last at-bat.</span>
          </h1>

          <div className="sp-hero-foot">
            <p className="sp-lede">
              Season Tempo is where a season is run — the weekends, the money, the games and
              what came of them, in one place.
            </p>
            <div className="sp-actions">
              <span className="sp-btn">Try Season Tempo</span>
              <span className="sp-note">Free during early access.</span>
            </div>
          </div>

          {/* Real results as editorial texture. The gold rule above it is the
              only use of the colour on the page. */}
          <div className="sp-results">
            <ul>
              {RESULTS.map((g) => (
                <li key={g.opp}>
                  <span className="sp-r-date">{g.date}</span>
                  <span className="sp-r-opp">{g.opp}</span>
                  <span className={`sp-r-res ${g.res === "W" ? "w" : "l"}`}>{g.res}</span>
                  <span className="sp-r-score">{g.score}</span>
                </li>
              ))}
            </ul>
            <p className="sp-results-note">Fall Kickoff Classic · Hobgood Park · Woodstock, GA</p>
          </div>
        </div>
      </section>

      {/* --- The season, first ------------------------------------------ */}
      <section className="sp-season">
        <div className="sp-wrap">
          <div className="sp-lead">
            <p className="sp-eyebrow">The season</p>
            <h2 className="sp-section">
              <span className="sp-figure">Eight weekends</span>
              from August to April, and everything each one takes.
            </h2>
            <p className="sp-body">
              Where you are going. Who is running it. Which field, and what it costs to be
              there. A season is not a calendar — it is eight commitments, each with a
              registration, a roster and a set of games that came out of it.
            </p>
          </div>

          <figure className="sp-plate sp-plate-wide">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-season.webp"
              alt="Eight committed tournaments from August to April with dates, providers, facilities, registration status and cost, totalling $6,365 committed" />
            <figcaption>
              Committed tournaments · Northgate 16U Gold, 2026–27 season.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- Finance as a consequence of the weekend --------------------- */}
      <section className="sp-consequence">
        <div className="sp-wrap sp-split">
          <div>
            <p className="sp-eyebrow">And what it already cost you</p>
            <h2 className="sp-section">
              That
              <span className="sp-figure sp-figure-inline">$6,365</span>
              is already in the budget. Nobody typed it twice.
            </h2>
            <p className="sp-body">
              An entry fee is entered once, on the weekend it belongs to. It counts against
              the season the moment you commit — long before an invoice arrives, and whether or
              not anyone has been paid.
            </p>
          </div>

          <figure className="sp-plate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-committed.webp"
              alt="A season budget showing $6,365 committed to tournaments and $1,130 paid, above the expense categories" />
            <figcaption>
              Season budget · the same figure, arrived at from the other direction.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="sp-next">
        <div className="sp-wrap">
          <hr className="sp-rule" />
          <p className="sp-eyebrow">Next</p>
          <h2 className="sp-section sp-next-head">Then Saturday happens.</h2>
        </div>
      </section>
    </div>
  );
}
