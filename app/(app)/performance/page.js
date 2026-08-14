import Link from "next/link";
import { getContext } from "../../../lib/context";
import { getPerformanceOverview } from "../../../lib/queries/performance";
import { HelpMenu } from "../../../components/HelpMenu";

export const dynamic = "force-dynamic";

/**
 * Performance — the discoverable home for Quality At-Bats.
 *
 * Deliberately a guided workflow rather than a dashboard. A coach opening this
 * for the first time should be able to answer: what is this, what do I need to
 * do next, and how do I start tracking. Statistics come later.
 *
 * The page leads with the next committed tournament, not an automatically
 * chosen game. start_time is null on almost every game, so with two games on
 * one date nothing in the schema says which is next — and guessing would show
 * "Continue tracking" or "Set batting order" on a coin flip. Games are listed
 * and the coach picks the one they are at.
 */

function fmtDate(d) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function fmtRange(start, end) {
  if (!start) return null;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [ys, ms, ds] = start.split("-");
  const from = `${months[Number(ms) - 1]} ${Number(ds)}`;
  if (!end || end === start) return from;
  const [ye, me, de] = end.split("-");
  return Number(me) === Number(ms)
    ? `${from} to ${Number(de)}`
    : `${from} to ${months[Number(me) - 1]} ${Number(de)}`;
}

export default async function PerformancePage() {
  const { features } = await getContext();

  if (!features?.qab) return <PerformancePremium />;

  const { tournament, participantCount, games } = await getPerformanceOverview();
  const hasRoster = participantCount > 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Performance</h1>
          <div className="page-sub">
            Track Quality At-Bats during games and see how your team is performing.
          </div>
        </div>
        <HelpMenu />
      </div>

      {!tournament ? (
        <div className="card">
          <div className="empty">
            <h3>No committed tournament yet</h3>
            <p>
              Quality At-Bats are recorded against the games in a tournament. Commit to a
              tournament and add its games to get started.
            </p>
            <Link className="btn btn-primary" href="/tournaments">
              Go to Tournaments
            </Link>
          </div>
        </div>
      ) : (
        <>
          <section className="perf-next">
            <p className="perf-eyebrow">Next up</p>
            <h2 className="perf-name">{tournament.name}</h2>
            <p className="perf-meta">
              {fmtRange(tournament.start_date, tournament.end_date)}
              {tournament.provider?.name && ` · ${tournament.provider.name}`}
              {tournament.facility?.name && ` · ${tournament.facility.name}`}
            </p>
          </section>

          {/* Tournament roster is a tournament-level prerequisite, so it is
              stated once above the games rather than repeated on each. */}
          <section className={`perf-req${hasRoster ? " ok" : " todo"}`}>
            <div className="perf-req-text">
              <p className="perf-req-label">Tournament roster</p>
              {hasRoster ? (
                <p className="perf-req-state">✓ {participantCount} attending</p>
              ) : (
                <>
                  <p className="perf-req-state">Not set</p>
                  <p className="perf-req-help">
                    Set who&rsquo;s attending this tournament before creating game batting
                    orders.
                  </p>
                </>
              )}
            </div>
            {!hasRoster && (
              <Link className="btn btn-primary perf-req-action" href="/tournaments">
                Set tournament roster →
              </Link>
            )}
          </section>

          <section className="perf-games">
            <h3 className="perf-games-h">Games</h3>

            {games.length === 0 ? (
              <p className="perf-none">
                This tournament has no games yet. Add them from the tournament to start
                tracking.
              </p>
            ) : (
              <ul className="perf-list">
                {games.map((g) => (
                  <li key={g.id}>
                    <GameRow game={g} tournamentId={tournament.id} enabled={hasRoster} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * One game, one state, one action.
 *
 * No game is labelled first, next or previous: with start_time absent there is
 * no basis for it, and a wrong label is worse than none.
 */
function GameRow({ game, tournamentId, enabled }) {
  const base = `/tournaments/${tournamentId}/games/${game.id}`;

  let state;
  let action = null;

  if (game.plateAppearances > 0) {
    state = `${game.plateAppearances} PA recorded`;
    action = { href: `${base}/track`, label: "Continue QAB Tracking →", primary: true };
  } else if (game.batters > 0) {
    state = `${game.batters} batting`;
    action = { href: `${base}/track`, label: "Start QAB Tracking →", primary: true };
  } else {
    state = "Batting order not set";
    action = { href: `${base}/lineup`, label: "Set batting order →", primary: false };
  }

  return (
    <div className="perf-game">
      <div className="perf-game-text">
        <p className="perf-game-opponent">{game.opponent_name ?? "Opponent"}</p>
        <p className="perf-game-meta">
          {fmtDate(game.game_date)}
          {game.game_type && ` · ${game.game_type}`}
        </p>
        <p className="perf-game-state">{state}</p>
      </div>

      {enabled ? (
        <Link
          className={`btn perf-game-action${action.primary ? " btn-primary" : ""}`}
          href={action.href}
        >
          {action.label}
        </Link>
      ) : (
        <span className="perf-game-blocked">Set the tournament roster first</span>
      )}
    </div>
  );
}

/**
 * Shown when the organization does not have QAB.
 *
 * Explains the capability without implying it can be self-activated: enabling
 * is an operator action and organization_features has no write policy, so an
 * upgrade button here would be a lie.
 */
function PerformancePremium() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            Performance <span className="perf-premium-tag">Premium</span>
          </h1>
          <div className="page-sub">
            Understand the quality behind every plate appearance.
          </div>
        </div>
        <HelpMenu />
      </div>

      <section className="perf-locked">
        <p className="perf-locked-lead">
          Track Quality At-Bats during games, follow your batting order automatically, and see
          player and team performance over time.
        </p>

        <ul className="perf-locked-list">
          <li>
            <span className="perf-locked-step">1</span>
            <span>
              <strong>Tournament roster</strong>
              <span>Choose who is attending, including pickups.</span>
            </span>
          </li>
          <li>
            <span className="perf-locked-step">2</span>
            <span>
              <strong>Batting order</strong>
              <span>Set who is batting for a game, in order.</span>
            </span>
          </li>
          <li>
            <span className="perf-locked-step">3</span>
            <span>
              <strong>Track</strong>
              <span>
                Record each plate appearance from your phone, even without signal.
              </span>
            </span>
          </li>
        </ul>

        <p className="perf-locked-note">
          Performance is not enabled for your organization.
        </p>
      </section>
    </div>
  );
}
