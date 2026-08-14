import Link from "next/link";
import "./home.css";
import { getViewer } from "../lib/context";
import { LogoLockup } from "../components/SeasonTempoLogo";
import { SUPPORT_EMAIL } from "../lib/legal";
import { PhotoSlot } from "../components/MarketingChrome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Season Tempo — Run your team from one place",
  description:
    "Tournaments, roster, money, facilities and games for travel softball teams, without the spreadsheets and group texts.",
};

/**
 * Public homepage.
 *
 * Renders for everyone, signed in or not — getViewer() deliberately does not
 * redirect. A signed-in visitor keeps the marketing page and gets "Go to
 * Atlas" instead of Sign in, so the site stays reachable while you're working
 * on it.
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

      <section className="mk-hero">
        <div className="mk-wrap">
          <h1>Run your team from one place.</h1>
          <p className="mk-lede">
            Everything a travel softball team runs on — tournaments, roster, dues, facilities
            and games — without the spreadsheets, group texts and screenshots you&rsquo;re
            using now.
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

          <p className="mk-note">Free during early access. We&rsquo;ll give you advance notice before that changes.</p>
        </div>
      </section>

      {/* The real product, not a drawing of it. Verified before publishing:
          no player names, emails, phone numbers, test records or "Demo"
          naming appear in this capture. */}
      <section className="mk-shot">
        <div className="mk-wrap">
          <div className="mk-shot-frame">
            <img
              src="/home-dashboard.png"
              alt="Season Tempo Home — the next tournament, what needs attention, and where the season stands"
              className="mk-shot-image"
            />
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap mk-narrow">
          <h2>You&rsquo;re already tracking all of this. Just not in one place.</h2>
          <p>
            Entry fees in a spreadsheet. Who&rsquo;s paid in your texts. The field map in a
            screenshot you&rsquo;ll never find again. Waivers in a folder somewhere. Last year&rsquo;s schedule in an email.
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

      <section className="mk-section mk-alt" id="product">
        <div className="mk-wrap">
          <h2 className="mk-centered">Where a season actually gets run</h2>
          <div className="mk-grid mk-grid-3">
            <Capability title="Tournaments">
              Everything about a weekend in one place — dates, facility, entry and gate fees,
              registration status, the tournament director, your tournament roster and results.
            </Capability>
            <Capability title="Team">
              Your roster, uniforms, contacts and paperwork, carried forward season to season.
            </Capability>
            <Capability title="Finance">
              Dues, budget and what you&rsquo;ve committed to — not just what has been paid.
            </Capability>
          </div>

          <p className="mk-more">
            <Link href="/product">See everything Season Tempo does &rarr;</Link>
          </p>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap">
          <div className="mk-who" id="about">
            <div>
              <span className="mk-eyebrow">Built for travel softball</span>
              <h2>For the person holding all of it.</h2>
              <p>
                Coaches, team managers and club directors handling the roster, the tournament
                schedule, dues, facilities and paperwork all at once &mdash; usually while
                standing at a field.
              </p>
              <p>
                Season Tempo is built around that reality: entry fees, facility details that are
                hard to find, payments scattered across messages, and a schedule that keeps
                changing.
              </p>
              <p className="mk-emphasis">
                It isn&rsquo;t a league platform or an accounting package. It&rsquo;s for the
                person actually running the season.
              </p>
            </div>

            {/* The human side of the season, beside software that proves itself
                elsewhere on the page. */}
            <PhotoSlot
              src="/travel-softball-coach.webp"
              alt="A coach talking with two players between innings at a travel softball tournament"
              ratio="4 / 5"
            />
          </div>
        </div>
      </section>

      <section className="mk-final">
        <div className="mk-wrap">
          <h2>Ready to run your season?</h2>
          <p>Set up your team in about two minutes. Add the rest whenever you&rsquo;re ready.</p>
          <Link href={signedIn ? appHref : "/login?new=1"} className="btn btn-primary mk-btn-lg">
            {signedIn ? "Go to Season Tempo" : "Try Season Tempo"}
          </Link>
          {/* The last thing a hesitant visitor reads before deciding. */}
          {!signedIn && (
            <p className="mk-note">
              Free during early access. We&rsquo;ll give you advance notice before that changes.
            </p>
          )}
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

function Capability({ title, children }) {
  return (
    <div className="mk-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Step({ name, children }) {
  return (
    <li className="mk-step">
      <span className="mk-step-name">{name}</span>
      <span className="mk-step-text">{children}</span>
    </li>
  );
}
