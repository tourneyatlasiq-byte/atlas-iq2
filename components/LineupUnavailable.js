import Link from "next/link";

/**
 * Shown instead of the batting order editor when the organization does not have
 * Quality At Bat. The database already returns no lineup rows and refuses
 * writes for such an organization; this explains that instead of presenting an
 * editor that can never save.
 */
export function LineupUnavailable() {
  return (
    <div className="lineup lineup-unavailable">
      <header className="lineup-head">
        <h1>Batting order</h1>
      </header>
      <div className="notice notice-info" role="status">
        <p>
          <strong>Batting orders are part of Quality At Bat, which isn&rsquo;t turned on for this
          organization.</strong>
        </p>
        <p>
          Your tournaments, games and finances are not affected.
        </p>
      </div>
      <p>
        <Link href="/tournaments" className="btn btn-secondary">
          Back to tournaments
        </Link>
      </p>
    </div>
  );
}
