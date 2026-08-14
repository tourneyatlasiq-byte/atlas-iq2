import Link from "next/link";
import { getContext } from "../../../lib/context";
import { getPerformanceOverview, getSeasonPerformance } from "../../../lib/queries/performance";
import { HelpMenu } from "../../../components/HelpMenu";
import { PerformanceSeason } from "../../../components/PerformanceSeason";

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
  const season = await getSeasonPerformance();
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

          {/* Game day setup.

              Tournament roster is a tournament-level fact, so it carries a real
              status. Batting order and Track QABs are labels, not statuses —
              they happen per game and the cards below say so themselves. The
              sequence is orientation, not a wizard. */}
          <section className={`perf-flow${hasRoster ? " ok" : " todo"}`}>
            <p className="perf-flow-label">Game day setup</p>

            <div className="perf-flow-steps">
              <div className={`perf-flow-step ${hasRoster ? "done" : "todo"}`}>
                {hasRoster ? (
                  <p className="perf-flow-name">
                    <span className="perf-flow-tick" aria-hidden="true">✓</span>
                    Tournament roster · {participantCount} attending
                  </p>
                ) : (
                  <>
                    <p className="perf-flow-name">Tournament roster needed</p>
                    <p className="perf-flow-help">
                      Set who&rsquo;s attending this tournament before creating game batting
                      orders.
                    </p>
                    <Link className="btn btn-primary perf-flow-action" href="/tournaments">
                      Set tournament roster →
                    </Link>
                  </>
                )}
              </div>

              <span className="perf-flow-arrow" aria-hidden="true">→</span>
              <div className="perf-flow-step ahead">
                <p className="perf-flow-name">Batting order</p>
              </div>

              <span className="perf-flow-arrow" aria-hidden="true">→</span>
              <div className="perf-flow-step ahead">
                <p className="perf-flow-name">Track QABs</p>
              </div>
            </div>
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

          <PerformanceSeason {...season} />
        </>
      )}

      {!tournament && season.team.pa > 0 && <PerformanceSeason {...season} />}
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

  // Same three states as before. Nothing new is derived or invented — only the
  // wording and the rail tone change.
  let state;
  let ready;
  let action;

  if (game.plateAppearances > 0) {
    ready = true;
    state = `Batting order set · ${game.plateAppearances} PA recorded`;
    action = { href: `${base}/track`, label: "Continue tracking →" };
  } else if (game.batters > 0) {
    ready = true;
    state = `Batting order set · ${game.batters} batting`;
    action = { href: `${base}/track`, label: "Start QAB tracking →" };
  } else {
    ready = false;
    state = "Batting order needed";
    action = { href: `${base}/lineup`, label: "Set batting order →" };
  }

  return (
    <div className={`perf-game${ready ? " ready" : " needs"}`}>
      <div className="perf-game-text">
        <p className="perf-game-opponent">{game.opponent_name ?? "Opponent"}</p>
        <p className="perf-game-meta">
          {fmtDate(game.game_date)}
          {game.game_type && ` · ${game.game_type}`}
        </p>
        <p className="perf-game-state">
          {ready && (
            <span className="perf-game-tick" aria-hidden="true">
              ✓
            </span>
          )}
          {state}
        </p>
      </div>

      {enabled ? (
        <Link className="btn btn-primary perf-game-action" href={action.href}>
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
