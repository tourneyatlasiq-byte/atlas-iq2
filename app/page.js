import Link from "next/link";
import "./site.css";
import { getViewer } from "../lib/context";
import { SUPPORT_EMAIL } from "../lib/legal";
import { MarketingHeader, MarketingFooter, Shot } from "../components/MarketingChrome";
import TwoViews from "../components/TwoViews";
import DiscSeams from "../components/DiscSeams";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The whole season, in one place.",
  description:
    "Season Tempo keeps tournaments, roster, dues, facilities, games and quality at-bats for your travel softball team in one place.",
};

const QAB_REQUEST = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Quality at-bat tracking request")}`;

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Public homepage, built on the approved Volt website concept.
 * Renders for everyone; getViewer() deliberately does not redirect.
 */
export default async function HomePage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="sx">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      <main>
        {/* Hero: headline, then the real Home screen layered on the logo's volt dot. */}
        <section className="sx-hero" aria-labelledby="h1">
          <div className="sx-wrap sx-hero-grid">
            <div className="sx-hero-copy">
              <span className="sx-kick"><i aria-hidden="true" />For travel softball teams</span>
              <h1 className="sx-h1" id="h1">
                The whole season, in one place<span className="sx-dot" aria-hidden="true" /><span className="sr-only">.</span>
              </h1>
              <p className="sx-lede">
                Plan tournaments, manage your roster and dues, and track quality at-bats from your phone.
              </p>
              <div className="sx-acts">
                {signedIn ? (
                  <Link href={appHref} className="sx-btn sx-btn-volt">Go to Season Tempo <Arrow /></Link>
                ) : (
                  <>
                    <Link href="/login?new=1" className="sx-btn sx-btn-volt">Get started <Arrow /></Link>
                    <Link href="/product" className="sx-btn sx-btn-line">See the product</Link>
                  </>
                )}
              </div>
              <p className="sx-note">Free during early access. We&rsquo;ll give you advance notice before that changes.</p>
            </div>

            <div className="sx-stage">
              <div className="sx-disc" aria-hidden="true"><DiscSeams /></div>
              <div className="sx-ring" aria-hidden="true" />
              <picture>
                <source media="(max-width: 760px)" srcSet="/marketing/hero-next-m.webp" width="780" height="1523" />
                <img className="sx-stage-next" src="/marketing/hero-next.webp" width="1300" height="1079"
                  alt="Season Tempo Home: the next tournament, Red Clay Classic, three days away, with its games, registration and payment status" />
              </picture>
              <picture>
                <source media="(max-width: 760px)" srcSet="/marketing/hero-todo-m.webp" width="780" height="1120" />
                <img className="sx-stage-todo" src="/marketing/hero-todo.webp" width="940" height="963"
                  alt="The to-do list on Home: players who still owe dues and tournaments that need registering" />
              </picture>
            </div>
          </div>
        </section>

        <TwoViews />

        {/* Quality at-bats: the product's most distinctive feature, given its own band. */}
        <section className="sx-dark sx-qab" id="qab" aria-labelledby="qab-h">
          <div className="sx-wrap sx-qab-grid">
            <div>
              <h2 className="sx-h2" id="qab-h">Quality at-bats, tracked from your phone.</h2>
              <p className="sx-p">
                Record each plate appearance and choose one primary reason when it qualifies as a quality at-bat.
              </p>
              <ul className="sx-ticks">
                <li><b>Track during the game.</b> Choose a reason and record the at-bat.</li>
                <li><b>Review the results.</b> See QAB rates and reasons by player, game and tournament.</li>
                <li><b>Share the reports.</b> Print or save player, tournament and season reports as PDFs.</li>
              </ul>
              <p className="sx-avail"><i aria-hidden="true" />Available on request during early access.</p>
              <div className="sx-acts">
                <a href={QAB_REQUEST} className="sx-btn sx-btn-volt">Request QAB access</a>
                <Link href="/quality-at-bats" className="sx-btn sx-btn-line">How it works</Link>
              </div>
            </div>

            <div className="sx-qab-stage">
              <div className="sx-qab-disc" aria-hidden="true"><DiscSeams /></div>
              <div className="sx-phone">
                <img src="/marketing/qab-tracker-phone.webp" width="1170" height="2330"
                  alt="The Season Tempo phone tracker: now batting, with the nine quality at-bat reasons to choose from" />
              </div>
            </div>
          </div>
        </section>

        <section className="sx-reports" aria-labelledby="rep-h">
          <div className="sx-wrap">
            <h2 className="sx-h2" id="rep-h">See each player&rsquo;s performance across the season.</h2>
            <p className="sx-p">Compare QAB rates across tournaments and see how each player earned their quality at-bats.</p>
            <div className="sx-reports-grid">
              <figure>
                <div className="sx-frame">
                  <Shot name="qab-player-report" w={1500} h={1435} mw={780} mh={1972} alt="An individual player QAB report: season rate, QAB percentage by tournament, and how quality at-bats were earned" />
                </div>
                <figcaption><b>Player reports</b>Each player&rsquo;s QAB rate, QAB rates by tournament and recorded reasons.</figcaption>
              </figure>
              <figure>
                <div className="sx-frame">
                  <Shot name="qab-tournament-compare" w={1500} h={730} mw={780} mh={1105} alt="Team QAB percentage with a bar for each tournament, compared with the season rate" />
                </div>
                <figcaption><b>Tournament comparison</b>Compare each tournament&rsquo;s QAB rate with the team&rsquo;s season rate.</figcaption>
              </figure>
            </div>
            <div className="sx-acts" style={{ marginTop: 40 }}>
              <Link href="/quality-at-bats" className="sx-btn sx-btn-line">Explore QAB reports</Link>
            </div>
          </div>
        </section>

        <section className="sx-section sx-alt" aria-labelledby="run-h">
          <div className="sx-wrap sx-stack">
            <div className="sx-split">
              <div>
                <h2 className="sx-h2" id="run-h">Your tournament season at a glance.</h2>
                <p className="sx-p">
                  Keep dates, registration, payments and results together, with outstanding tasks easy to find.
                </p>
                <ul className="sx-ticks">
                  <li><b>Compare your options.</b> Review tournaments you&rsquo;re considering alongside those you&rsquo;ve committed to.</li>
                  <li><b>Stay on top of registration.</b> See which committed tournaments still need registration.</li>
                </ul>
              </div>
              <div className="sx-frame">
                <Shot name="tournaments-overview" w={1600} h={712} mw={780} mh={1054} alt="Season Tempo Tournaments: the season timeline, committed tournaments, costs and record" />
              </div>
            </div>

            <div className="sx-split sx-split-flip">
              <div>
                <h2 className="sx-h2">Know what&rsquo;s paid. Know what&rsquo;s still owed.</h2>
                <p className="sx-p">
                  Track planned expenses, tournament commitments and player payments throughout the season.
                </p>
                <ul className="sx-ticks">
                  <li><b>Available budget.</b> See what&rsquo;s left after paid expenses and unpaid commitments.</li>
                  <li><b>Player dues.</b> See payments received, remaining balances and past-due amounts for players with payment schedules.</li>
                </ul>
              </div>
              <div className="sx-frame">
                <Shot name="finance-summary" w={1500} h={536} mw={780} mh={693} alt="Season Tempo Finance: available budget with paid, to pay and available figures, and outstanding player dues" />
              </div>
            </div>
          </div>
        </section>

        <section className="sx-dark sx-final" aria-labelledby="final-h">
          <div className="sx-wrap">
            <h2 className="sx-h2" id="final-h">From the first entry fee to the last <span className="sx-nb">at-bat</span>.</h2>
            <div className="sx-acts">
              {signedIn ? (
                <Link href={appHref} className="sx-btn sx-btn-volt">Go to Season Tempo <Arrow /></Link>
              ) : (
                <>
                  <Link href="/login?new=1" className="sx-btn sx-btn-volt">Get started <Arrow /></Link>
                  <Link href="/product" className="sx-btn sx-btn-line">See the product</Link>
                </>
              )}
            </div>
            <p className="sx-note">Free during early access. We&rsquo;ll give you advance notice before that changes.</p>
          </div>
        </section>
      </main>

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
