import Link from "next/link";
import "./site.css";
import { getViewer } from "../lib/context";
import { SUPPORT_EMAIL } from "../lib/legal";
import { MarketingHeader, MarketingFooter, Shot } from "../components/MarketingChrome";
import TwoViews from "../components/TwoViews";
import DiscSeams from "../components/DiscSeams";
import { QAB_REASONS } from "../lib/qab-rules";

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
                Tournaments, roster, dues, facilities and games for your travel softball team, with
                quality at-bat tracking you can run from your phone.
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
                Choose one primary reason for each quality at-bat. Each plate appearance counts once.
              </p>
              <ul className="sx-reasons" aria-label="The nine reasons you can choose">
                {QAB_REASONS.map((r) => (
                  <li key={r.key}>{r.label}</li>
                ))}
              </ul>
              <ul className="sx-ticks">
                <li><b>Quick in the dugout.</b> Tap the reason, then tap to record it.</li>
                <li><b>See the pattern.</b> A quiet box score can still hide a strong run of quality at-bats.</li>
                <li><b>Share what you find.</b> Print or save any report as a PDF.</li>
              </ul>
              <p className="sx-avail"><i aria-hidden="true" />Available on request during early access.</p>
              <div className="sx-acts">
                <a href={QAB_REQUEST} className="sx-btn sx-btn-volt">Ask for quality at-bat tracking</a>
                <Link href="/product#qab" className="sx-btn sx-btn-line">How it works</Link>
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
            <h2 className="sx-h2" id="rep-h">Then see it by player and by tournament.</h2>
            <p className="sx-p">Every report reads the same way: the rate, how it was earned, and how it changed from one tournament to the next.</p>
            <div className="sx-reports-grid">
              <figure>
                <div className="sx-frame">
                  <Shot name="qab-player-report" w={1500} h={1435} mw={780} mh={1972} alt="An individual player QAB report: season rate, QAB percentage by tournament, and how quality at-bats were earned" />
                </div>
                <figcaption><b>Player reports</b>One player&rsquo;s rate, tournament by tournament, and the reasons behind it.</figcaption>
              </figure>
              <figure>
                <div className="sx-frame">
                  <Shot name="qab-tournament-compare" w={1500} h={730} mw={780} mh={1105} alt="Team QAB percentage with a bar for each tournament, compared with the season rate" />
                </div>
                <figcaption><b>Tournament comparison</b>Put each tournament next to the season rate and see where the team&rsquo;s at-bats are trending.</figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="sx-section sx-alt" aria-labelledby="run-h">
          <div className="sx-wrap sx-stack">
            <div className="sx-split">
              <div>
                <h2 className="sx-h2" id="run-h">Every tournament, in order.</h2>
                <p className="sx-p">
                  Dates, registration, payment and results for the whole season, with what still needs you right at the top.
                </p>
                <ul className="sx-ticks">
                  <li><b>Plan.</b> Weigh the tournaments you are considering against the ones you have committed to.</li>
                  <li><b>Know what is left.</b> See which are not registered yet before it matters.</li>
                </ul>
              </div>
              <div className="sx-frame">
                <Shot name="tournaments-overview" w={1600} h={712} mw={780} mh={1054} alt="Season Tempo Tournaments: the season timeline, committed tournaments, costs and record" />
              </div>
            </div>

            <div className="sx-split sx-split-flip">
              <div>
                <h2 className="sx-h2">The money, without the spreadsheet.</h2>
                <p className="sx-p">
                  Your budget, what is paid, what is still to pay and who owes dues, all counted as you commit.
                </p>
                <ul className="sx-ticks">
                  <li><b>Available budget.</b> What you can still plan with, not only what has been paid.</li>
                  <li><b>Player dues.</b> Who has paid, who has not, and how much is outstanding.</li>
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
