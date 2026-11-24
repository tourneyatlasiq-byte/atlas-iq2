import Link from "next/link";
import { LogoLockup } from "./SeasonTempoLogo";
import { SUPPORT_EMAIL } from "../lib/legal";
import MarketingMenu from "./MarketingMenu";
import "../app/site.css";

/**
 * Header and footer for the public site.
 *
 * Previously copied inline into three pages, which is how /privacy and /terms
 * ended up with a different footer from the homepage. Adding /product would
 * have made a fourth copy, so they live here instead.
 *
 * Product now routes to a real page rather than a homepage anchor.
 */
const NAV = [
  { href: "/product", label: "Product" },
  { href: "/quality-at-bats", label: "Quality at-bats" },
  { href: "/about", label: "About" },
];

export function MarketingHeader({ signedIn = false, appHref = "/dashboard" }) {
  return (
    <header className="sx-header">
      <div className="sx-wrap sx-header-in">
        <Link href="/" className="sx-logo" aria-label="Season Tempo home">
          <LogoLockup size={32} tone="ink" wordSize={22} />
        </Link>

        <nav className="sx-nav" aria-label="Main">
          {NAV.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>

        <div className="sx-cta">
          {signedIn ? (
            <Link href={appHref} className="sx-btn sx-btn-volt sx-btn-sm">Open Season Tempo</Link>
          ) : (
            <>
              <Link href="/login" className="sx-signin">Sign in</Link>
              <Link href="/login?new=1" className="sx-btn sx-btn-volt sx-btn-sm">Get started</Link>
            </>
          )}
          <MarketingMenu links={NAV} signedIn={signedIn} appHref={appHref} />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter({ signedIn = false }) {
  return (
    <footer className="sx-footer">
      <div className="sx-wrap">
        <div className="sx-footer-grid">
          <div>
            <LogoLockup size={30} tone="ink" wordSize={22} />
            <p className="sx-footer-line">Tournaments, roster, dues, facilities, games and quality at-bats for travel softball.</p>
          </div>

          <nav className="sx-footer-col" aria-label="Product">
            <p>Product</p>
            <Link href="/product">Product</Link>
            <Link href="/quality-at-bats">Quality at-bats</Link>
            <Link href="/about">About</Link>
            {!signedIn && <Link href="/login">Sign in</Link>}
          </nav>

          <nav className="sx-footer-col" aria-label="Company">
            <p>Company</p>
            <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </nav>
        </div>

        <div className="sx-footer-base">
          © {new Date().getFullYear()} Season Tempo. All rights reserved.
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

/**
 * A real product capture. Phones get a phone-sized capture of the same screen
 * so the figures stay readable; wider screens get the desktop capture.
 */
export function Shot({ name, w, h, mw, mh, alt, eager = false }) {
  return (
    <picture>
      <source media="(max-width: 760px)" srcSet={`/marketing/${name}-m.webp`} width={mw} height={mh} />
      <img src={`/marketing/${name}.webp`} width={w} height={h} alt={alt} loading={eager ? undefined : "lazy"} />
    </picture>
  );
}
