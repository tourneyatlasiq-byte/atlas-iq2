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
          {/* Pricing is absent: the route does not exist on this branch, so it
              is not shown at all rather than displayed as a destination that
              cannot be reached. */}
          <nav className="sp-nav-links"><span>Product</span><span>About</span></nav>
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

          {/* The results strip moves INTO the first viewport as the right-hand
              counterweight. The open space was the problem; more type and a
              second column solve it without a screenshot, card or ornament. */}
          <div className="sp-hero-foot">
            <div className="sp-hero-left">
              <p className="sp-lede">
                Season Tempo is where a season is run — the weekends, the money, the games and
                what came of them, in one place.
              </p>
              <div className="sp-actions">
                <span className="sp-btn">Try Season Tempo</span>
                <span className="sp-note">Free during early access.</span>
              </div>
            </div>

            <div className="sp-results">
              <p className="sp-results-head">Fall Kickoff Classic</p>
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
              <p className="sp-results-note">Hobgood Park · Woodstock, GA</p>
            </div>
          </div>

          <p className="sp-attrib">
            <span>Northgate 16U Gold</span>
            <span>2026–27 season</span>
            <span>Real data throughout</span>
          </p>
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

      {/* --- Finance as a consequence of the weekend ---------------------

           CORRECTED. An earlier version of this section claimed the $6,365
           was "already in the budget" and that "nobody typed it twice". The
           data path does not support either:

             $6,365   read-time aggregate of committed tournaments
             $5,050   of that is assigned to a budget category
             $1,315   is NOT assigned to any category
             $22,000  Tournament Fees is a planned figure, entered separately

           So the commitments are not contained in the planned budget, and the
           plan was not derived from them. The real benefit is narrower and
           more useful: Season Tempo knows what has been committed before any
           invoice arrives, holds that next to what was planned, and says so
           when a commitment has not been assigned anywhere yet. */}
      <section className="sp-consequence">
        <div className="sp-wrap sp-split">
          <div>
            <p className="sp-eyebrow">Before a single invoice arrives</p>
            <h2 className="sp-section">
              <span className="sp-figure">$6,365</span>
              committed. <span className="sp-muted">$1,130</span> actually paid.
            </h2>
            <p className="sp-body">
              A tournament counts against the season the moment you commit to it, not when
              somebody sends a bill. Season Tempo holds what you have promised next to what you
              planned to spend &mdash; and tells you when $1,315 of it hasn&rsquo;t been assigned
              to a category yet.
            </p>
          </div>

          <figure className="sp-plate sp-plate-tall">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-commitments.webp"
              alt="A season budget of $29,480 showing $3,544 paid, $5,660 still to pay, and a note that $1,315 in tournament commitments is not assigned to a budget category" />
            <figcaption>
              Season budget &middot; unassigned commitments are called out, not absorbed.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- Saturday ----------------------------------------------------

           The planned weekend becomes an actual game. Two plates, not three:
           the lineup is described rather than shown, because a third
           screenshot turns a chapter into a gallery.

           EVERY FIGURE VERIFIED against production before it was written:
             97 plate appearances, 56 quality at-bats  = 57.7%
             5 games tracked, 13 players
             57 reasons across 56 QABs (an at-bat can earn more than one)
             walk 15 · hit 10 · situation 7 · sac fly 6 · hard hit 5 ·
             8+ pitch 5 · sac bunt 5 · HBP 4
           No causal claim is made anywhere: the product counts reasons, it
           never relates them to runs or to winning. */}
      <section className="sp-saturday">
        <div className="sp-wrap">
          <hr className="sp-rule" />
          <p className="sp-eyebrow">The weekend itself</p>
          <h2 className="sp-chapter">Then Saturday happens.</h2>
          <p className="sp-body sp-chapter-body">
            The batting order is set from the roster that travelled. Two games that weekend,
            both already attached to the tournament they belong to. From here the season stops
            being a plan and starts being something that happened.
          </p>
        </div>

        <div className="sp-wrap sp-split sp-split-tight">
          <figure className="sp-plate sp-plate-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-atbat.webp"
              alt="A phone showing a plate appearance being recorded, with hard hit ball selected among eight possible reasons" />
            <figcaption>Recorded between innings, on the phone in your pocket.</figcaption>
          </figure>

          <div>
            <p className="sp-eyebrow">One at-bat at a time</p>
            <h2 className="sp-section">
              A hit is not the only thing worth writing down.
            </h2>
            <p className="sp-body">
              The eight-pitch battle that wore a pitcher out. The bunt that moved a runner to
              third. The walk that started the inning. A coach who watched it decides what it
              was, in the moment, before the detail is gone.
            </p>
          </div>
        </div>

        <div className="sp-wrap sp-monday">
          <div className="sp-monday-lead">
            <p className="sp-eyebrow">And by Monday</p>
            {/* The arithmetic IS the statement. 97 appearances produced 56
                quality at-bats, and those 56 carried 57 reasons between them —
                one at-bat can earn more than one. Nothing here implies a
                reason exists for every plate appearance. */}
            <p className="sp-tally">
              <span><b>97</b> plate appearances.</span>
              <span><b>56</b> quality at-bats.</span>
              <span><b>57</b> reasons why.</span>
            </p>
            <p className="sp-body sp-tally-note">
              Walks outnumbered hits, fifteen to ten. Not a number a box score keeps.
            </p>
          </div>

          <figure className="sp-plate sp-plate-reasons">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-reasons.webp"
              alt="Reasons cited across the season: walk 15, hit 10, situation success 7, sacrifice fly 6, hard hit ball 5, eight-pitch at-bat 5, sacrifice bunt 5, hit by pitch 4" />
            <figcaption>
              Reasons cited · 57 across 56 quality at-bats, Northgate 16U Gold.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- What the season gives back ----------------------------------

           Deliberately NOT titled Reports, and deliberately not a gallery.
           Two documents, shown as documents rather than as screens, because
           what leaves the product is a printed page a family reads.

           The claim that nothing is assembled by hand is supported by the
           product itself: reports read live season data each time they are
           opened; nothing is saved or snapshotted. */}
      <section className="sp-give">
        <div className="sp-wrap">
          <hr className="sp-rule" />
          <p className="sp-eyebrow">And then somebody asks what it costs</p>
          <h2 className="sp-chapter">By the time a parent asks,<br />it is already written.</h2>
          <p className="sp-body sp-chapter-body">
            A budget a family can read without a phone call. A schedule that goes on the
            fridge. Neither is assembled — both are read from the season you have been keeping
            since August, every time they are opened.
          </p>
        </div>

        <div className="sp-wrap sp-docs">
          <figure className="sp-doc">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-doc-budget.webp"
              alt="A printed planned season budget for Northgate 16U Gold showing a $29,480 season, where the money goes by category, player dues and planned fundraising" />
            <figcaption>Planned Season Budget · what the season costs, and why.</figcaption>
          </figure>

          <figure className="sp-doc">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-doc-schedule.webp"
              alt="A printed 2026-27 tournament schedule listing eight committed weekends with dates, facilities, addresses and the games played at each" />
            <figcaption>Tournament Schedule · every weekend, every field, every address.</figcaption>
          </figure>
        </div>
      </section>

    </div>
  );
}
