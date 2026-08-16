"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { saveGame, deleteGame } from "../lib/actions/games";
import { GAME_TYPES, isFutureGame, recordFrom } from "../lib/game-rules";

/**
 * Games inside the Tournament IQ drawer.
 *
 * A game has no meaning outside its tournament, so this is a section of the
 * tournament rather than a module of its own.
 *
 * Result is never entered directly when a score is present — the database
 * derives it. The form collects scores; result is a fallback for a game
 * recorded without one.
 */

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}`;
}

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${m} ${suffix}`;
}

const resultClass = (r) =>
  r === "W" ? "res-w" : r === "L" ? "res-l" : r === "T" ? "res-t" : "res-none";

/**
 * One action per game, labelled for the state the game is in.
 *
 * Routes are the existing ones — /lineup for building an order, /track for
 * everything after. A finished game still opens /track because that is where
 * corrections live; the tracker renders its completed state and the database
 * refuses a NEW plate appearance until tracking is resumed.
 */
function QabAction({ tournament, game }) {
  const base = `/tournaments/${tournament.id}/games/${game.id}`;
  const batters = game.batters ?? 0;
  const pas = game.plateAppearances ?? 0;

  let href = `${base}/lineup`;
  let label = "Set lineup";

  if (game.qabCompleted) {
    href = `${base}/track`;
    label = "View QABs";
  } else if (pas > 0) {
    href = `${base}/track`;
    label = "Continue QABs";
  } else if (batters > 0) {
    href = `${base}/lineup`;
    label = `Lineup · ${batters}`;
  }

  return (
    <Link className="btn btn-ghost" href={href}>
      {label}
    </Link>
  );
}

