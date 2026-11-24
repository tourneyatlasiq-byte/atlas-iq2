import Link from "next/link";
import "../site.css";
import { getViewer } from "../../lib/context";
import { SUPPORT_EMAIL } from "../../lib/legal";
import { MarketingHeader, MarketingFooter, Shot } from "../../components/MarketingChrome";
import DiscSeams from "../../components/DiscSeams";
import { QAB_REASONS } from "../../lib/qab-rules";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quality at-bats",
  description:
    "Track quality at-bats from your phone, then compare QAB rates by player and tournament. Available on request during early access.",
};

const QAB_REQUEST = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Quality at-bat tracking request")}`;

/**
 * The dedicated quality at-bats page. Home and Product carry short introductions
 * and link here; the tracker, the nine reasons, the reports and how to get access
 * live in one place. Renders for everyone; getViewer() deliberately does not redirect.
 */
export default async function QualityAtBatsPage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="sx">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      <main>
        <section className="sx-page-hero" aria-labelledby="h1">
          <div className="sx-wrap">
            <h1 className="sx-h1" id="h1">
              Quality at-bats, from the dugout to the report<span className="sx-dot" aria-hidden="true" /><span className="sr-only">.</span>
            </h1>
            <p className="sx-lede">
              Record each plate appearance from your phone, then see QAB rates and reasons by player, game and tournament.
            </p>
            <nav className="sx-anchors" aria-label="On this page">
              <a href="#tracker">Tracker</a>
              <a href="#reports">Reports</a>
              <a href="#access">Get access</a>
            </nav>
          </div>
        </section>

        <section className="sx-dark sx-qab sx-anchor" id="tracker" aria-labelledby="tracker-h">
          <div className="sx-wrap sx-qab-grid">
            <div>
              <h2 className="sx-h2" id="tracker-h">Track each at-bat from the dugout.</h2>
              <p className="sx-p">
                Record every plate appearance. For each quality at-bat, choose one primary reason. Each plate appearance counts once.
              </p>
              <ul className="sx-reasons" aria-label="The nine reasons you can choose">
                {QAB_REASONS.map((r) => (
                  <li key={r.key}>{r.label}</li>
                ))}
              </ul>
              <ul className="sx-ticks">
                <li><b>Track.</b> Set the batting order, then record each at-bat from your phone.</li>
                <li><b>Review.</b> Fix an at-bat afterwards if you tapped the wrong reason.</li>
              </ul>
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

        <section className="sx-reports sx-anchor" id="reports" aria-labelledby="rep-h">
          <div className="sx-wrap">
            <h2 className="sx-h2" id="rep-h">Player reports and tournament comparisons.</h2>
            <p className="sx-p">
              Compare QAB rates across tournaments and see how each player earned their quality at-bats.
              Print or save player, tournament and season reports as PDFs.
            </p>
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
          </div>
        </section>

        <section className="sx-section sx-alt sx-anchor" id="access" aria-labelledby="access-h">
          <div className="sx-wrap sx-split">
            <div>
              <h2 className="sx-h2" id="access-h">Get quality <span className="sx-nb">at-bat</span> tracking.</h2>
              <p className="sx-p">
                Email us and we will set it up for your organization.
              </p>
              <p className="sx-avail" style={{ color: "var(--ink)" }}><i aria-hidden="true" />Available on request during early access.</p>
              <div className="sx-acts">
                <a href={QAB_REQUEST} className="sx-btn sx-btn-volt">Request QAB access</a>
              </div>
            </div>
            <div style={{ display: "grid", gap: 16 }}>
              <div className="sx-card">
                <h3 className="sx-h3">On your phone</h3>
                <p>Season Tempo runs in your phone&rsquo;s browser, and the quality at-bat tracker is built for use at the field.</p>
              </div>
              <div className="sx-card">
                <h3 className="sx-h3">Ready to print</h3>
                <p>Quality at-bat reports can be printed or saved as a PDF.</p>
              </div>
            </div>
          </div>
        </section>

        {signedIn ? (
          <section className="sx-section">
            <div className="sx-wrap">
              <Link href={appHref} className="sx-btn sx-btn-volt">Back to Season Tempo</Link>
            </div>
          </section>
        ) : (
          <section className="sx-dark sx-final" aria-labelledby="final-h">
            <div className="sx-wrap">
              <h2 className="sx-h2" id="final-h">From the first entry fee to the last <span className="sx-nb">at-bat</span>.</h2>
              <div className="sx-acts">
                <Link href="/login?new=1" className="sx-btn sx-btn-volt">Get started</Link>
              </div>
              <p className="sx-note">Free during early access. We&rsquo;ll give you advance notice before that changes.</p>
            </div>
          </section>
        )}
      </main>

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
