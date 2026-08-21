import Link from "next/link";
import "./home.css";
import { getViewer } from "../lib/context";
import { MarketingHeader, MarketingFooter } from "../components/MarketingChrome";
import { ProductStory } from "../components/ProductStory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Season Tempo — Run a travel softball season in one place",
  description:
    "From the first entry fee to the last at-bat. Tournaments, facilities, Finance, games and performance for travel softball teams and organizations.",
};

/**
 * Public homepage.
 *
 * THE PRODUCT IS THE VISUAL LANGUAGE. Every image is a real Season Tempo
 * screen captured from production and privacy-checked: no mockups, no
 * illustrations, no stock photography, nothing decorative added to fill space.
 *
 * V2 replaces a four-beat vertical timeline with one bounded, interactive
 * product story. The argument is unchanged — the parts of a season carry
 * into each other — but the visitor drives it in place instead of
 * scrolling through four full-height sections.
 *
 * Every claim was audited against the application. QAB reasons are COUNTED and
 * shown; they are never related to runs scored, because the product does not
 * derive that.
 */
export default async function HomePage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="mk">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      {/* 1 — Hero */}
      <section className="mk-hero">
        <div className="mk-wrap">
          <h1>From the first entry fee to the last at-bat.</h1>
          <p className="mk-lede">
            Run your travel softball season in one place — tournaments, facilities,
            Finance, games and performance, with each part carrying into the next.
          </p>

          <div className="mk-cta">
            {signedIn ? (
              <Link href={appHref} className="btn btn-primary mk-btn-lg">Go to Season Tempo</Link>
            ) : (
              <>
                <Link href="/login?new=1" className="btn btn-primary mk-btn-lg">Try Season Tempo</Link>
                <Link href="/login" className="btn btn-secondary mk-btn-lg">Sign in</Link>
              </>
            )}
          </div>

          <p className="mk-note">Free during early access.</p>
        </div>
      </section>

      {/* 2 — The product story, in one bounded frame. */}
      <section className="mk-story-section">
        <div className="mk-wrap">
          <ProductStory />
        </div>
      </section>

      {/* 3 — The problem. An editorial interruption, not a full screen. */}
      <section className="mk-section mk-white mk-problem">
        <div className="mk-wrap mk-narrow">
          <h2>You&rsquo;re already tracking all of this. Just not in one place.</h2>
          <p>
            Entry fees in a spreadsheet. Who&rsquo;s paid in your texts. The field map in a
            screenshot you&rsquo;ll never find again. Waivers in a folder somewhere. Last
            year&rsquo;s schedule in an email.
          </p>
          <p>
            It works, right up until someone asks what the season actually cost — or which
            three players still owe you.
          </p>
          <p className="mk-emphasis">
            Season Tempo keeps it together, so the answer takes five seconds instead of an evening.
          </p>
        </div>
      </section>

      {/* 4 — The one dark section, spent on the one capability nothing
             else in this category has. */}
      <section className="mk-qab">
        <div className="mk-wrap">
          <div className="mk-qab-grid">
            <div className="mk-qab-copy">
              <h2>
                Quality at-bats, tracked as they happen.
                <span className="mk-premium">Premium</span>
              </h2>
              <p>
                Not just hits. The eight-pitch battle. The sacrifice that moved the runner. The
                walk that started the inning — recorded live, by the coach who saw it.
              </p>
              <p>
                Then see what&rsquo;s earning them, from walks and sacrifices to long at-bats,
                game by game and player by player.
              </p>
            </div>

            <div className="mk-qab-shots">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-qab-phone.webp" className="mk-qab-phone" loading="lazy" decoding="async"
                   alt="Recording what made a plate appearance a quality at-bat" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-qab-reasons.webp" className="mk-qab-reasons" loading="lazy" decoding="async"
                   alt="Reasons cited across the season: walks, hits, situation success, sacrifices and long at-bats" />
            </div>
          </div>
        </div>
      </section>

      {/* 5 — The scanner's section. */}
      <section className="mk-section" id="product">
        <div className="mk-wrap">
          <h2 className="mk-h2-lead">Everything a season runs on</h2>
          <div className="mk-areas">
            <Area name="Tournaments">Dates, facility, fees, registration, roster and results.</Area>
            <Area name="Team">Roster, uniforms, contacts and paperwork, season to season.</Area>
            <Area name="Finance">Dues, budget, and what you&rsquo;ve committed to.</Area>
            <Area name="Facilities">Where you&rsquo;ve played, and what you learned there.</Area>
            <Area name="Games">Lineups, scores and results, tied to their tournament.</Area>
            <Area name="Files">Waivers, insurance and rosters, where you&rsquo;ll find them.</Area>
          </div>
          <p className="mk-more">
            <Link href="/product">See everything Season Tempo does &rarr;</Link>
          </p>
        </div>
      </section>

      {/* 6 — What leaves the product. */}
      <section className="mk-section mk-white">
        <div className="mk-wrap">
          <div className="mk-report-grid">
            <div className="mk-report-copy">
              <h2>Turn the season into something you can actually share.</h2>
              <p>
                A season budget families can read. A tournament schedule for the fridge.
                Performance a player can look at with her coach.
              </p>
              <p>
                Built from what&rsquo;s already in Season Tempo — nothing to assemble.
              </p>
            </div>
            <div className="mk-report-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-report.webp" className="mk-report-image mk-only-desk" loading="lazy" decoding="async"
                   alt="Planned Season Budget report showing the season budget, where the money goes, and player dues" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-report-mobile.webp" className="mk-report-image mk-only-mob" loading="lazy" decoding="async"
                   alt="Planned Season Budget report showing the season budget and where the money goes" />
            </div>
          </div>
        </div>
      </section>

      {/* 7 — Early access, stated plainly. */}
      <section className="mk-access">
        <div className="mk-wrap mk-narrow">
          <p>
            Season Tempo is in early access — a deliberately small group of teams and
            organizations, so real feedback still shapes what gets built. Free during this
            period, with advance notice before that changes.
          </p>
        </div>
      </section>

      {/* 8 — Close. */}
      <section className="mk-final">
        <div className="mk-wrap">
          <h2>Ready to run your season?</h2>
          <Link href={signedIn ? appHref : "/login?new=1"} className="btn btn-primary mk-btn-lg">
            {signedIn ? "Go to Season Tempo" : "Try Season Tempo"}
          </Link>
          <p className="mk-note">Free during early access.</p>
        </div>
      </section>

      <MarketingFooter signedIn={signedIn} />

    </div>
  );
}

/** One area of the product, in the editorial contents list. */
function Area({ name, children }) {
  return (
    <div className="mk-area">
      <p className="mk-area-name">{name}</p>
      <p className="mk-area-body">{children}</p>
    </div>
  );
}
