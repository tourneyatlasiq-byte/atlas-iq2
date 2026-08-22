import "./home.css";
import "./season-home.css";
import { getViewer } from "../lib/context";
import { MarketingHeader, MarketingFooter } from "../components/MarketingChrome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Season Tempo — Run a travel softball season in one place",
  description:
    "From the first entry fee to the last at-bat. Tournaments, facilities, Finance, games and performance for travel softball teams and organizations.",
};

/**
 * Home.
 *
 * Promoted from the approved prototype. The art direction is the prototype's:
 * light editorial ground, condensed display, real Northgate season data,
 * product captures as evidence rather than feature cards.
 *
 * The narrative: plan the season, see what it has already cost, play the
 * weekend, capture what happened, and get something back you can hand to a
 * family. Finance arrives as a consequence of a weekend rather than as a
 * feature, and no section presents a module.
 *
 * Every number is real and was verified against production before it was
 * written. Two relationships have already been caught being wrong here, so
 * nothing numerical or relational is inferred.
 */

/* The only three games in the season with a recorded result. */
const RESULTS = [
  { date: "AUG 5", opp: "Northside Thunder", res: "W", score: "6–1" },
  { date: "AUG 5", opp: "Cobb Crush", res: "W", score: "8–2" },
  { date: "AUG 6", opp: "Lake City Lightning", res: "L", score: "6–7" },
];

export default async function HomePage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="sp">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

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

           ONE chapter, not two. The opener and the at-bat block previously
           carried separate eyebrows and separate heads for a single idea,
           which cost roughly 340px of runway and made the fifth section in a
           row begin the same way. The QAB evidence and the strongest line are
           unchanged.

           EVERY FIGURE VERIFIED against production:
             97 plate appearances · 56 quality at-bats · 57 reasons
             5 games tracked · 13 players
             walk 15 · hit 10 · situation 7 · sac fly 6 · hard hit 5 ·
             8+ pitch 5 · sac bunt 5 · HBP 4
           No causal claim: the product counts reasons, it never relates them
           to runs or to winning. */}
      <section className="sp-saturday">
        <div className="sp-wrap">
          <hr className="sp-rule" />
          <p className="sp-eyebrow">The weekend itself</p>
          <h2 className="sp-chapter">Then Saturday happens.</h2>
        </div>

        {/* ONE composition, not three horizontal layers. The phone sat at
            268px inside a 402px column — 134px of dead space around the
            object carrying the differentiator, and the smallest plate on a
            page whose others run 815px and wider.

            The tally now lives inside the right-hand argument rather than
            announcing itself 96px below, so a coach's decision and its
            season-long consequence read as one thought. It keeps its own
            scale: still the second focal point of the section, just no longer
            a separate horizontal band. */}
        <div className="sp-wrap sp-perf">
          <figure className="sp-plate sp-plate-phone">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-atbat.webp"
              alt="A phone showing a plate appearance being recorded, with hard hit ball selected among eight possible reasons" />
            <figcaption>Recorded between innings, on the phone in your pocket.</figcaption>
          </figure>

          <div className="sp-perf-copy">
            <h3 className="sp-section">A hit is not the only thing worth writing down.</h3>
            <p className="sp-body">
              The batting order is set from the roster that travelled. Then the eight-pitch
              battle that wore a pitcher out, the bunt that moved a runner to third, the walk
              that started the inning. A coach who watched it decides what it was, in the
              moment, before the detail is gone.
            </p>

            <p className="sp-tally">
              <span><b>97</b> plate appearances.</span>
              <span><b>56</b> quality at-bats.</span>
              <span><b>57</b> reasons why.</span>
            </p>
          </div>

          <figure className="sp-plate sp-plate-reasons">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-reasons.webp"
              alt="Reasons cited across the season: walk 15, hit 10, situation success 7, sacrifice fly 6, hard hit ball 5, eight-pitch at-bat 5, sacrifice bunt 5, hit by pitch 4" />
            <figcaption>
              Walks outnumbered hits, fifteen to ten. Not a number a box score keeps.
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

      {/* --- Conclusion ---------------------------------------------------

           Type only, no plate. A conclusion to the story rather than another
           section.

           The list names ONLY what Season Tempo actually holds: entry fees
           (Finance), the schedule (Tournaments), the field (Facilities), the
           paperwork (Files), the at-bats (Performance). An earlier draft said
           "the group text", which would have claimed messaging the product
           does not have.

           The CTA block is built to take a starting price and a /pricing link
           later without changing its composition. Neither exists yet: the
           pricing is a hypothesis, and /pricing is not a route. */}
      <section className="sp-close">
        <div className="sp-wrap">
          <h2 className="sp-close-head">One season.<br />One place.</h2>
          <p className="sp-close-body">
            The entry fees, the schedule, the field you played last year, the paperwork and
            every at-bat that came out of it — kept together instead of scattered across
            whatever was closest at the time.
          </p>
          <div className="sp-close-cta">
            <span className="sp-btn">Try Season Tempo</span>
          </div>
        </div>
      </section>

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
