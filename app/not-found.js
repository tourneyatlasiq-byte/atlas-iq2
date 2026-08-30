import Link from "next/link";

/**
 * A mistyped or stale URL. Polish, not a data risk — but a coach following an
 * old link should land somewhere that looks like Season Tempo and offers a way
 * back, rather than on a bare framework 404.
 *
 * Deliberately says nothing about whether the thing existed: "no page here"
 * covers a typo and a record in another organization identically, so this
 * cannot be used to probe what exists.
 */
export default function NotFound() {
  return (
    <div className="errpage">
      <div className="errpage-card">
        <p className="errpage-eyebrow">Page not found</p>
        <h1 className="errpage-title">There&rsquo;s no page here</h1>
        <p className="errpage-body">
          The link may be out of date, or the address may have a typo in it.
        </p>
        <div className="errpage-actions">
          <Link className="btn btn-primary" href="/dashboard">
            Go to your dashboard
          </Link>
          <Link className="btn btn-secondary" href="/">
            Season Tempo home
          </Link>
        </div>
      </div>
    </div>
  );
}
