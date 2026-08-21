import Link from "next/link";
import "../home.css";
import "./product.css";
import { getViewer } from "../../lib/context";
import { MarketingHeader, MarketingFooter, ProductShot } from "../../components/MarketingChrome";
import { ProductConsole } from "../../components/ProductConsole";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Product — Season Tempo",
  description:
    "Explore Season Tempo: tournaments, finance, game day, performance and reports for travel softball teams and organizations.",
};

/**
 * Product.
 *
 * The job of this page is exploration and belief in depth. Home creates
 * interest; this page answers "what is actually in it?"
 *
 * The Console carries the breadth. Eight of the nine areas are a single
 * surface in the application, so a panel expresses them as completely as a
 * stacked section would — and stacking nine areas vertically would add scroll
 * without adding information. Only two things earn their own space below:
 *
 *   How it connects — a directory shows one area at a time, so it structurally
 *     cannot show the relationship between them.
 *   Game day — three routes, two devices, and the differentiator.
 *
 * Every figure here was read from production, and the relationship between
 * them was traced through the code before it was described.
 *
 * $650 is a GENERATED column on the tournament. $6,365 is a READ-TIME AGGREGATE
 * of committed tournaments. $29,480 is an aggregate of separately entered
 * budget lines. They are linked by a foreign key, NOT the same record, so this
 * page does not claim they are.
 *
 * The Tournament Fees line ($22,000) was deliberately dropped from the
 * sequence: it is a planned figure a coach typed, not a roll-up of
 * tournaments, and two committed tournaments carry no budget category at all,
 * so $6,365 is not contained within it. Showing it as a containing step would
 * have asserted a nesting the data contradicts.
 */
export default async function ProductPage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="mk">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      {/* 1 — Orient. Not a second pitch; Home already made the argument. */}
      <section className="pr-hero">
        <div className="mk-wrap">
          <p className="pr-eyebrow">Product</p>
          <h1>What a season looks like inside Season Tempo.</h1>
          <p className="pr-lede">
            Nine areas, built for travel softball, that know about each other. Open any of them
            below.
          </p>
        </div>
      </section>

      {/* 2 — The Console. All breadth lives here. */}
      <section className="pr-console-section">
        <div className="mk-wrap">
          <ProductConsole />
        </div>
      </section>

      {/* 3 — The one argument a directory cannot make. */}
      <section className="pr-connect">
        <div className="mk-wrap">
          <div className="pr-connect-head">
            <h2>Commit to one weekend, and the money follows.</h2>
            <p>
              An entry fee is not a number in a spreadsheet. It is part of what your season has
              already promised to spend, measured against the budget families are being asked
              to fund.
            </p>
          </div>

          {/* A roll-up, described as one. Each figure contains the one above
              it; no value is claimed to travel or repeat. */}
          <ol className="pr-rollup">
            <li>
              <span className="pr-rollup-value">$650</span>
              <span className="pr-rollup-label">Peach State Showdown entry fee</span>
            </li>
            <li>
              <span className="pr-rollup-value">$6,365</span>
              <span className="pr-rollup-label">
                committed across eight tournaments, this one included
              </span>
            </li>
            <li>
              <span className="pr-rollup-value">$29,480</span>
              <span className="pr-rollup-label">the season budget it is measured against</span>
            </li>
          </ol>

          <p className="pr-connect-foot">
            Enter the fee once, on the tournament. It counts toward what you&rsquo;ve committed
            from that moment &mdash; before an invoice, and before anyone has paid.
          </p>
        </div>
      </section>

      {/* 4 — Game day. Three routes, two devices, the differentiator. */}
      <section className="pr-gameday">
        <div className="mk-wrap">
          <div className="pr-gameday-head">
            <h2>
              Game day
              <span className="mk-premium">Premium</span>
            </h2>
            <p>
              Quality at-bat tracking and Performance are advanced capabilities, currently enabled
              for selected early-access organizations.
            </p>
          </div>

          <div className="pr-gameday-grid">
            <div className="pr-gd-step">
              <p className="pr-gd-n">Before the first pitch</p>
              <h3>Set the batting order.</h3>
              <p>
                Build the lineup from your tournament roster, including pickups. Copy it from a
                game you already played, then change what needs changing.
              </p>
            </div>

            <div className="pr-gd-shot phone">
              <ProductShot
                src="/mk-qab-phone.webp"
                alt="Recording what made a plate appearance a quality at-bat, on a phone"
                ratio="3 / 4"
              />
            </div>

            <div className="pr-gd-step">
              <p className="pr-gd-n">Between innings</p>
              <h3>Record what actually happened.</h3>
              <p>
                Not just hits. The eight-pitch battle, the sacrifice that moved the runner, the
                walk that started the inning — tapped in by the coach who saw it. Leave and come
                back and it resumes where each batter left off.
              </p>
            </div>

            <div className="pr-gd-step">
              <p className="pr-gd-n">Afterwards</p>
              <h3>See what earned them.</h3>
              <p>
                Quality at-bats by game and by player, and the reasons coaches recorded across the
                season. Win, loss and tie sit beside each game as context.
              </p>
            </div>

            <div className="pr-gd-shot wide">
              <ProductShot
                src="/mk-qab-reasons.webp"
                alt="Reasons cited across the season: walks, hits, situation success, sacrifices and long at-bats"
                ratio="16 / 5"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 5 — Closing principle, then convert. */}
      <section className="pr-forward">
        <div className="mk-wrap">
          <div className="pr-forward-grid">
            <div>
              <h2>It carries forward.</h2>
              <p>
                A season ends; the knowledge does not. Your roster, your facility notes, your
                tournament history and last year&rsquo;s numbers are all still there when the next
                season starts.
              </p>
            </div>

            <div className="pr-forward-cta">
              <Link
                href={signedIn ? appHref : "/login?new=1"}
                className="btn btn-primary mk-btn-lg"
              >
                {signedIn ? "Go to Season Tempo" : "Try Season Tempo"}
              </Link>
              {/* "View pricing" is the approved secondary CTA, hidden until
                  /pricing exists so no live link reaches a 404. Restore this
                  block, and the two in MarketingChrome, when Pricing ships. */}
              {/* <Link href="/pricing" className="pr-secondary">
                View pricing &rarr;
              </Link> */}
              <p className="mk-note">Free during early access.</p>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
