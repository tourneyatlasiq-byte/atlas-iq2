"use client";

import { useState } from "react";
import { ContextHelp } from "./ContextHelp";
import { useActionFeedback } from "../lib/useActionFeedback";
import { saveLineup, copyLineupFrom, previewLineupFrom } from "../lib/actions/lineup";
import { ConfirmDialog } from "./ConfirmAction";
import { useUnsavedGuard } from "../lib/useUnsavedGuard";
import { lateArrivalTiming, lateArrivalMessage } from "../lib/lineup-rules";
import { lineupSuggestion, lineupSuggestionLabel } from "../lib/game-flow-rules";
import { useSessionDismiss } from "../lib/useSessionDismiss";

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
  plateAppearances = [],
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
  const [confirmClear, setConfirmClear] = useState(false);
  // Previous-lineup suggestion (Release 2). "Not now" lasts for the browser
  // session (leave, return, refresh), never the database. draftFrom names the
  // game an unsaved draft came from, so the screen can say it is not saved yet.
  const [suggestDismissed, dismissSuggest, suggestReady] = useSessionDismiss("lineup", game.id);
  const [draftFrom, setDraftFrom] = useState(null);
  const { error, notice, pending, run, setError } = useActionFeedback();
  const guard = useUnsavedGuard(dirty);

  // Once an at-bat is recorded the saved order is fixed: the slot numbers those
  // at-bats and the tracker's "who is next" are keyed to must not move. Late
  // arrivals can be added at the end and Substitute (in the tracker) stays
  // available. The database enforces this; the screen just stops offering what
  // would be refused. `lockedCount` is how many slots are saved and fixed.
  const inGame = plateAppearances.some((r) => !r.voided_at);
  const [lockedCount, setLockedCount] = useState(() => (inGame ? initialLineup.length : 0));
  // Recovery: at-bats exist but the saved order is empty (for example it was cleared
  // from another device just before tracking began, or an old bug). Rebuilding it is
  // NOT a late arrival, so it gets its own wording and an explicit confirmation.
  const [recovery, setRecovery] = useState(() => inGame && initialLineup.length === 0);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const timing = inGame && !recovery
    ? lateArrivalTiming(
        [...Array(lockedCount)].map((_, i) => ({ batting_order: i + 1 })),
        plateAppearances
      )
    : null;
  const addedCount = inGame && !recovery ? Math.max(0, order.length - lockedCount) : 0;

  const suggestion = lineupSuggestion({
    destination: {
      id: game.id,
      game_date: game.game_date,
      start_time: game.start_time,
      batters: initialLineup.length,
      plateAppearances: inGame ? 1 : 0,
    },
    sources: copySources,
    canWrite,
    hasDraft: dirty || order.length > 0,
    dismissed: suggestDismissed || !suggestReady,
    recovery,
  });

  // Loads the earlier order as a DRAFT: nothing is written. Save stays the
  // coach's explicit action, through the same saveLineup as any other order.
  const useSuggestion = () => {
    if (!suggestion) return;
    run(() => previewLineupFrom(game.id, suggestion.id), null, {
      onDone: (r) => {
        setCopiedMeta(r.order ?? []);
        setOrder((r.order ?? []).map((x) => x.player_id));
        setDirty(true);
        setDraftFrom({ label: lineupSuggestionLabel(suggestion), skipped: r.skipped ?? 0 });
        setCopyOpen(false);
      },
    });
  };
  const discardDraft = () => {
    setOrder([]);
    setDirty(false);
    setDraftFrom(null);
  };

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
  const remove = (i) => {
    if (inGame && i < lockedCount) return;
    mutate(order.filter((_, idx) => idx !== i));
  };

  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    if (inGame && (i < lockedCount || j < lockedCount)) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    mutate(next);
  };

  const save = () =>
    run(() => saveLineup(game.id, order, recovery ? { rebuild: true } : {}), null, {
      onDone: () => {
        setDirty(false);
        setDraftFrom(null);
        setConfirmRebuild(false);
        if (inGame) setLockedCount(order.length);
        setRecovery(false);
      },
      success: (r) => r.notice,
    });

  // Clearing is its own deliberate action, available only before the first
  // at-bat. It persists straight away (an empty save), then the screen is empty.
  const clear = () =>
    run(() => saveLineup(game.id, []), null, {
      onDone: () => {
        setOrder([]);
        setDirty(false);
        setConfirmClear(false);
      },
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
        {/* H3: help in place, reusing Help answers (2026-11). */}
        <ContextHelp
          label="How this works"
          context="lineup"
          questions={[
            { id: "qab-lineup", ask: "How does the batting order work?" },
            { id: "tournament-roster", ask: "Where do these players come from?" },
            { id: "qab-track", ask: "What happens after I save it?" },
          ]}
          actions={false}
          learnMore="qab#batting-order"
        />
      </header>

      {error && <div className="notice notice-error" role="alert">{error}</div>}
      {notice && <div className="notice notice-ok">{notice}</div>}

      {playerSource === "season_roster" && (
        <div className="notice notice-info">
          No tournament roster set for this event. Showing season roster.
        </div>
      )}

      {/* The coach names the source game. The old control inferred it as "the
          previous game" and tie-broke on a random UUID, so on a one-day
          tournament it could copy from a game that had not been played yet. */}
      {recovery && (
        <div className="notice notice-warn lineup-ingame lineup-recovery" role="status">
          <p>
            <strong>This game has recorded at-bats but no batting order.</strong> You can rebuild
            it here. This is not a late arrival: the recorded at-bats keep their original slot
            numbers, so slot 1 should be the player who batted first, slot 2 the next, and so on.
            Check the order against your scorebook before saving. Once saved it is locked.
          </p>
          <p>
            <a href={`/tournaments/${game.tournament_id}/games/${game.id}/track`}>Back to tracking →</a>
          </p>
        </div>
      )}

      {inGame && !recovery && (
        <div className="notice notice-info lineup-ingame" role="status">
          <p>
            <strong>This game is being tracked.</strong> The {lockedCount}{" "}
            {lockedCount === 1 ? "batter" : "batters"} already in the order are locked so every
            recorded at-bat stays with the right player. You can add late arrivals at the end of
            the order. To replace a player, use Substitute while tracking.
          </p>
          <p>
            <a href={`/tournaments/${game.tournament_id}/games/${game.id}/track`}>Back to tracking →</a>
          </p>
        </div>
      )}

      {suggestion && (
        <section className="lineup-suggest" aria-label="Previous lineup suggestion">
          <p className="lineup-suggest-t">Use the order from {lineupSuggestionLabel(suggestion)}?</p>
          <p className="lineup-suggest-s">It opens as a draft. Nothing is saved until you tap Save.</p>
          <div className="lineup-suggest-acts">
            <button type="button" className="btn btn-secondary" onClick={useSuggestion} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Loading..." : "Use as draft"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={dismissSuggest} disabled={pending}>
              Not now
            </button>
          </div>
        </section>
      )}

      {draftFrom && dirty && (
        <div className="lineup-draft" role="status">
          <strong>Draft, not saved yet.</strong> From {draftFrom.label}.
          {draftFrom.skipped > 0 && ` ${draftFrom.skipped} ${draftFrom.skipped === 1 ? "player is" : "players are"} not available for this game and left out.`}{" "}
          Review the order, then Save.{" "}
          <button type="button" className="btn btn-ghost lineup-draft-x" onClick={discardDraft} disabled={pending}>Discard draft</button>
        </div>
      )}

      {copySources.length > 0 && canWrite && !inGame && (
        <div className={`lineup-copy${suggestion && !copyOpen ? " is-quiet" : ""}`}>
          {!copyOpen ? (
            <button
              type="button"
              className={suggestion ? "btn btn-ghost lineup-copy-quiet" : order.length === 0 ? "btn-primary btn-lg" : "btn btn-secondary"}
              onClick={() => { setCopyOpen(true); setConfirmReplace(null); }}
              disabled={pending}
            >
              {suggestion ? "Choose a different game…" : "Copy lineup from…"}
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

          {canWrite && !inGame && order.length > 0 && !dirty && (
            <div className="lineup-clear">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirmClear(true)}
                disabled={pending}
              >
                Clear lineup
              </button>
            </div>
          )}

          {order.length === 0 ? (
            <p className="lineup-empty">
              No batters yet. Tap a player below to add them to slot 1.
            </p>
          ) : (
            <ol className="lineup-slots">
              {order.map((playerId, i) => {
                const p = byId.get(playerId) ?? { full_name: "Unknown player" };
                const locked = inGame && !recovery && i < lockedCount;
                const lateAdd = inGame && !recovery && i >= lockedCount;
                return (
                  <li key={playerId} className={`slot${locked ? " is-locked" : ""}${lateAdd ? " is-late" : ""}`}>
                    <span className="slot-num">{i + 1}</span>
                    <span className="slot-id">
                      <span className="slot-jersey">{jersey(p)}</span>
                      <span className="slot-name">{p.full_name}</span>
                      {isPickup(p) && <span className="tag-pickup">Pickup</span>}
                      {lateAdd && <span className="tag-late">Late arrival</span>}
                    </span>
                    <span className="slot-controls">
                     {locked ? (
                      <span className="slot-lock" title="Locked while the game is being tracked">
                        Locked
                      </span>
                     ) : (
                      <>
                      <button
                        type="button"
                        aria-label={`Move ${p.full_name} up`}
                        onClick={() => move(i, -1)}
                        disabled={i === 0 || (inGame && i - 1 < lockedCount) || !canWrite || pending}
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
                      </>
                     )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {inGame && !recovery && addedCount > 0 && (
            <p className="lineup-late-note">{lateArrivalMessage(timing, addedCount)}</p>
          )}
        </section>

        <section className="lineup-panel">
          <h2 className="lineup-h2">{inGame && !recovery ? "Add a Late Arrival" : "Available Players"} <span>({bench.length})</span></h2>

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

      {/* Sticky rather than fixed: it follows the coach down an 11-batter list,
          then settles into the flow at the end so it never sits on top of the
          last row or the footer. */}
      {canWrite && (order.length > 0 || dirty) && (
        <div className={`lineup-bar${dirty ? " is-dirty" : ""}`}>
          {dirty ? (
            <>
              <span className="lineup-bar-state">
                {error
                  ? "Not saved. Your order is still here. Tap Save to try again."
                  : inGame
                  ? recovery
                    ? `Unsaved rebuild · ${order.length} ${order.length === 1 ? "batter" : "batters"}`
                    : `Unsaved changes · ${addedCount} late ${addedCount === 1 ? "batter" : "batters"}`
                  : `Unsaved changes · ${order.length} ${order.length === 1 ? "batter" : "batters"}`}
              </span>
              <button
                type="button"
                className="lineup-bar-action"
                onClick={recovery ? () => setConfirmRebuild(true) : save}
                disabled={pending || (inGame && !recovery && addedCount === 0) || (recovery && order.length === 0)}
              >
                {pending
                  ? "Saving…"
                  : recovery
                    ? "Rebuild Batting Order"
                    : inGame
                    ? "Add Late Batters"
                    : order.length === 0
                      ? "Save Empty Lineup"
                      : "Save Lineup"}
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
                {inGame ? "Back to Tracking →" : "Start QAB Tracking →"}
              </a>
            </>
          )}
        </div>
      )}

      {confirmRebuild && (
        <ConfirmDialog
          title="Rebuild the batting order?"
          message={`This game already has recorded at-bats. They keep their original slot numbers, so each slot must match the player who batted there. After you save, these ${order.length} slots are locked and can only be extended with late arrivals.`}
          confirmLabel="Rebuild batting order"
          pendingLabel="Saving…"
          cancelLabel="Keep editing"
          onConfirm={save}
          onCancel={() => setConfirmRebuild(false)}
          pending={pending}
          error={error}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear lineup?"
          message={`This removes all ${order.length} ${order.length === 1 ? "batter" : "batters"} from this game's batting order. Players stay on your roster. No at-bats have been recorded, so nothing else is affected, and you can set a new order any time before tracking starts.`}
          confirmLabel="Clear lineup"
          pendingLabel="Clearing…"
          cancelLabel="Keep lineup"
          onConfirm={clear}
          onCancel={() => setConfirmClear(false)}
          pending={pending}
          error={error}
        />
      )}

      {guard.pending && (
        <ConfirmDialog
          title="Leave without saving?"
          message={
            inGame && !recovery
              ? "You have late batters that are not saved yet. If you leave now they will not be added to the batting order."
              : "You have changes to this batting order that are not saved. If you leave now they will be lost."
          }
          confirmLabel="Leave without saving"
          cancelLabel="Keep editing"
          onConfirm={guard.leave}
          onCancel={guard.stay}
        />
      )}
    </div>
  );
}
