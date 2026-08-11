import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { MarketingHeader, MarketingFooter, ProductShot } from "../../components/MarketingChrome";
import "../home.css";

export const metadata = {
  title: "Product — Season Tempo",
  description:
    "Tournaments, roster, money, facilities and games for a travel sports season, in one place.",
};

export const dynamic = "force-dynamic";

export default async function ProductPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = Boolean(user);
  const appHref = "/dashboard";

  return (
    <div className="mk">
      <MarketingHeader signedIn={signedIn} appHref={appHref} />

      {/* 1 — Header */}
      <section className="mk-page-head">
        <div className="mk-wrap mk-narrow">
          <h1>Everything a travel season needs, in one place.</h1>
          <p className="mk-lede">
            Season Tempo follows a season the way you actually run one — from the events you&rsquo;re
            weighing up to what the whole thing cost.
          </p>
        </div>
      </section>

      {/* 2 — The lifecycle, moved from the homepage where it sat sixth */}
      <section className="mk-section mk-alt">
        <div className="mk-wrap">
          <h2 className="mk-centered">A season, start to finish</h2>
          <ol className="mk-flow">
            <Step name="Plan">Add events you&rsquo;re considering. Compare cost, dates and travel.</Step>
            <Step name="Commit">Decide what you&rsquo;re playing. Costs start counting, and it shows up in Needs Action.</Step>
            <Step name="Play">Record games and results as the event happens.</Step>
            <Step name="Track">Watch the budget, dues and what still needs attention.</Step>
            <Step name="Learn">Note what the facility was like and whether you&rsquo;d go back.</Step>
            <Step name="Next season">Carry your roster forward while keeping prior seasons preserved for reference.</Step>
          </ol>
        </div>
      </section>

      {/* 3 — Home */}
      <section className="mk-section">
        <div className="mk-wrap">
          <div className="mk-workflow">
            <div className="mk-workflow-text">
              <span className="mk-eyebrow">Know what&rsquo;s next</span>
              <h2>Open it Monday morning and see where the season stands.</h2>
              <p>
                Your next tournament, how many days away it is, and where it is. Underneath, the
                things that actually need you — players who still owe dues, an event you&rsquo;ve
                committed to but haven&rsquo;t registered for, information missing from a player
                record. Each one links to the screen where you fix it.
              </p>
            </div>
            <ProductShot
              alt="Season Tempo Home — Next Up, Needs Action and season snapshots"
              caption="Home"
              ratio="16 / 10"
            />
          </div>
        </div>
      </section>

      {/* 4 — Tournament operations */}
      <section className="mk-section mk-alt">
        <div className="mk-wrap">
          <div className="mk-workflow mk-workflow-reverse">
            <div className="mk-workflow-text">
              <span className="mk-eyebrow">Run the weekend</span>
              <h2>One tournament, everything about it.</h2>
              <p>
                Dates, facility and entry cost at the top. Registration status you can update as
                you go, and the tournament director&rsquo;s number so you can call from the
                parking lot. Underneath: the games, who&rsquo;s playing including pickups, what it
                cost, and the paperwork for that event.
              </p>
            </div>
            <ProductShot
              alt="A Season Tempo tournament — registration, contact, games, roster and costs"
              caption="Tournament"
              ratio="4 / 3"
            />
          </div>
        </div>
      </section>

      {/* 5 — Finance, including the Committed explanation */}
      <section className="mk-section">
        <div className="mk-wrap">
          <div className="mk-workflow">
            <div className="mk-workflow-text">
              <span className="mk-eyebrow">Know where the money stands</span>
              <h2>What you&rsquo;ve committed to — not just what you&rsquo;ve paid.</h2>
              <p>
                Every budget line shows four figures. <strong>Planned</strong> is what you set
                aside. <strong>Paid</strong> is what has actually left the account.{" "}
                <strong>Committed</strong> is everything you&rsquo;ve agreed to, including
                tournaments you&rsquo;ve said yes to but haven&rsquo;t been invoiced for yet.{" "}
                <strong>Available</strong> is what&rsquo;s genuinely left to spend.
              </p>
              <p>
                A budget that only counts cheques already written looks healthier than it is.
                Commit to four tournaments and Season Tempo counts them straight away — paid or
                not — so the number you&rsquo;re looking at is the one you can actually spend.
              </p>
            </div>
            <ProductShot
              alt="Season Tempo Finance — Planned, Committed, Paid and Available by category"
              caption="Finance"
              ratio="16 / 9"
            />
          </div>
        </div>
      </section>

      {/* 6 — Also included, relocated from the homepage capability grid */}
      <section className="mk-section mk-alt">
        <div className="mk-wrap">
          <h2 className="mk-centered">Also included</h2>
          <div className="mk-grid mk-grid-3">
            <Capability title="Facilities">
              A shared directory of facilities, plus your own notes on parking, gates and
              concessions for next time.
            </Capability>
            <Capability title="Games">
              Schedule and results inside each tournament. Enter the score; Season Tempo works out
              the record.
            </Capability>
            <Capability title="Files">
              Player documents, waivers, insurance and schedules, attached to the player or
              tournament they belong to.
            </Capability>
          </div>
        </div>
      </section>

      {/* 7 — CTA */}
      <section className="mk-final">
        <div className="mk-wrap">
          <h2>Ready to run your season?</h2>
          <p>Set up your team in about two minutes. Add the rest whenever you&rsquo;re ready.</p>
          <Link href={signedIn ? appHref : "/login?new=1"} className="btn btn-primary mk-btn-lg">
            {signedIn ? "Go to Season Tempo" : "Try Season Tempo"}
          </Link>
          {!signedIn && (
            <p className="mk-note">
              Free during early access. We&rsquo;ll give you advance notice before that changes.
            </p>
          )}
        </div>
      </section>

      <MarketingFooter signedIn={signedIn} />
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