export function GamesSection({ tournament, games, canWrite, qabEnabled = false, onChanged, openSignal = 0 }) {
  const [editing, setEditing] = useState(null); // game | "new" | null
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // The drawer's quick action bumps openSignal to open this form, so the form
  // state stays owned here rather than being lifted into the drawer.
  useEffect(() => {
    if (openSignal > 0) setEditing("new");
  }, [openSignal]);

  const record = recordFrom(games);

  const ordered = [...games].sort(
    (a, b) =>
      (a.game_date ?? "").localeCompare(b.game_date ?? "") ||
      (a.start_time ?? "").localeCompare(b.start_time ?? "")
  );

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      const result = await saveGame(formData);
      if (result?.ok) {
        setEditing(null);
        onChanged?.();
      } else setError(result?.error ?? "Something went wrong.");
    });
  }

  function remove(g) {
    if (!confirm(`Delete the game against ${g.opponent_name}?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("id", g.id);
    startTransition(async () => {
      const result = await deleteGame(fd);
      if (!result?.ok) setError(result?.error ?? "Could not delete that game.");
      else onChanged?.();
    });
  }

  return (
    <section className="detail-section games-section" id="section-games">
      <div className="games-header">
        <div className="games-heading">
          <h3 className="detail-section-title">Games</h3>
          <span className="games-count">
            {ordered.length === 0
              ? "None yet"
              : `${ordered.length} ${ordered.length === 1 ? "game" : "games"}`}
            {record.played > 0 && (
              <>
                {" · "}
                <strong>
                  {record.w}–{record.l}
                  {record.t > 0 ? `–${record.t}` : ""}
                </strong>{" "}
                at this event
              </>
            )}
          </span>
        </div>

        {/* Stays visible whether or not games exist — adding a second game is
            as common as adding the first. */}
        {canWrite && (
          <button
            className="btn btn-secondary btn-add-game"
            onClick={() => setEditing("new")}
            disabled={pending}
          >
            + Add game
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {ordered.length === 0 ? (
        <p className="section-body muted games-empty">
          No games recorded yet. Add them as the schedule is released, then enter scores once
          they're played.
        </p>
      ) : (
        <ul className="game-list">
          {ordered.map((g) => {
            const scheduled = isFutureGame(g.game_date);
            return (
              <li key={g.id}>
                <div className="game-row">
                  <span className={`game-result ${resultClass(g.result)}`}>
                    {g.result ?? "–"}
                  </span>

                  <div className="game-main">
                    <span className="game-opponent">{g.opponent_name}</span>
                    <span className="game-meta">
                      {fmtDate(g.game_date)}
                      {g.start_time && ` · ${fmtTime(g.start_time)}`}
                      {g.game_type && ` · ${g.game_type}`}
                      {scheduled && <span className="game-scheduled"> · scheduled</span>}
                    </span>
                  </div>

                  <span className="game-score">
                    {g.runs_for != null && g.runs_against != null
                      ? `${g.runs_for}–${g.runs_against}`
                      : ""}
                  </span>

                  {canWrite && (
                    <span className="game-actions">
                      {/* QAB is premium. Without it there is no lineup and no
                          tracking, so the action is not offered at all —
                          normal game management below is untouched. The label
                          reflects the game's actual state rather than always
                          reading "Set lineup" on a game with a full history. */}
                      {qabEnabled && <QabAction tournament={tournament} game={g} />}
                      <button className="btn btn-ghost" onClick={() => setEditing(g)} disabled={pending}>
                        Edit
                      </button>
                      <button className="btn btn-danger-ghost" onClick={() => remove(g)} disabled={pending}>
                        Remove
                      </button>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <GameForm
          game={editing === "new" ? null : editing}
          tournament={tournament}
          pending={pending}
          onSubmit={submit}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </section>
  );
}

function GameForm({ game, tournament, pending, onSubmit, onCancel }) {
  const isNew = !game;
  const [date, setDate] = useState(game?.game_date ?? tournament.start_date ?? "");

  const hadResult =
    game && (game.result || game.runs_for != null || game.runs_against != null);
  const movingToFuture = hadResult && isFutureGame(date) && date !== game.game_date;

  /**
   * Option C: the database rejects a completed game moved to a future date.
   * Rather than let the user hit that error, confirm first and submit with the
   * result cleared — never silently.
   */
  function handleSubmit(formData) {
    if (movingToFuture) {
      const score =
        game.runs_for != null && game.runs_against != null
          ? `${game.runs_for} to ${game.runs_against}`
          : game.result;

      const ok = confirm(
        `Moving this game to a future date will remove the recorded ${score} result. Continue?`
      );
      if (!ok) return;

      formData.set("runs_for", "");
      formData.set("runs_against", "");
      formData.set("result", "");
    }
    onSubmit(formData);
  }

  const scoresDisabled = isFutureGame(date);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={handleSubmit}>
          {game && <input type="hidden" name="id" value={game.id} />}
          <input type="hidden" name="tournament_id" value={tournament.id} />

          <div className="modal-head">
            <h2>{isNew ? "Add game" : `Edit game vs ${game.opponent_name}`}</h2>
            <div className="page-sub">{tournament.name}</div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="g-opponent">Opponent</label>
              <input id="g-opponent" name="opponent_name" required defaultValue={game?.opponent_name ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="g-date">Date</label>
                <input
                  id="g-date"
                  name="game_date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="g-time">Start time</label>
                <input id="g-time" name="start_time" type="time" defaultValue={game?.start_time ?? ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="g-type">Game type</label>
              <select id="g-type" name="game_type" defaultValue={game?.game_type ?? ""}>
                <option value="">—</option>
                {GAME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="form-divider">Result</div>

            {scoresDisabled ? (
              <p className="field-note">
                This game is scheduled for the future, so a score can't be recorded yet.
                {movingToFuture && " Saving will clear the existing result."}
              </p>
            ) : (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="g-rf">Runs for</label>
                    <input id="g-rf" name="runs_for" type="number" min="0" defaultValue={game?.runs_for ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="g-ra">Runs against</label>
                    <input id="g-ra" name="runs_against" type="number" min="0" defaultValue={game?.runs_against ?? ""} />
                  </div>
                </div>
                <p className="field-note">
                  Win, loss or tie is worked out from the score. Enter both or neither.
                </p>

                <div className="field">
                  <label htmlFor="g-result">Result without a score</label>
                  <select id="g-result" name="result" defaultValue={game?.result ?? ""}>
                    <option value="">—</option>
                    <option value="W">Win</option>
                    <option value="L">Loss</option>
                    <option value="T">Tie</option>
                  </select>
                  <p className="field-note">Only used when you don't have the score.</p>
                </div>
              </>
            )}

            <div className="field">
              <label htmlFor="g-notes">Notes</label>
              <textarea id="g-notes" name="notes" rows={2} defaultValue={game?.notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add game" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
