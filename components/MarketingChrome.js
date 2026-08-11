import Link from "next/link";
import { LogoLockup } from "./SeasonTempoLogo";
import { SUPPORT_EMAIL } from "../lib/legal";

/**
 * Header and footer for the public site.
 *
 * Previously copied inline into three pages, which is how /privacy and /terms
 * ended up with a different footer from the homepage. Adding /product would
 * have made a fourth copy, so they live here instead.
 *
 * Product now routes to a real page rather than a homepage anchor.
 */
export function MarketingHeader({ signedIn = false, appHref = "/dashboard" }) {
  return (
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
  );
}

export function MarketingFooter({ signedIn = false }) {
  return (
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
  );
}

/**
 * A screenshot slot.
 *
 * Renders the real capture when one exists and an honest placeholder when it
 * doesn't — never a drawn approximation of the interface. A fabricated UI on a
 * page whose whole argument is "this is real software" would undercut the
 * argument it is making.
 */
export function ProductShot({ src, alt, caption, ratio = "16 / 10" }) {
  return (
    <figure className="mk-shot-figure">
      <div className="mk-shot-frame" style={{ aspectRatio: ratio }}>
        {src ? (
          <img src={src} alt={alt} className="mk-shot-image" />
        ) : (
          <div className="mk-shot-pending" role="img" aria-label={alt}>
            <span className="mk-shot-pending-label">{alt}</span>
          </div>
        )}
      </div>
      {caption && <figcaption className="mk-shot-caption">{caption}</figcaption>}
    </figure>
  );
}


/**
 * A photograph slot.
 *
 * Separate from ProductShot on purpose. A screenshot proves the software is
 * real; a photograph establishes the world the software is for. They carry
 * different weight, so the placeholder says which is missing rather than
 * pretending one can stand in for the other.
 *
 * Photography of identifiable people requires commercial rights or a release.
 * Where that is not in hand, prefer adult subjects or compositions with no
 * recognisable faces — travel softball means minors.
 */
export function PhotoSlot({ src, alt, ratio = "4 / 5" }) {
  return (
    <div className="mk-photo" style={{ aspectRatio: ratio }}>
      {src ? (
        <img src={src} alt={alt} className="mk-photo-image" />
      ) : (
        <div className="mk-photo-pending" role="img" aria-label={alt}>
          <span className="mk-photo-pending-label">{alt}</span>
        </div>
      )}
    </div>
  );
}
