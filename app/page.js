import Link from "next/link";
import "./home.css";
import { getViewer } from "../lib/context";
import { LogoLockup } from "../components/Logo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Atlas IQ — Run your team from one place",
  description:
    "Tournaments, roster, money, venues and games for travel softball teams, without the spreadsheets and group texts.",
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
          <Link href="/" className="mk-logo" aria-label="Atlas IQ home">
            <LogoLockup size={34} tone="dark" />
          </Link>

          <nav className="mk-nav">
            <a href="#product">Product</a>
            <a href="#about">About</a>
          </nav>

          <div className="mk-header-actions">
            {signedIn ? (
              <Link href={appHref} className="btn btn-primary">Go to Atlas</Link>
            ) : (
              <>
                <Link href="/login" className="mk-signin">Sign in</Link>
                <Link href="/login" className="btn btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mk-hero">
        <div className="mk-wrap">
          <h1>Run your team from one place.</h1>
          <p className="mk-lede">
            Tournaments, roster, money, venues and games — without the spreadsheets,
            group texts and screenshots you&rsquo;re using now.
          </p>

          <div className="mk-cta">
            {signedIn ? (
              <Link href={appHref} className="btn btn-primary mk-btn-lg">Go to Atlas</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-primary mk-btn-lg">Get started</Link>
                <Link href="/login" className="btn btn-secondary mk-btn-lg">Sign in</Link>
              </>
            )}
          </div>

          <p className="mk-note">Free while we&rsquo;re in early access.</p>
        </div>
      </section>

      {/* PLACEHOLDER — replace the inner block with:
            <img src="/product-screenshot.png" alt="The Atlas IQ dashboard" />
          and drop the file into /public. Keep the frame; it carries the styling. */}
      <section className="mk-shot">
        <div className="mk-wrap">
          <div className="mk-shot-frame">
            <div className="mk-shot-placeholder">
              <strong>Product screenshot goes here</strong>
              <span>
                A populated Atlas IQ dashboard — next tournament, needs action, finance
                and team. Replace this block with an image tag in app/page.js.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap mk-narrow">
          <h2>You&rsquo;re already tracking all of this. Just not in one place.</h2>
          <p>
            Entry fees in a spreadsheet. Who&rsquo;s paid in your texts. The field map in a
            screenshot you&rsquo;ll never find again. Birth certificates in a folder
            somewhere. Last year&rsquo;s schedule in an email.
          </p>
          <p>
            It works, right up until someone asks what the season actually cost — or which
            three players still owe you.
          </p>
          <p className="mk-emphasis">
            Atlas IQ keeps it together, so the answer takes five seconds instead of an evening.
          </p>
        </div>
      </section>

      <section className="mk-section mk-alt" id="product">
        <div className="mk-wrap">
          <h2 className="mk-centered">Six things, one place</h2>

          <div className="mk-grid">
            <Capability title="Tournament IQ">
              Plan your schedule, weigh up events you&rsquo;re considering, and track
              registration, cost and results in one view.
            </Capability>
            <Capability title="Team">
              Your roster, uniforms, contacts and paperwork for the season. Players carry
              across years, so you set them up once.
            </Capability>
            <Capability title="Finance">
              What you budgeted, what you&rsquo;ve spent, what&rsquo;s come in, and who
              still owes dues.
            </Capability>
            <Capability title="Facilities">
              A shared directory of venues, plus your own notes on parking, gates and
              concessions for next time.
            </Capability>
            <Capability title="Games">
              Schedule and results inside each tournament. Enter the score; Atlas works out
              the record.
            </Capability>
            <Capability title="Files">
              Player documents, waivers, insurance and schedules, attached to the player or
              tournament they belong to.
            </Capability>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap">
          <h2 className="mk-centered">How a season runs</h2>
          <ol className="mk-flow">
            <Step name="Plan">Add events you&rsquo;re considering. Compare cost, dates and travel.</Step>
            <Step name="Commit">Decide what you&rsquo;re playing. Costs and reminders start counting.</Step>
            <Step name="Play">Record games and results as the weekend happens.</Step>
            <Step name="Track">Watch the budget, dues and what still needs attention.</Step>
            <Step name="Learn">Note what the venue was like and whether you&rsquo;d go back.</Step>
            <Step name="Next season">Carry your roster forward. Last year stays exactly as it was.</Step>
          </ol>
        </div>
      </section>

      <section className="mk-section mk-alt" id="about">
        <div className="mk-wrap mk-narrow">
          <h2>Built around how travel teams actually operate</h2>
          <p>
            Atlas IQ is built around the realities of running a travel season: entry fees,
            venue details that are hard to find, payments scattered across messages, and a
            schedule that keeps changing.
          </p>
          <p className="mk-emphasis">
            It isn&rsquo;t a league platform or an accounting package. It&rsquo;s for the
            person who ends up holding all of it.
          </p>
          <p>
            We&rsquo;re early, and we&rsquo;d rather get it right for a handful of teams
            than launch loudly for none.
          </p>
        </div>
      </section>

      <section className="mk-final">
        <div className="mk-wrap">
          <h2>Ready to run your season?</h2>
          <p>Set up your team in about two minutes. Add the rest whenever you&rsquo;re ready.</p>
          <Link href={signedIn ? appHref : "/login"} className="btn btn-primary mk-btn-lg">
            {signedIn ? "Go to Atlas" : "Get started"}
          </Link>
        </div>
      </section>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-inner">
          <LogoLockup size={30} tone="dark" />
          <nav className="mk-footer-nav">
            <a href="#about">About</a>
            <a href="mailto:tourneyatlasiq@gmail.com">Contact</a>
            {!signedIn && <Link href="/login">Sign in</Link>}
          </nav>
          <span className="mk-copyright">© {new Date().getFullYear()} Atlas IQ</span>
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
