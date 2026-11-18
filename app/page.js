import Link from "next/link";
import { Barlow_Condensed } from "next/font/google";
import "./marketing-home.css";
import { getViewer } from "../lib/context";
import { SUPPORT_EMAIL } from "../lib/legal";
import { SiteHeader } from "../components/marketing/SiteHeader";
import { Wordmark } from "../components/marketing/SeasonMark";
import { Shot } from "../components/marketing/Shot";
import { WeekendPlan } from "../components/marketing/WeekendPlan";
import { EXAMPLE_WEEKEND, SHOTS } from "../components/marketing/home-data";

// Self-hosted at build time, like Inter and Poppins in the root layout, so no
// visitor request goes to Google.
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display-condensed",
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Season Tempo | The whole season, in one place",
  description:
    "Keep your travel softball team’s tournaments, roster, dues, facilities and games together, with fewer spreadsheets and less searching through messages.",
};

const EARLY_ACCESS = "Free during early access. We’ll give you advance notice before that changes.";

/**
 * Public homepage (marketing-v5, alternative to v4: light, left-aligned,
 * Red Clay Classic shown "For the team manager" and "For families").
 *
 * The opening shows the finished work: one tournament weekend as families
 * receive it. The first section shows how the coach manages that same
 * tournament. The full season and the feature walkthrough live on /product.
 *
 * Renders for everyone. getViewer() deliberately does not redirect: a
 * signed-in visitor keeps the marketing page and gets "Open Season Tempo".
 * All styles are scoped under .st in marketing-home.css.
 */
export default async function HomePage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";
  const startHref = signedIn ? appHref : "/login?new=1";
  const startLabel = signedIn ? "Open Season Tempo" : "Get started";

  return (
    <div className={`st ${display.variable}`}>
      <a className="st-skip" href="#main">
        Skip to content
      </a>

      <SiteHeader signedIn={signedIn} appHref={appHref} />

      <main id="main" tabIndex={-1}>
        <section className="st-v5-open" aria-labelledby="st-h1">
          <div className="st-wrap">
            <div className="st-v5-head">
              <h1 className="st-v5-mega" id="st-h1">
                <span>The whole season,</span> <span>in one place.</span>
              </h1>
              <div className="st-v5-intro">
                <p className="st-v5-lede">
                  Keep your travel softball team&rsquo;s tournaments, roster, dues, facilities and games
                  together, with fewer spreadsheets and less searching through messages.
                </p>
                <div className="st-v5-intro-act">
                  <div className="st-v5-actions">
                    <Link className="st-btn st-btn-night st-btn-lg" href={startHref}>
                      {startLabel}
                    </Link>
                    <Link className="st-textlink st-v5-secondary" href="/product">
                      See the product
                    </Link>
                  </div>
                  {!signedIn && <p className="st-v5-note">{EARLY_ACCESS}</p>}
                </div>
              </div>
            </div>

            <figure className="st-pair">
              <h2 className="st-pair-h">One tournament. Two views.</h2>
              <p className="st-pair-label st-pair-label-m">For the team manager</p>
              <div className="st-pair-frame">
                <Shot shot={SHOTS.manageSummary} eager />
              </div>
              <p className="st-pair-label st-pair-label-f">For families</p>
              <div className="st-pair-plan">
                <WeekendPlan weekend={EXAMPLE_WEEKEND} />
              </div>
              <figcaption className="st-pair-cap">
                Red Clay Classic as the team manager sees it in Season Tempo, and as families get it in the
                printable Tournament Schedule. Team, places and opponents are fictional.
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="st-v5-money" id="how" aria-labelledby="st-money-h">
          <div className="st-wrap">
            <div className="st-v5-row">
              <h2 className="st-v5-display" id="st-money-h">
                <span>Know what&rsquo;s paid.</span> <span>Know what&rsquo;s still owed.</span>
              </h2>
              <div className="st-v5-row-text">
                <p>
                  See what&rsquo;s paid, still to pay and available against the season budget, and how much of
                  player dues has come in.
                </p>
                <Link className="st-textlink" href="/product">
                  See how Finance works
                </Link>
              </div>
            </div>
            <div className="st-v5-stage">
              <div className="st-dt">
                <Shot shot={SHOTS.moneySummary} />
              </div>
              <div className="st-ph">
                <Shot shot={SHOTS.mMoneySummary} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="st-footer">
        <div className="st-wrap">
          <div className="st-foot-grid">
            <div className="st-foot-brand">
              <Link className="st-logo st-logo-ink" href="/" aria-label="Season Tempo home">
                <Wordmark tone="ink" />
              </Link>
              <p className="st-foot-line">The whole season, in one place.</p>
            </div>
            <nav className="st-foot-col" aria-labelledby="st-f1">
              <h2 id="st-f1">Product</h2>
              <Link href="/#how">How it works</Link>
              <Link href="/product">Product</Link>
              {!signedIn && <Link href="/login">Sign in</Link>}
            </nav>
            <nav className="st-foot-col" aria-labelledby="st-f2">
              <h2 id="st-f2">Company</h2>
              <Link href="/about">About</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
            </nav>
          </div>
          <div className="st-foot-base">
            &copy; {new Date().getFullYear()} Season Tempo. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
