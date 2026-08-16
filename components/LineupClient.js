"use client";

import { useState } from "react";
import { useActionFeedback } from "../lib/useActionFeedback";
import { saveLineup, copyLineupFrom } from "../lib/actions/lineup";

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
  copySources = [],
  canWrite,
}) {
  const [order, setOrder] = useState(() => initialLineup.map((s) => s.player_id));
  const [dirty, setDirty] = useState(false);
  // Display data for players copied from a previous game who are not
  // participants in this tournament, so their names still render.
  const [copiedMeta, setCopiedMeta] = useState([]);
  // Explicit copy: which game to copy from, and whether the coach has
  // confirmed replacing an order that already exists.
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(null);
  const { error, notice, pending, run, setError } = useActionFeedback();

  const byId = new Map(availablePlayers.map((p) => [p.player_id, p]));
  for (const s of copiedMeta) {
    if (!byId.has(s.player_id)) byId.set(s.player_id, s);
  }
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

  // Copying writes the rows server-side, so the page shows the populated order
  // straight away with nothing pending. The coach then makes the usual one to
  // three changes, which is what marks it dirty and brings Save back.
  //
  // The source is always an explicit choice. Replacing an existing order is a
  // second, deliberate action — the first attempt returns needsConfirm rather
  // than overwriting.
  const copy = (confirmed = false) => {
    if (!copyFrom) {
      setError("Choose a game to copy from.");
      return;
    }
    // Replacing an existing order is destructive, so it takes a second,
    // deliberate action. Gated here because the client already knows whether
    // this game has an order; the server refuses an unconfirmed replace too,
    // so a stale tab cannot get past it either.
    if (order.length > 0 && !confirmed) {
      setConfirmReplace(order.length);
      return;
    }
    run(() => copyLineupFrom(game.id, copyFrom, { replace: true }), null, {
      onDone: (r) => {
        if (r.copied > 0) {
          setCopiedMeta(r.order ?? []);
          setOrder((r.order ?? []).map((s) => s.player_id));
          setDirty(false);
          setCopyOpen(false);
          setConfirmReplace(null);
        }
      },
      success: (r) => r.notice,
    });
  };

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
          No tournament roster set for this event. Showing season roster.
        </div>
      )}

      {/* The coach names the source game. The old control inferred it as "the
          previous game" and tie-broke on a random UUID, so on a one-day
          tournament it could copy from a game that had not been played yet. */}
      {copySources.length > 0 && canWrite && (
        <div className="lineup-copy">
          {!copyOpen ? (
            <button
              type="button"
              className={order.length === 0 ? "btn-primary btn-lg" : "btn btn-secondary"}
              onClick={() => { setCopyOpen(true); setConfirmReplace(null); }}
              disabled={pending}
            >
              Copy lineup from…
            </button>
          ) : (
            <>
              <h2 className="lineup-copy-h">Copy lineup from…</h2>

              <div className="field">
                <label htmlFor="copy-src">Game to copy</label>
                <select
                  id="copy-src"
                  value={copyFrom}
                  onChange={(e) => { setCopyFrom(e.target.value); setConfirmReplace(null); }}
                >
                  <option value="">Choose a game…</option>
                  {copySources.map((g) => (
                    <option key={g.id} value={g.id}>
                      {`vs ${g.opponent_name ?? "Opponent"}`}
                      {g.game_date ? ` · ${fmtDate(g.game_date)}` : ""}
                      {g.start_time ? ` · ${fmtTime(g.start_time)}` : ""}
                      {g.tournament_name ? ` · ${g.tournament_name}` : ""}
                      {` · ${g.batters} batters`}
                    </option>
                  ))}
                </select>
              </div>

              {confirmReplace != null ? (
                <div className="lineup-copy-confirm">
                  <p>
                    This game already has {confirmReplace}{" "}
                    {confirmReplace === 1 ? "batter" : "batters"}. Copying replaces that order.
                    Recorded at-bats are not affected.
                  </p>
                  <div className="lineup-copy-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => copy(true)}
                      disabled={pending}
                    >
                      Replace lineup
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setConfirmReplace(null)}
                      disabled={pending}
                    >
                      Keep current lineup
                    </button>
                  </div>
                </div>
              ) : (
                <div className="lineup-copy-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => copy(false)}
                    disabled={pending || !copyFrom}
                  >
                    Copy lineup
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setCopyOpen(false); setConfirmReplace(null); }}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                </div>
              )}

              <p className="lineup-hint">
                Copies players and order only, as a snapshot — jersey numbers come from this
                tournament, and later changes to that game will not affect this one. Archived
                players are left out. Recorded at-bats are never copied.
              </p>
            </>
          )}
        </div>
      )}

      <div className="lineup-cols">
        <section className="lineup-panel">
          <h2 className="lineup-h2">Batting Order <span>({order.length})</span></h2>

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
          <h2 className="lineup-h2">Available Players <span>({bench.length})</span></h2>

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

      {order.length > 0 && previousLineup && !dirty && (
        <p className="lineup-hint">
          Clear the order first if you want to copy the previous lineup instead.
        </p>
      )}

      {/* Sticky rather than fixed: it follows the coach down an 11-batter list,
          then settles into the flow at the end so it never sits on top of the
          last row or the footer. */}
      {canWrite && order.length > 0 && (
        <div className={`lineup-bar${dirty ? " is-dirty" : ""}`}>
          {dirty ? (
            <>
              <span className="lineup-bar-state">
                Unsaved changes · {order.length} {order.length === 1 ? "batter" : "batters"}
              </span>
              <button
                type="button"
                className="lineup-bar-action"
                onClick={save}
                disabled={pending}
              >
                {pending ? "Saving…" : "Save Lineup"}
              </button>
            </>
          ) : (
            <>
              <span className="lineup-bar-state">
                ✓ Lineup saved · {order.length} {order.length === 1 ? "batter" : "batters"}
              </span>
              <a
                className="lineup-bar-action"
                href={`/tournaments/${game.tournament_id}/games/${game.id}/track`}
              >
                Start QAB Tracking →
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
