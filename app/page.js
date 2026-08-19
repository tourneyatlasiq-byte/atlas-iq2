import Link from "next/link";
import "./home.css";
import { getViewer } from "../lib/context";
import { LogoLockup } from "../components/SeasonTempoLogo";
import { SUPPORT_EMAIL } from "../lib/legal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Season Tempo \u2014 Run a travel softball season in one place",
  description:
    "From the first entry fee to the last at-bat. Tournaments, facilities, Finance, games and performance for travel softball teams and organizations.",
};

/**
 * Public homepage.
 *
 * THE PRODUCT IS THE VISUAL LANGUAGE. Every image is a real Season Tempo
 * screen captured from production and privacy-checked \u2014 no mockups, no
 * illustrations, no stock photography, nothing decorative added to fill space.
 *
 * The page argues one thing: the parts of a season are connected. It argues it
 * by walking through a season rather than drawing a diagram, because that is
 * how a coach experiences it \u2014 commit in August, play on Saturday, know
 * where you stand on Monday, find it still there next season.
 *
 * Every claim was audited against the application before being written. In
 * particular QAB reasons are COUNTED and shown; they are never related to runs
 * scored, because the product does not derive that.
 *
 * Renders for everyone: getViewer() deliberately does not redirect, so a
 * signed-in visitor keeps the marketing page and gets "Go to Season Tempo".
 */
