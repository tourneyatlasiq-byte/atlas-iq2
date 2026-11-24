import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { MarketingHeader, MarketingFooter } from "../../components/MarketingChrome";
import { PRODUCT, SUPPORT_EMAIL, PRIVACY_EMAIL } from "../../lib/legal";
import "../site.css";

export const metadata = {
  title: "About",
  description:
    "Why Season Tempo exists, who it is built for, and how it handles your information.",
};

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <div className="sx">
      <MarketingHeader signedIn={signedIn} appHref="/dashboard" />

      <main>
        <section className="sx-page-hero" aria-labelledby="h1">
          <div className="sx-wrap">
            <h1 className="sx-h1" id="h1">Why Season Tempo exists<span className="sx-dot" aria-hidden="true" /></h1>
            <p className="sx-lede">
              Season Tempo was built to give a travel softball team one place for the whole season. It brings the tournament schedule, roster, dues, facilities, paperwork and performance together, so coaches and managers spend less time keeping them in step and more time with the team.
            </p>
          </div>
        </section>

        <section className="sx-section sx-alt">
          <div className="sx-wrap sx-prose">
            <h2>Built around how the season runs</h2>
            <p>
              The season has a shape: events you are weighing, the ones you commit to, the
              tournaments you play, the money that follows, the at-bats that build the team, and
              what you carry into next year. {PRODUCT} follows that shape, so committing to a
              tournament moves the budget before an invoice arrives, and a facility you liked is
              still there next season.
            </p>

            <h2>Who it is for</h2>
            <p>
              Coaches, team managers and club or organization directors running competitive travel
              softball: the people holding the tournament schedule, the roster, the dues and the
              paperwork at the same time.
            </p>

            <h2>Early access</h2>
            <p>
              {PRODUCT} is in early access and free during this period. We will give you advance
              notice before that changes. Early access is deliberately small, so real coach and team
              feedback shapes what gets built next. Quality at-bat tracking is available on request.
            </p>

            <h2>How your information is handled</h2>
            <p>
              Your organization&rsquo;s information is yours. We do not sell it, we do not run
              advertising, and we do not use it to build a profile of you. Each organization&rsquo;s
              data is separated at the database level, so one organization cannot see another&rsquo;s. The one deliberate exception is shared facility records, which hold a venue&rsquo;s name, address and amenities but never your notes.
            </p>
            <p>
              {PRODUCT} is not designed to store highly sensitive information such as Social
              Security numbers or government identification. The <Link href="/privacy">Privacy Policy</Link>{" "}
              sets out what we collect, the small number of companies that process data on our
              behalf, and how to have your information removed.
            </p>

            <h2>Contact</h2>
            <p>
              Questions or help: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              <br />
              Privacy and data requests: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
            </p>
          </div>
        </section>

        {signedIn ? (
          <section className="sx-section">
            <div className="sx-wrap">
              <Link href="/dashboard" className="sx-btn sx-btn-volt">Back to Season Tempo</Link>
            </div>
          </section>
        ) : (
          <section className="sx-dark sx-final" aria-labelledby="final-h">
            <div className="sx-wrap">
              <h2 className="sx-h2" id="final-h">From the first entry fee to the last at-bat.</h2>
              <div className="sx-acts">
                <Link href="/login?new=1" className="sx-btn sx-btn-volt">Get started</Link>
              </div>
            </div>
          </section>
        )}
      </main>

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
