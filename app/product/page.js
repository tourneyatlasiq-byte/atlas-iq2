import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { MarketingHeader, MarketingFooter, Shot } from "../../components/MarketingChrome";
import DiscSeams from "../../components/DiscSeams";
import { SUPPORT_EMAIL } from "../../lib/legal";
import { QAB_REASONS } from "../../lib/qab-rules";
import "../site.css";

export const metadata = {
  title: "Product",
  description:
    "See how Season Tempo keeps tournaments, money, roster and quality at-bats for a travel softball season in one place.",
};

export const dynamic = "force-dynamic";

const QAB_REQUEST = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Quality at-bat tracking request")}`;

export default async function ProductPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = Boolean(user);
  const appHref = "/dashboard";

  return (
    <div className="sx">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      <main>
        <section className="sx-page-hero" aria-labelledby="h1">
          <div className="sx-wrap">
            <h1 className="sx-h1" id="h1">
              Run the season<span className="sx-dot" aria-hidden="true" /><span className="sr-only">.</span> Track every <span className="sx-nb">at-bat</span><span className="sx-dot" aria-hidden="true" /><span className="sr-only">.</span>
            </h1>
            <p className="sx-lede">
              Season Tempo follows a travel softball season the way you run it: the tournaments you
              are weighing, what they cost, who has paid, and how the team is hitting.
            </p>
            <nav className="sx-anchors" aria-label="On this page">
              <a href="#home">Home</a>
              <a href="#tournaments">Tournaments</a>
              <a href="#qab">Quality at-bats</a>
              <a href="#money">Money</a>
              <a href="#season">The season</a>
              <a href="#faq">Questions</a>
            </nav>
          </div>
        </section>

        <section className="sx-section sx-anchor" id="home" aria-labelledby="home-h">
          <div className="sx-wrap sx-split">
            <div>
              <h2 className="sx-h2" id="home-h">Open it Monday morning and see where the season stands.</h2>
              <p className="sx-p">
                Your next tournament, how many days away it is and where it is. Underneath, the
                things that need you: players who still owe dues, a tournament you committed to but
                have not registered for. Each one links to the screen where you fix it.
              </p>
            </div>
            <div className="sx-frame">
              <img src="/marketing/hero-next.webp" width="1300" height="1079" loading="lazy"
                alt="Season Tempo Home: the next tournament and its games" />
            </div>
          </div>
        </section>

        <section className="sx-section sx-alt sx-anchor" id="tournaments" aria-labelledby="t-h">
          <div className="sx-wrap sx-split sx-split-flip">
            <div>
              <h2 className="sx-h2" id="t-h">Every tournament, in order.</h2>
              <p className="sx-p">
                Dates, facility, registration, payment and results in one row per tournament. Update
                registration as you go, and keep the tournament director&rsquo;s number one tap away.
              </p>
              <ul className="sx-ticks">
                <li><b>Considering or committed.</b> Costs count the moment you commit.</li>
                <li><b>Registration and payment.</b> Plain labels, so no one has to decode a color.</li>
              </ul>
            </div>
            <div className="sx-frame">
              <Shot name="tournaments-overview" w={1600} h={712} mw={780} mh={1054} alt="Season Tempo Tournaments: the season timeline, committed tournaments, costs and record" />
            </div>
          </div>
        </section>

        <section className="sx-dark sx-qab sx-anchor" id="qab" aria-labelledby="qab-h">
          <div className="sx-wrap sx-qab-grid">
            <div>
              <h2 className="sx-h2" id="qab-h">Quality at-bats, from the dugout to the report.</h2>
              <p className="sx-p">
                Choose one primary reason for each quality at-bat. Each plate appearance counts once.
              </p>
              <ul className="sx-reasons" aria-label="The nine reasons you can choose">
                {QAB_REASONS.map((r) => (
                  <li key={r.key}>{r.label}</li>
                ))}
              </ul>
              <ul className="sx-ticks">
                <li><b>Track.</b> Set the batting order, then record each at-bat from your phone.</li>
                <li><b>Review.</b> Fix an at-bat afterwards if you tapped the wrong reason.</li>
                <li><b>Report.</b> Player, tournament and team reports, ready to print or save as a PDF.</li>
              </ul>
              <p className="sx-avail"><i aria-hidden="true" />Available on request during early access.</p>
              <div className="sx-acts">
                <a href={QAB_REQUEST} className="sx-btn sx-btn-volt">Ask for quality at-bat tracking</a>
              </div>
            </div>
            <div className="sx-qab-stage">
              <div className="sx-qab-disc" aria-hidden="true"><DiscSeams /></div>
              <div className="sx-phone">
                <img src="/marketing/qab-tracker-phone.webp" width="1170" height="2330" loading="lazy"
                  alt="The Season Tempo phone tracker: now batting, with the nine quality at-bat reasons" />
              </div>
            </div>
          </div>
          <div className="sx-wrap">
            <div className="sx-reports-grid">
              <figure>
                <div className="sx-frame"><Shot name="qab-player-report" w={1500} h={1435} mw={780} mh={1972} alt="An individual player QAB report" /></div>
                <figcaption><b style={{ color: "#fff" }}>Player report</b><span style={{ color: "rgba(255,255,255,.74)" }}>Rate by tournament and how each quality at-bat was earned.</span></figcaption>
              </figure>
              <figure>
                <div className="sx-frame"><Shot name="qab-tournament-compare" w={1500} h={730} mw={780} mh={1105} alt="Team QAB percentage by tournament compared with the season rate" /></div>
                <figcaption><b style={{ color: "#fff" }}>Tournament comparison</b><span style={{ color: "rgba(255,255,255,.74)" }}>Each tournament next to the season rate.</span></figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section className="sx-section sx-anchor" id="money" aria-labelledby="m-h">
          <div className="sx-wrap sx-split">
            <div>
              <h2 className="sx-h2" id="m-h">What your budget has gone on, not just what you have paid.</h2>
              <p className="sx-p">
                Each budget line shows what you set aside, what is paid, what is still to pay and
                what is genuinely left. Commit to a tournament and it counts straight away, paid or not.
              </p>
              <ul className="sx-ticks">
                <li><b>Player dues.</b> Who has paid, who has not, and how much is outstanding.</li>
                <li><b>Parent budget report.</b> A printable summary of the season budget.</li>
              </ul>
            </div>
            <div className="sx-frame">
              <Shot name="finance-summary" w={1500} h={536} mw={780} mh={693} alt="Season Tempo Finance: available budget, paid, to pay, and outstanding player dues" />
            </div>
          </div>
        </section>

        <section className="sx-section sx-alt sx-anchor" id="season" aria-labelledby="s-h">
          <div className="sx-wrap">
            <h2 className="sx-h2" id="s-h">A season, start to finish.</h2>
            <ol className="sx-strip">
              <li><b>Plan</b><span>Add events you are considering. Compare cost, dates and travel.</span></li>
              <li><b>Commit</b><span>Decide what you are playing. Costs start counting straight away.</span></li>
              <li><b>Play</b><span>Record pool play and bracket results as the tournament happens.</span></li>
              <li><b>Track</b><span>Watch the budget, dues and quality at-bats as the season builds.</span></li>
              <li><b>Learn</b><span>Note what the facility was like and whether you would go back.</span></li>
              <li><b>Next season</b><span>Carry your roster forward. Prior seasons stay for reference.</span></li>
            </ol>
            <div className="sx-also">
              <div className="sx-card"><h3 className="sx-h3">Facilities</h3><p>A shared directory of facilities, plus your own notes on parking, gates and concessions for next time.</p></div>
              <div className="sx-card"><h3 className="sx-h3">Games</h3><p>Schedule and results inside each tournament. Enter the score and Season Tempo works out the record.</p></div>
              <div className="sx-card"><h3 className="sx-h3">Files</h3><p>Player documents, waivers, insurance and schedules, attached to the player or tournament they belong to.</p></div>
            </div>
          </div>
        </section>

        <section className="sx-section sx-anchor" id="faq" aria-labelledby="faq-h">
          <div className="sx-wrap">
            <h2 className="sx-h2" id="faq-h">Questions coaches ask.</h2>
            <div className="sx-faq">
              <details>
                <summary>What does it cost?</summary>
                <p>Season Tempo is free during early access. We will give you advance notice before that changes.</p>
              </details>
              <details>
                <summary>How do I get quality at-bat tracking?</summary>
                <p>It is available on request during early access. <a href={QAB_REQUEST}>Email us</a> and we will set it up for your organization.</p>
              </details>
              <details>
                <summary>Does it work on a phone?</summary>
                <p>Yes. Season Tempo runs in your phone&rsquo;s browser, and the quality at-bat tracker is built for use at the field.</p>
              </details>
              <details>
                <summary>Can I print reports?</summary>
                <p>Yes. The season budget, tournament schedule and quality at-bat reports can be printed or saved as a PDF.</p>
              </details>
              <details>
                <summary>Who can see our information?</summary>
                <p>People in your organization, according to their role. One deliberate exception: ballpark and facility records are shared so no one re-enters the same venue, while your own notes about a facility stay private. We do not sell your information. The <Link href="/privacy">Privacy Policy</Link> has the details.</p>
              </details>
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