export default async function HomePage() {
  const { user, hasOrganization } = await getViewer();
  const signedIn = Boolean(user);
  const appHref = hasOrganization ? "/dashboard" : "/welcome";

  return (
    <div className="mk">
      <header className="mk-header">
        <div className="mk-wrap mk-header-inner">
          <Link href="/" className="mk-logo" aria-label="Season Tempo home">
            <LogoLockup size={34} tone="navy" wordSize={26} />
          </Link>

          <nav className="mk-nav">
            <Link href="/product">Product</Link>
            <Link href="/about">About</Link>
          </nav>

          <div className="mk-header-actions">
            {signedIn ? (
              <Link href={appHref} className="btn btn-primary">Open Season Tempo</Link>
            ) : (
              <>
                <Link href="/login" className="mk-signin">Sign in</Link>
                <Link href="/login?new=1" className="btn btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 1 \u2014 Hero */}
      <section className="mk-hero">
        <div className="mk-wrap">
          <h1>From the first entry fee to the last at-bat.</h1>
          <p className="mk-lede">
            One place for your travel softball season \u2014 from tournaments and facilities to
            Finance, games and performance, with everything carrying forward as the season
            unfolds.
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

      {/* 2 \u2014 The product, immediately. Art-directed per breakpoint rather
             than one desktop capture scaled down until it cannot be read. */}
      <section className="mk-shot">
        <div className="mk-wrap">
          <div className="mk-shot-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mk-dashboard.webp" className="mk-shot-image mk-only-desk"
                 alt="Season Tempo home: the next tournament, what needs action, and where the season stands" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mk-dashboard-mobile.webp" className="mk-shot-image mk-only-mob"
                 alt="Season Tempo home: the next tournament and what is coming up" />
          </div>
        </div>
      </section>

      {/* 3 \u2014 The problem. The strongest writing on the previous site, kept. */}
      <section className="mk-section mk-white">
        <div className="mk-wrap mk-narrow">
          <h2>You&rsquo;re already tracking all of this. Just not in one place.</h2>
          <p>
            Entry fees in a spreadsheet. Who&rsquo;s paid in your texts. The field map in a
            screenshot you&rsquo;ll never find again. Waivers in a folder somewhere. Last
            year&rsquo;s schedule in an email.
          </p>
          <p>
            It works, right up until someone asks what the season actually cost \u2014 or which
            three players still owe you.
          </p>
          <p className="mk-emphasis">
            Season Tempo keeps it together, so the answer takes five seconds instead of an evening.
          </p>
        </div>
      </section>

      {/* 4 \u2014 The season. Four compact beats: the headlines alone carry the
             argument for a scanner, and the product imagery does the explaining. */}
      <section className="mk-section mk-white mk-story">
        <div className="mk-wrap">
          <ol className="mk-beats">
            <Beat label="August" title="You commit to a tournament."
              image="/mk-tournaments.webp" mobileImage="/mk-tournaments-mobile.webp"
              alt="A season of committed tournaments with dates, providers and facilities"
              inset="/mk-tournament-drawer.webp"
              insetAlt="Tournament detail showing games, roster and costs">
              The entry fee lands in your budget the moment you commit. The facility comes with
              the notes you left the last time you played there.
            </Beat>

            <Beat label="Saturday" title="You play." phone flip
              image="/mk-qab-phone.webp"
              alt="Recording a quality at-bat during a game on a phone">
              Set the lineup. Track the at-bats as they happen. On your phone, in the dugout,
              between innings.
            </Beat>

            <Beat label="Monday" title="You know where you stand."
              image="/mk-finance.webp" mobileImage="/mk-finance-mobile.webp"
              alt="Season budget showing paid, still to pay and available"
              inset="/mk-qab-reasons.webp"
              insetAlt="Reasons cited across the season&rsquo;s quality at-bats">
              What the weekend cost, and how the team actually hit. What you enter in August
              still means something in June.
            </Beat>

            <Beat label="Next season" title="It&rsquo;s still there." flip wide
              image="/mk-performance-season.webp"
              alt="Season performance showing quality at-bat percentage, games and players">
              Your roster carries forward. So do your facility notes, your tournament history
              and last year&rsquo;s numbers.
            </Beat>
          </ol>
        </div>
      </section>

      {/* 5 \u2014 Breadth, as an editorial contents list rather than six equal
             boxes. This is the scan layer. */}
      <section className="mk-section" id="product">
        <div className="mk-wrap">
          <h2 className="mk-h2-lead">Everything a season runs on</h2>
          <div className="mk-areas">
            <Area name="Tournaments">
              Dates, facility, fees, registration, roster and results for every weekend.
            </Area>
            <Area name="Team">
              Roster, uniforms, contacts and paperwork, carried season to season.
            </Area>
            <Area name="Finance">
              Dues, budget, and what you&rsquo;ve committed to \u2014 not just what has been paid.
            </Area>
            <Area name="Facilities">
              Where you&rsquo;ve played, what you learned there, ready the next time.
            </Area>
            <Area name="Games">
              Lineups, scores and results, attached to the tournament they belong to.
            </Area>
            <Area name="Files">
              Waivers, insurance and rosters, where you&rsquo;ll actually find them.
            </Area>
          </div>
          <p className="mk-more">
            <Link href="/product">See everything Season Tempo does &rarr;</Link>
          </p>
        </div>
      </section>

      {/* 6 \u2014 The page's one moment of contrast, spent on the one capability
             nothing else in this category has. */}
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
                walk that started the inning \u2014 recorded live, by the coach who saw it.
              </p>
              <p>
                Then see what&rsquo;s earning them, from walks and sacrifices to long at-bats,
                game by game and player by player.
              </p>
            </div>

            <div className="mk-qab-shots">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-qab-phone.webp" className="mk-qab-phone"
                   alt="Recording what made a plate appearance a quality at-bat" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-qab-reasons.webp" className="mk-qab-reasons"
                   alt="Reasons cited across the season: walks, hits, situation success, sacrifices and long at-bats" />
            </div>
          </div>
        </div>
      </section>

      {/* 7 \u2014 What leaves the product. */}
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
                Built from what&rsquo;s already in Season Tempo \u2014 nothing to assemble,
                nothing to keep in step by hand.
              </p>
            </div>
            <div className="mk-report-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-report.webp" className="mk-report-image mk-only-desk"
                   alt="Planned Season Budget report showing the season budget, where the money goes, and player dues" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mk-report-mobile.webp" className="mk-report-image mk-only-mob"
                   alt="Planned Season Budget report showing the season budget and where the money goes" />
            </div>
          </div>
        </div>
      </section>

      {/* 8 \u2014 Early access, stated plainly. */}
      <section className="mk-section mk-access">
        <div className="mk-wrap mk-narrow">
          <p>
            Season Tempo is in early access \u2014 a deliberately small group of teams and
            organizations, so real feedback still shapes what gets built. Free during this
            period, with advance notice before that changes.
          </p>
        </div>
      </section>

      {/* 9 \u2014 Close. */}
      <section className="mk-final">
        <div className="mk-wrap">
          <h2>Ready to run your season?</h2>
          <Link href={signedIn ? appHref : "/login?new=1"} className="btn btn-primary mk-btn-lg">
            {signedIn ? "Go to Season Tempo" : "Try Season Tempo"}
          </Link>
          <p className="mk-note">Free during early access.</p>
        </div>
      </section>

      {/* Columns rather than one strip. Every destination below is real —
          /product, /privacy and /terms are pages; #about is still a section on
          this page. No link exists to fill out the shape. */}
      <footer className="mk-footer">
        <div className="mk-wrap">
          <div className="mk-footer-grid">
            <div className="mk-footer-brand">
              <LogoLockup size={30} tone="navy" wordSize={20} />
              <p className="mk-footer-line">Run your season smarter.</p>
            </div>

            <nav className="mk-footer-col" aria-label="Product">
              <p className="mk-footer-heading">Product</p>
              <Link href="/product">Product</Link>
              <Link href="/about">About</Link>
              {!signedIn && <Link href="/login">Sign in</Link>}
            </nav>

            <nav className="mk-footer-col" aria-label="Company">
              <p className="mk-footer-heading">Company</p>
              <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
            </nav>
          </div>

          <div className="mk-footer-base">
            <span className="mk-copyright">
              © {new Date().getFullYear()} Season Tempo. All rights reserved.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** One beat of the season. Text and product screen, alternating sides. */
function Beat({
  label, title, children, image, mobileImage, alt,
  inset, insetAlt, flip = false, phone = false, wide = false,
}) {
  return (
    <li className={`mk-beat${flip ? " flip" : ""}${phone ? " phone" : ""}${wide ? " wide" : ""}`}>
      <div className="mk-beat-copy">
        <p className="mk-beat-label">{label}</p>
        <h3 className="mk-beat-title" dangerouslySetInnerHTML={{ __html: title }} />
        <p className="mk-beat-body">{children}</p>
      </div>

      <div className="mk-beat-visual">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={alt} className={mobileImage ? "mk-only-desk" : ""} />
        {mobileImage && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={mobileImage} alt={alt} className="mk-only-mob" />
        )}
        {inset && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={inset} alt={insetAlt} className="mk-beat-inset" />
        )}
      </div>
    </li>
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
