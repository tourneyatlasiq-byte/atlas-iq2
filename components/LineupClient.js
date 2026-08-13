"use client";

import { useState } from "react";
import { useActionFeedback } from "../lib/useActionFeedback";
import { saveLineup, copyPreviousLineup } from "../lib/actions/lineup";

/**
 * QAB batting order editor.
 *
 * Tap-based ordering, not drag-and-drop. On a phone, drag competes with page
 * scroll and the touch handling differs enough between iOS and Android that it
 * fails in exactly the conditions this is used in — outdoors, one-handed,
 * between innings. Three fixed 52px controls per row do not.
 *
 * One component for both form factors. The layout reflows at 900px so desktop
 * gets available players and the order side by side, but the controls and the
 * state model are identical — there is no second implementation to keep in
 * step.
 *
 * Scope: batting order only. No positions, no innings, no substitutions, no
 * scoring. This exists so a plate appearance can be attributed to a batter.
 */

function fmtDate(d) {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function fmtTime(t) {
  if (!t) return null;
  const [h, m] = t.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${suffix}`;
}

export function LineupClient({
  game,
  initialLineup,
  availablePlayers,
  playerSource,
  previousLineup,
  canWrite,
}) {
  const [order, setOrder] = useState(() => initialLineup.map((s) => s.player_id));
  const [dirty, setDirty] = useState(false);
  const { error, notice, pending, run, setError } = useActionFeedback();

  const byId = new Map(availablePlayers.map((p) => [p.player_id, p]));
  for (const s of initialLineup) {
    if (!byId.has(s.player_id)) {
      byId.set(s.player_id, {
        player_id: s.player_id,
        full_name: s.full_name,
        jersey_number: s.jersey_number,
      });
    }
  }

  const inOrder = new Set(order);
  const bench = availablePlayers.filter((p) => !inOrder.has(p.player_id));

  const mutate = (next) => {
    setOrder(next);
    setDirty(true);
    setError(null);
  };

  const add = (playerId) => mutate([...order, playerId]);
  const remove = (i) => mutate(order.filter((_, idx) => idx !== i));

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  };

  const save = () =>
    run(() => saveLineup(game.id, order), null, {
      onDone: () => setDirty(false),
      success: (r) => r.notice,
    });

  const copy = () =>
    run(() => copyPreviousLineup(game.id), null, {
      onDone: (r) => {
        if (r.copied > 0) window.location.reload();
      },
      success: (r) => r.notice,
    });

  // Jersey is tournament-specific display data. A pickup without a number for
  // this event shows "#—" so the column still lines up — a blank reads as a
  // rendering fault rather than a fact about the player.
  const jersey = (p) => (p.jersey_number != null ? `#${p.jersey_number}` : "#—");
  const isPickup = (p) => p.participation === "pickup";

  return (
    <div className="lineup">
      <header className="lineup-head">
        <h1>Set Batting Order</h1>
        <p className="lineup-intro">
          Set the batting order for this game. QAB tracking will automatically move through
          players in this order.
        </p>
        <p className="lineup-context">
          vs {game.opponent_name ?? "Opponent"} ·{" "}
          {game.tournament?.name ?? "Tournament"}
          {game.game_date && ` · ${fmtDate(game.game_date)}`}
          {game.start_time && ` · ${fmtTime(game.start_time)}`}
          {game.game_type && ` · ${game.game_type}`}
        </p>
      </header>

      {error && <div className="notice notice-error">{error}</div>}
      {notice && <div className="notice notice-ok">{notice}</div>}

      {playerSource === "season_roster" && (
        <div className="notice notice-info">
          No event roster set for this tournament. Showing season roster.
        </div>
      )}

      {order.length === 0 && previousLineup && canWrite && (
        <div className="lineup-copy">
          <p>
            The most recent lineup was <strong>vs {previousLineup.opponent_name}</strong>
            {previousLineup.game_date && ` on ${fmtDate(previousLineup.game_date)}`}.
          </p>
          <button type="button" className="btn-primary btn-lg" onClick={copy} disabled={pending}>
            Use Previous Lineup
          </button>
          <p className="lineup-hint">
            Copies the players and order only. Jersey numbers come from this tournament, and you
            can make changes before saving.
          </p>
        </div>
      )}

      <div className="lineup-cols">
        <section className="lineup-panel">
          <h2 className="lineup-h2">Batting Order <span>{order.length}</span></h2>

          {order.length === 0 ? (
            <p className="lineup-empty">
              No batters yet. Tap a player below to add them to slot 1.
            </p>
          ) : (
            <ol className="lineup-slots">
              {order.map((playerId, i) => {
                const p = byId.get(playerId) ?? { full_name: "Unknown player" };
                return (
                  <li key={playerId} className="slot">
                    <span className="slot-num">{i + 1}</span>
                    <span className="slot-id">
                      <span className="slot-jersey">{jersey(p)}</span>
                      <span className="slot-name">{p.full_name}</span>
                      {isPickup(p) && <span className="tag-pickup">Pickup</span>}
                    </span>
                    <span className="slot-controls">
                      <button
                        type="button"
                        aria-label={`Move ${p.full_name} up`}
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || !canWrite || pending}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${p.full_name} down`}
                        onClick={() => move(i, 1)}
                        disabled={i === order.length - 1 || !canWrite || pending}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${p.full_name} from the lineup`}
                        onClick={() => remove(i)}
                        disabled={!canWrite || pending}
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="lineup-panel">
          <h2 className="lineup-h2">Available Players <span>{bench.length}</span></h2>

          {bench.length === 0 ? (
            <p className="lineup-empty">
              {availablePlayers.length === 0
                ? "No eligible players found for this game."
                : "Everyone available is already in the order."}
            </p>
          ) : (
            <ul className="lineup-bench">
              {bench.map((p) => (
                <li key={p.player_id}>
                  <button
                    type="button"
                    className="bench-add"
                    onClick={() => add(p.player_id)}
                    disabled={!canWrite || pending}
                  >
                    <span className="slot-id">
                      <span className="slot-jersey">{jersey(p)}</span>
                      <span className="slot-name">{p.full_name}</span>
                      {isPickup(p) && <span className="tag-pickup">Pickup</span>}
                    </span>
                    <span className="bench-plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {canWrite && (
        <div className="lineup-actions">
          {dirty ? (
            <button type="button" className="btn-primary btn-lg" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save batting order"}
            </button>
          ) : (
            order.length > 0 && <p className="lineup-saved">✓ Batting order saved</p>
          )}

          {order.length > 0 && !dirty && (
            <a
              className="lineup-track"
              href={`/tournaments/${game.tournament_id}/games/${game.id}/track`}
            >
              Start QAB Tracking →
            </a>
          )}

          {order.length > 0 && previousLineup && (
            <p className="lineup-hint">
              Clear the order first if you want to copy the previous lineup instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
