import Link from "next/link";
import "./direction.css";

export const dynamic = "force-static";

export const metadata = {
  title: "Art direction proof",
  robots: { index: false, follow: false },
};

/**
 * ART DIRECTION PROOF — not a page, not a product tour.
 *
 * Roughly the first two desktop screens of a possible Season Tempo homepage,
 * built to answer one question: does the visual language feel right?
 *
 * The system being tested:
 *   Light ground. Navy ink. One blue accent.
 *   An extreme type scale — annotation, body, statement — and nothing between.
 *   Asymmetric composition on a twelve-column field, never centred.
 *   Real numbers set as typography, because this product is full of them.
 *   Screenshots as PLATES: cropped to one argument, hairline rule, no shadow,
 *     always captioned. Evidence, not decoration.
 *   Space as the separator. No alternating grey bands.
 *
 * Deliberately absent: module selector, console, lineup, arrangement,
 * carousel, feature grid, icons, illustration, second screenshot.
 */
export default function DirectionProof() {
  return (
    <div className="dx">
      {/* Quiet, on the page rather than over it. No shadow, no blur, no
          sticky. Sign in is utility; the acquisition CTA lives in content. */}
      <header className="dx-nav">
        <div className="dx-wrap dx-nav-inner">
          <span className="dx-mark">Season Tempo</span>
          <nav className="dx-nav-links">
            <span>Product</span>
            <span>Pricing</span>
            <span>About</span>
          </nav>
          <span className="dx-signin">Sign in</span>
        </div>
      </header>

      {/* --- Statement ------------------------------------------------- */}
      <section className="dx-hero">
        <div className="dx-wrap">
          <p className="dx-eyebrow">Travel softball</p>

          <h1 className="dx-statement">
            From the first entry fee<br />to the last at-bat.
          </h1>

          <div className="dx-hero-foot">
            <p className="dx-lede">
              Season Tempo is where a season is run — the weekends, the money, the games and
              what came of them, in one place.
            </p>

            <div className="dx-actions">
              <Link href="#" className="dx-btn">Try Season Tempo</Link>
              <span className="dx-note">Free during early access.</span>
            </div>
          </div>
        </div>
      </section>

      {/* --- The argument, made in type first --------------------------- */}
      <section className="dx-argument">
        <div className="dx-wrap dx-grid">
          <div className="dx-arg-copy">
            <p className="dx-eyebrow">The part spreadsheets miss</p>
            <h2 className="dx-section">
              You have already spent
              <span className="dx-figure">$6,365</span>
              of a season that has barely started.
            </h2>
            <p className="dx-body">
              Eight weekends committed. Two invoices paid. A spreadsheet shows you the two.
              Season Tempo counts a tournament the moment you commit to it, so the number you
              are looking at is the one you actually owe.
            </p>
          </div>

          {/* One plate. Cropped to exactly the argument above it, ruled
              rather than shadowed, and captioned — because the caption does
              the work the image cannot. */}
          <figure className="dx-plate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/proof/plate-budget.webp"
              alt="A season budget of $29,480 showing $3,544 paid, $5,660 still to pay, and $1,315 in tournament commitments not yet assigned to a category"
            />
            <figcaption>
              Season budget · Northgate 16U Gold. Committed costs count before an invoice
              arrives.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- The transition into what follows --------------------------- */}
      <section className="dx-next">
        <div className="dx-wrap">
          <hr className="dx-rule" />
          <p className="dx-eyebrow">Next</p>
          <h2 className="dx-section dx-next-head">
            The same is true of the weekend itself.
          </h2>
        </div>
      </section>

      <footer className="dx-foot">
        <div className="dx-wrap">
          <p>
            Art direction proof. One real capture, cropped. Not a page and not the product
            story.
          </p>
        </div>
      </footer>
    </div>
  );
}
