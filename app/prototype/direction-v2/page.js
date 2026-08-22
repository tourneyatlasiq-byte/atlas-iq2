import "./v2.css";

export const dynamic = "force-static";
export const metadata = { title: "Direction V2", robots: { index: false, follow: false } };

/**
 * ART DIRECTION V2 — a controlled test, not a redesign.
 *
 * Structure, copy, plate, spacing and light editorial composition are
 * IDENTICAL to /prototype/direction. Only the identity layer changes, so the
 * comparison is of the variable rather than of three different designs.
 *
 *   A  display typeface only
 *   B  A + one line of real season data, and one decisive use of gold
 *   C  A + one photographic crop
 *
 * B and C are deliberately not combined: the question is whether data OR
 * physical imagery supplies the missing identity, and combining them would
 * answer neither.
 *
 * The face is Barlow Condensed. Oswald and Anton were rejected as too close
 * to sports graphics and poster/flyer work respectively; Archivo Narrow was
 * not distinctive enough to test anything. Barlow Condensed is a technical
 * grotesque used widely in editorial and transit design — condensed and
 * confident without varsity, jersey or collegiate association.
 */

/* Real Northgate results, verified against production. Three games, three
   recorded outcomes. Nothing invented. */
const SEASON = [
  { date: "AUG 5", opp: "Northside Thunder", res: "W", score: "6–1" },
  { date: "AUG 5", opp: "Cobb Crush", res: "W", score: "8–2" },
  { date: "AUG 6", opp: "Lake City Lightning", res: "L", score: "6–7" },
];

function Proof({ variant }) {
  return (
    <div className={`v2 v2-${variant}`}>
      <header className="v2-nav">
        <div className="v2-wrap v2-nav-inner">
          <span className="v2-mark">Season Tempo</span>
          <nav className="v2-nav-links"><span>Product</span><span>Pricing</span><span>About</span></nav>
          <span className="v2-signin">Sign in</span>
        </div>
      </header>

      {/* Variant C only: one photographic crop, full-bleed and shallow, sitting
          between the navigation and the statement. */}
      {variant === "c" && (
        <div className="v2-photo">
          <div className="v2-photo-slot">
            <p className="v2-photo-note">
              PHOTOGRAPH NOT SUPPLIED — see sourcing note
              <span>Tight editorial crop · desaturated · 1600 × 420</span>
            </p>
          </div>
        </div>
      )}

      <section className="v2-hero">
        <div className="v2-wrap">
          <p className="v2-eyebrow">Travel softball</p>
          <h1 className="v2-statement">From the first entry fee<br />to the last at-bat.</h1>

          {/* Variant B only: real season results as editorial texture. A box
              score, not an application table — and supporting texture rather
              than another product feature. */}
          {variant === "b" && (
            <div className="v2-season">
              <ul>
                {SEASON.map((g) => (
                  <li key={g.opp}>
                    <span className="v2-s-date">{g.date}</span>
                    <span className="v2-s-opp">{g.opp}</span>
                    <span className={`v2-s-res ${g.res === "W" ? "w" : "l"}`}>{g.res}</span>
                    <span className="v2-s-score">{g.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="v2-hero-foot">
            <p className="v2-lede">
              Season Tempo is where a season is run — the weekends, the money, the games and
              what came of them, in one place.
            </p>
            <div className="v2-actions">
              <span className="v2-btn">Try Season Tempo</span>
              <span className="v2-note">Free during early access.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="v2-argument">
        <div className="v2-wrap v2-grid">
          <div>
            <p className="v2-eyebrow">The part spreadsheets miss</p>
            <h2 className="v2-section">
              You have already spent
              <span className="v2-figure">$6,365</span>
              of a season that has barely started.
            </h2>
            <p className="v2-body">
              Eight weekends committed. Two invoices paid. A spreadsheet shows you the two.
              Season Tempo counts a tournament the moment you commit to it, so the number you
              are looking at is the one you actually owe.
            </p>
          </div>

          <figure className="v2-plate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/proof/plate-budget.webp"
              alt="A season budget of $29,480 showing $3,544 paid, $5,660 still to pay, and $1,315 in tournament commitments not yet assigned to a category" />
            <figcaption>
              Season budget · Northgate 16U Gold. Committed costs count before an invoice arrives.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="v2-next">
        <div className="v2-wrap">
          <hr className="v2-rule" />
          <p className="v2-eyebrow">Next</p>
          <h2 className="v2-section v2-next-head">The same is true of the weekend itself.</h2>
        </div>
      </section>
    </div>
  );
}

export default function DirectionV2() {
  return (
    <div className="v2-page">
        <div className="v2-band">
          <p className="v2-band-eyebrow">Variant A</p>
          <h2>Typography only</h2>
          <p>Condensed display face. No photography, no data, no additional elements.</p>
        </div>
        <Proof variant="a" />

        <div className="v2-band">
          <p className="v2-band-eyebrow">Variant B</p>
          <h2>Typography + season data</h2>
          <p>Adds three real Northgate results and one decisive use of gold.</p>
        </div>
        <Proof variant="b" />

        <div className="v2-band">
          <p className="v2-band-eyebrow">Variant C</p>
          <h2>Typography + photography</h2>
          <p>Adds one tight editorial crop. The image itself was not supplied — see the note.</p>
        </div>
        <Proof variant="c" />
    </div>
  );
}
