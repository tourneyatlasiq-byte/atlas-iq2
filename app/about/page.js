import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { MarketingHeader, MarketingFooter, PhotoSlot } from "../../components/MarketingChrome";
import { PRODUCT, SUPPORT_EMAIL, PRIVACY_EMAIL } from "../../lib/legal";
import "../home.css";

export const metadata = {
  title: "About — Season Tempo",
  description:
    "Why Season Tempo exists, who it is built for, and how it handles your information.",
};

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = Boolean(user);

  return (
    <div className="mk">
      <MarketingHeader signedIn={signedIn} appHref="/dashboard" />

      {/* 1 — Why it exists, beside the photograph */}
      <section className="mk-page-hero">
        <div className="mk-wrap">
          <div className="mk-workflow">
            <div className="mk-workflow-text">
              <h1>Why Season Tempo exists.</h1>
              <p className="mk-lede">
                A travel softball season is run out of a spreadsheet, a group text and a folder
                of screenshots. Not because anyone wants it that way &mdash; because no single
                tool covers tournaments, roster, dues, facilities and paperwork at once.
              </p>
              <p>
                Season Tempo was built to be that one place, by working through an actual
                season rather than designing from a feature list.
              </p>

              {/* FOUNDER PARAGRAPH — intentionally left for you to supply.
                  Nothing personal is invented here. */}
            </div>

            <PhotoSlot
              src="/travel-softball-huddle.webp"
              alt="A travel softball team huddled together before taking the field"
              ratio="3 / 4"
            />
          </div>
        </div>
      </section>

      {/* 2 — Built around how the season actually runs */}
      <section className="mk-section mk-alt">
        <div className="mk-wrap mk-narrow">
          <h2>Built around how travel softball actually operates</h2>
          <p>
            The season has a shape: events you&rsquo;re weighing up, the ones you commit to, the
            weekends you play, the money that follows, and what you carry into next year.
            Season Tempo follows that shape instead of splitting it across tools that
            don&rsquo;t know about each other.
          </p>
          <p>
            That&rsquo;s why committing to a tournament moves money in the budget before an
            invoice arrives, and why a facility you liked is still there next season.
          </p>
        </div>
      </section>

      {/* 3 & 4 — Who it's for, and what it deliberately is not */}
      <section className="mk-section">
        <div className="mk-wrap mk-narrow">
          <h2>Who it&rsquo;s for</h2>
          <p>
            Coaches, team managers and club or organization directors running competitive travel
            softball &mdash; the people holding the tournament schedule, the roster, the dues and
            the paperwork at the same time.
          </p>

          <h2 className="mk-h2-spaced">What it isn&rsquo;t</h2>
          <p>
            Not a league platform. Not a scoring or social app. Not an accounting package.
            Those tools exist and some of them are good at what they do. Season Tempo is the
            operating layer for the person running the season.
          </p>
        </div>
      </section>

      {/* 5, 6, 7, 8 — the trust block */}
      <section className="mk-section mk-alt">
        <div className="mk-wrap mk-narrow">
          <h2>Early access</h2>
          <p>
            {PRODUCT} is in early access and free during this period. We&rsquo;ll give you
            advance notice before that changes. Early access is deliberately small so that real
            coach and team feedback shapes what gets built next &mdash; features change, and
            some of them change because someone running a season said they should.
          </p>

          <h2 className="mk-h2-spaced">How your information is handled</h2>
          <p>
            Your organization&rsquo;s information is yours. We don&rsquo;t sell it, we
            don&rsquo;t run advertising, and we don&rsquo;t use it to build a profile of you.
            Each organization&rsquo;s data is separated at the database level, so one team
            cannot see another&rsquo;s.
          </p>
          <p>
            {PRODUCT} isn&rsquo;t designed to store highly sensitive information such as Social
            Security numbers or government identification. The{" "}
            <Link href="/privacy">Privacy Policy</Link> sets out what we collect, the small
            number of companies that process data on our behalf, and how to have your
            information removed.
          </p>

          <h2 className="mk-h2-spaced">Contact</h2>
          <p>
            Questions or help: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            <br />
            Privacy and data requests: <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
          </p>
        </div>
      </section>

      {signedIn ? (
        <section className="mk-section mk-return">
          <div className="mk-wrap mk-narrow mk-centered">
            <Link href="/dashboard" className="mk-return-link">
              Back to Season Tempo &rarr;
            </Link>
          </div>
        </section>
      ) : (
        <section className="mk-final">
          <div className="mk-wrap">
            <h2>Ready to run your season?</h2>
            <p>Set up your team in about two minutes. Add the rest whenever you&rsquo;re ready.</p>
            <Link href="/login?new=1" className="btn btn-primary mk-btn-lg">
              Try Season Tempo
            </Link>
          </div>
        </section>
      )}

      <MarketingFooter signedIn={signedIn} />
    </div>
  );
}
