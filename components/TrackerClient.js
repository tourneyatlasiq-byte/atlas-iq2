"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QAB_REASONS, reasonLabel, tallyPlateAppearances } from "../lib/qab-rules";
import {
  recordPlateAppearance,
  voidPlateAppearance,
  correctPlateAppearance,
} from "../lib/actions/plate-appearances";
import { enqueue, flushQueue, queueStatus, newPaId } from "../lib/offline-queue";
import { finishGameTracking, resumeGameTracking } from "../lib/actions/games";
import { substitutePlayer } from "../lib/actions/lineup";
import { resumePosition } from "../lib/tracker-cursor";

/**
 * Live QAB tracker.
 *
 * Built for someone standing at a fence in the sun, holding a phone in one
 * hand, between pitches. Every choice follows from that: one plate appearance
 * fills the screen, targets are 60px, there are no modals, and no tap ever
 * waits on the network.
 *
 * The write path is always: mint the uuid, queue it in IndexedDB, advance the
 * UI, then try to sync. Local state is the truth the tracker sees; the server
 * catches up. Because the uuid is generated before the request, a retry is a
 * no-op rather than a second plate appearance.
 *
 * Undo voids rather than deletes — the row survives, leaves every count, and
 * frees its pa_number so the batter can be re-recorded.
 */

const SYNCED = { tone: "ok", text: "All saved" };

/** 1st, 2nd, 3rd… for the batting position line. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function TrackerClient({ game, lineup, substitutes = [], initialRows, canWrite }) {
  const [rows, setRows] = useState(initialRows ?? []);
  /**
   * Where the order resumes.
   *
   * Previously useState(0), which restarted at the top of the lineup on every
   * mount — so reopening a partially tracked game silently re-batted the front
   * of the order. Derived once, lazily, from the at-bats already recorded.
   * initialRows is the server-rendered set, so this runs before anything is
   * displayed and costs no extra tap in the normal case.
   */
  const initialResume = useMemo(
    () => resumePosition(lineup ?? [], initialRows ?? []),
    // Mount-time only: recomputing as at-bats accumulate would fight the live
    // cursor, which advances tap by tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [cursor, setCursor] = useState(initialResume.index);
  // Exception path only. Never a silent fall back to position 1.
  const [pickBatter, setPickBatter] = useState(initialResume.ambiguous);
  const [selected, setSelected] = useState([]);
  const [sync, setSync] = useState(SYNCED);
  // Presentation only. Switching modes never creates, edits, voids or
  // renumbers a plate appearance — it changes what is rendered and whether
  // advancing the batting order implicitly creates a PA.
  const [mode, setMode] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return game.game_date && game.game_date < today ? "review" : "live";
  });
  const [correcting, setCorrecting] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(null);
  const [completedAt, setCompletedAt] = useState(game.qab_completed_at ?? null);
  const [finishing, setFinishing] = useState(null); // null | "checking" | "confirm" | "blocked"
  const [finishBlock, setFinishBlock] = useState(null);
  // Optional final score, entered in the finish confirmation.
  const [ourScore, setOurScore] = useState(game.runs_for ?? "");
  const [oppScore, setOppScore] = useState(game.runs_against ?? "");
  const [finishError, setFinishError] = useState(null);
  const [scoreNote, setScoreNote] = useState(null);

  /**
   * A game dated in the future cannot legally hold a score:
   * enforce_game_result_timing() refuses one. Tracking can still be finished,
   * so the fields are hidden rather than offered and then rejected.
   */
  const scoreAllowed = !game.game_date || game.game_date <= new Date().toISOString().slice(0, 10);
  const busy = useRef(false);

  // Local so a substitution updates the order on the field without a page
  // reload. Seeded from the server and only ever changed by a substitution.
  const [slots, setSlots] = useState(lineup ?? []);
  const [subSlot, setSubSlot] = useState(null);   // batting_order being changed
  const [subPlayer, setSubPlayer] = useState("");
  const [subError, setSubError] = useState(null);

  const order = slots;

  /**
   * Batters who have recorded plate appearances but are no longer in the
   * batting order — substituted out.
   *
   * game_lineup_slots holds who is CURRENTLY due to bat, so after a
   * substitution it no longer describes everyone who batted. Reading review
   * from the lineup alone made a substituted-out player's at-bats vanish from
   * the screen even though the rows were untouched in the database. Their
   * plate appearances are never modified; they are only rendered again.
   *
   * Deliberately excluded from `order`, which drives the live cursor: a
   * player who has left the game must not come back around to bat.
   */
  const departed = useMemo(() => {
    const inOrder = new Set(order.map((s) => s.player_id));
    const found = new Map();
    for (const r of rows) {
      if (inOrder.has(r.player_id) || found.has(r.player_id)) continue;
      found.set(r.player_id, {
        player_id: r.player_id,
        full_name: r.player?.full_name ?? "Former batter",
        jersey_number: null,
        participation: null,
        batting_order: r.batting_order ?? null,
        departed: true,
      });
    }
    return [...found.values()];
  }, [rows, order]);

  /** Everyone who batted in this game, for review and for naming. */
  const reviewOrder = useMemo(
    () =>
      [...order, ...departed].sort((a, b) => {
        const ao = a.batting_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.batting_order ?? Number.MAX_SAFE_INTEGER;
        // A substituted-out player sorts just above the batter who replaced
        // them, so the slot reads in the sequence it was actually used.
        return ao - bo || (a.departed ? -1 : 1) - (b.departed ? -1 : 1)
          || (a.full_name ?? "").localeCompare(b.full_name ?? "");
      }),
    [order, departed]
  );
  const batter = order[cursor] ?? null;

  const live = useMemo(() => rows.filter((r) => !r.voided_at), [rows]);

  const paNumberFor = useCallback(
    (playerId) =>
      live
        .filter((r) => r.player_id === playerId)
        .reduce((m, r) => Math.max(m, r.pa_number ?? 0), 0) + 1,
    [live]
  );

  const lastLive = useMemo(() => {
    const sorted = [...live].sort((a, b) => (b.localSeq ?? 0) - (a.localSeq ?? 0));
    return sorted[0] ?? null;
  }, [live]);

  const totals = useMemo(() => tallyPlateAppearances(rows), [rows]);

  const send = useCallback(async (entry) => {
    if (entry.op === "record") return recordPlateAppearance(entry.payload);
    if (entry.op === "void") return voidPlateAppearance(entry.payload);
    if (entry.op === "correct") return correctPlateAppearance(entry.payload);
    return { ok: false, error: "Unknown queued operation." };
  }, []);

  const refreshStatus = useCallback(async () => {
    const s = await queueStatus(game.id);
    if (s.waiting === 0) return setSync(SYNCED);
    if (s.failed > 0) {
      return setSync({
        tone: "bad",
        text: `Sync failed — ${s.waiting} waiting`,
        detail: s.firstError,
      });
    }
    setSync({ tone: "wait", text: `${s.waiting} waiting to sync` });
  }, [game.id]);

  const sync_ = useCallback(async () => {
    await flushQueue(send, { gameId: game.id });
    await refreshStatus();
  }, [send, game.id, refreshStatus]);

  useEffect(() => {
    refreshStatus();
    sync_();
    const on = () => sync_();
    window.addEventListener("online", on);
    const t = setInterval(sync_, 20000);
    return () => {
      window.removeEventListener("online", on);
      clearInterval(t);
    };
  }, [sync_, refreshStatus]);

  /**
   * Finishing is gated on an empty queue.
   *
   * If a plate appearance is still queued when the coach taps Finish, marking
   * the game complete would make the database reject those rows when they
   * finally sync — real at-bats lost hours later. So we flush first and refuse
   * to complete while anything is pending. This is the one tracker action that
   * legitimately requires a connection, and it says so rather than failing
   * quietly.
   */
  const startFinish = async () => {
    if (!canWrite || busy.current) return;
    setFinishing("checking");
    setFinishBlock(null);
    await flushQueue(send, { gameId: game.id });
    const s = await queueStatus(game.id);
    await refreshStatus();
    if (s.waiting > 0) {
      setFinishBlock(s.waiting);
      setFinishing("blocked");
      return;
    }
    setFinishing("confirm");
  };

  const confirmFinish = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await finishGameTracking(game.id, {
        runsFor: ourScore,
        runsAgainst: oppScore,
      });

      if (result.ok) {
        // Tracking is finished even when the score was refused, so the screen
        // always leaves the confirmation. A score that could not be stored is
        // reported afterwards rather than trapping the coach on this panel.
        setCompletedAt(result.completedAt);
        setFinishing(null);
        setFinishError(null);
        setScoreNote(result.scoreNote ?? null);
      } else {
        setFinishError(result.error);
      }
    } finally {
      busy.current = false;
    }
  };

  /**
   * Swaps the player in one batting position. Historical plate appearances are
   * untouched — they carry their own player_id and a frozen batting_order — so
   * the starter keeps every at-bat they recorded and the substitute is
   * credited only from here on.
   */
  const applySubstitution = async () => {
    if (!subPlayer || subSlot == null || busy.current) return;
    busy.current = true;
    setSubError(null);
    try {
      const result = await substitutePlayer(game.id, subSlot, subPlayer);
      if (result.ok) {
        const incoming = substitutes.find((p) => p.player_id === subPlayer);
        setSlots((prev) =>
          prev.map((s2) =>
            s2.batting_order === subSlot
              ? {
                  ...s2,
                  player_id: subPlayer,
                  full_name: incoming?.full_name ?? "Substitute",
                  jersey_number: incoming?.jersey_number ?? null,
                  participation: incoming?.participation ?? null,
                }
              : s2
          )
        );
        setSubSlot(null);
        setSubPlayer("");
      } else {
        setSubError(result.error);
      }
    } finally {
      busy.current = false;
    }
  };

  const resume = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await resumeGameTracking(game.id);
      if (result.ok) setCompletedAt(null);
    } finally {
      busy.current = false;
    }
  };

  const advance = () => setCursor((c) => (order.length ? (c + 1) % order.length : 0));

  const commit = async (reasons) => {
    if (!batter || !canWrite || busy.current) return;
    busy.current = true;
    try {
      const id = newPaId();
      const paNumber = paNumberFor(batter.player_id);
      // Captured here, at tap time, from the order currently on screen. This
      // is why an offline replay keeps the original position: the value is
      // frozen into the queued payload, not looked up when it finally syncs.
      const payload = {
        id,
        gameId: game.id,
        playerId: batter.player_id,
        paNumber,
        battingOrder: batter.batting_order ?? null,
        reasons,
      };

      setRows((r) => [
        ...r,
        {
          id,
          player_id: batter.player_id,
          pa_number: paNumber,
          batting_order: batter.batting_order ?? null,
          qab_reasons: reasons,
          is_qab: reasons.length > 0,
          voided_at: null,
          localSeq: Date.now(),
          pending: true,
        },
      ]);
      setSelected([]);
      advance();

      await enqueue({ op: "record", gameId: game.id, payload });
      await refreshStatus();
      sync_();
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    if (!lastLive || !canWrite || busy.current) return;
    busy.current = true;
    try {
      setRows((r) =>
        r.map((x) => (x.id === lastLive.id ? { ...x, voided_at: new Date().toISOString() } : x))
      );
      const idx = order.findIndex((s) => s.player_id === lastLive.player_id);
      if (idx >= 0) setCursor(idx);
      setSelected([]);

      await enqueue({ op: "void", gameId: game.id, payload: { id: lastLive.id } });
      await refreshStatus();
      sync_();
    } finally {
      busy.current = false;
    }
  };

  const removePa = async (row) => {
    if (!canWrite || busy.current) return;
    busy.current = true;
    try {
      setRows((r) =>
        r.map((x) => (x.id === row.id ? { ...x, voided_at: new Date().toISOString() } : x))
      );
      setConfirmVoid(null);
      setCorrecting(null);
      await enqueue({ op: "void", gameId: game.id, payload: { id: row.id } });
      await refreshStatus();
      sync_();
    } finally {
      busy.current = false;
    }
  };

  const applyCorrection = async (row, reasons) => {
    setRows((r) => (r.map((x) => (x.id === row.id ? { ...x, qab_reasons: reasons, is_qab: reasons.length > 0 } : x))));
    setCorrecting(null);
    await enqueue({ op: "correct", gameId: game.id, payload: { id: row.id, reasons } });
    await refreshStatus();
    sync_();
  };

  // Review mode only. A new plate appearance requires naming the player
  // explicitly; nothing is created by moving through the order.
  const addPaFor = async (slot) => {
    if (!canWrite || busy.current) return;
    busy.current = true;
    try {
      const id = newPaId();
      const paNumber = paNumberFor(slot.player_id);
      setRows((r) => [
        ...r,
        {
          id,
          player_id: slot.player_id,
          pa_number: paNumber,
          batting_order: slot.batting_order ?? null,
          qab_reasons: [],
          is_qab: false,
          voided_at: null,
          localSeq: Date.now(),
          pending: true,
        },
      ]);
      await enqueue({
        op: "record",
        gameId: game.id,
        payload: {
          id,
          gameId: game.id,
          playerId: slot.player_id,
          paNumber,
          battingOrder: slot.batting_order ?? null,
          reasons: [],
        },
      });
      await refreshStatus();
      sync_();
      setCorrecting({ id, player_id: slot.player_id, pa_number: paNumber, qab_reasons: [] });
    } finally {
      busy.current = false;
    }
  };

  const nameOf = (playerId) =>
    reviewOrder.find((s) => s.player_id === playerId)?.full_name ?? "Unknown player";

  const toggle = (key) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  if (order.length === 0) {
    return (
      <div className="trk-empty">
        <p>This game has no batting order yet.</p>
        <Link
          className="btn-primary btn-lg"
          href={`/tournaments/${game.tournament_id}/games/${game.id}/lineup`}
        >
          Set lineup
        </Link>
      </div>
    );
  }

  return (
    <div className="trk">
      <div className={`trk-sync trk-sync-${sync.tone}`}>
        <span>{sync.text}</span>
        {sync.tone === "bad" && (
          <button type="button" onClick={sync_}>
            Retry
          </button>
        )}
      </div>

      <header className="trk-head">
        <span className="trk-game">
          vs {game.opponent_name ?? "Opponent"} · {game.tournament?.name ?? "Tournament"}
        </span>
        <span className="trk-tally">
          <strong>{totals.qabPct == null ? "—" : `${totals.qabPct}%`} QAB</strong>
          <em>
            {totals.qab} of {totals.pa} PA
          </em>
        </span>
      </header>

      {/* Two views and one action. Finish sits here so game management is in
          one place, but it is deliberately NOT a third tab: it is outside the
          tablist, styled as an action, and it ends the game rather than
          changing what is on screen. */}
      <div className="trk-controls">
        <div className="trk-modes" role="tablist" aria-label="Entry mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "live"}
            className={mode === "live" ? "on" : ""}
            onClick={() => setMode("live")}
          >
            Live Tracking
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "review"}
            className={mode === "review" ? "on" : ""}
            onClick={() => setMode("review")}
          >
            Corrections
          </button>
        </div>

        {!completedAt && live.length > 0 && canWrite && finishing !== "confirm" && (
          <button
            type="button"
            className="trk-finish-top"
            onClick={startFinish}
            disabled={finishing === "checking"}
          >
            {finishing === "checking" ? "Checking…" : "Finish tracking"}
          </button>
        )}
      </div>

      {mode === "live" && live.length > 0 && (
        <p className="trk-continuing">
          This game already has {live.length} plate {live.length === 1 ? "appearance" : "appearances"}.
          Tracking continues from where each batter left off.
        </p>
      )}

      {scoreNote && <div className="notice notice-info trk-score-note">{scoreNote}</div>}

      {completedAt && (
        <section className="trk-done">
          <p className="trk-done-title">✓ QAB tracking complete</p>
          <p className="trk-done-figs">
            <strong>{totals.qab}</strong> QAB <span aria-hidden="true">/</span>{" "}
            <strong>{totals.pa}</strong> PA
            {totals.qabPct != null && <span className="trk-done-pct">{totals.qabPct}%</span>}
          </p>
          <p className="trk-done-note">
            Recorded at-bats can still be reviewed and corrected. Recording a new one needs
            tracking reopened.
          </p>
          <div className="trk-done-actions">
            <a className="btn btn-primary" href={`/performance`}>
              Back to Performance
            </a>
            <button type="button" className="btn" onClick={() => setMode("review")}>
              Corrections
            </button>
            <button type="button" className="btn" onClick={resume} disabled={!canWrite}>
              Resume tracking
            </button>
          </div>
        </section>
      )}

      {/* Exception path. The at-bats recorded so far do not identify a next
          position — a slot the lineup no longer has, an at-bat stored without
          a position, or two sharing the last timestamp. Asking costs one tap;
          guessing is what produced the out-of-sequence history in the first
          place. */}
      {mode === "live" && !completedAt && pickBatter && (
        <section className="trk-pick">
          <h2 className="trk-pick-h">Who is batting next?</h2>
          <p className="trk-pick-s">
            We couldn&rsquo;t work out where the order left off from the at-bats already
            recorded. Pick the batter and tracking continues from there.
          </p>
          <div className="trk-pick-list">
            {order.map((slot, i) => (
              <button
                key={slot.player_id}
                type="button"
                className="trk-pick-btn"
                onClick={() => { setCursor(i); setPickBatter(false); }}
              >
                <span className="trk-pick-slot">{ordinal(slot.batting_order ?? i + 1)}</span>
                <span className="trk-pick-name">{slot.full_name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {mode === "live" && !completedAt && !pickBatter && (
      <div className="trk-batter">
        <p className="trk-batter-eyebrow">Now batting</p>
        <p className="trk-name">{batter.full_name}</p>
        <p className="trk-batter-meta">
          <span>{batter.jersey_number != null ? `#${batter.jersey_number}` : "#—"}</span>
          <span aria-hidden="true">•</span>
          <span>Batting {ordinal(cursor + 1)}</span>
          <span aria-hidden="true">•</span>
          <span>PA {paNumberFor(batter.player_id)}</span>
          {batter.participation === "pickup" && <span className="tag-pickup">Pickup</span>}
        </p>
      </div>
      )}

      {mode === "live" && !completedAt && !pickBatter && (
      <section className="trk-card">
        <h2 className="trk-card-h">What made this a Quality At-Bat?</h2>
        <p className="trk-card-s">Select all that apply.</p>

        <div className="trk-reasons">
          {QAB_REASONS.map((r) => {
            const on = selected.includes(r.key);
            return (
              <button
                key={r.key}
                type="button"
                className={`trk-reason${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(r.key)}
                disabled={!canWrite}
              >
                <span className="trk-reason-check" aria-hidden="true">
                  {on ? "✓" : ""}
                </span>
                <span className="trk-reason-label">{r.label}</span>
              </button>
            );
          })}
        </div>

        <div className="trk-commit">
          <button
            type="button"
            className="trk-save"
            onClick={() => commit(selected)}
            disabled={!canWrite || selected.length === 0}
          >
            Record QAB
          </button>
          <button
            type="button"
            className="trk-noqab"
            onClick={() => commit([])}
            disabled={!canWrite}
          >
            No QAB
          </button>
        </div>
      </section>
      )}

      {mode === "live" && !completedAt && lastLive && (
        <div className="trk-last">
          <span className="trk-last-text">
            Last recorded: <strong>{nameOf(lastLive.player_id)}</strong> • PA {lastLive.pa_number}
          </span>
          <button type="button" className="trk-last-undo" onClick={undo} disabled={!canWrite}>
            Undo
          </button>
        </div>
      )}

      {/* Game management, grouped and set apart from the tap targets used on
          every pitch. Finish tracking used to sit alone directly beneath the
          reason buttons, which is where a thumb lands between at-bats. */}
      {mode === "live" && !completedAt && canWrite && order.length > 0 && (
        <div className="trk-manage">
          {subSlot == null ? (
            <button
              type="button"
              className="btn btn-secondary trk-manage-btn"
              onClick={() => { setSubSlot(order[cursor]?.batting_order ?? order[0]?.batting_order ?? 1); setSubError(null); }}
            >
              Make substitution
            </button>
          ) : (
            <div className="trk-sub">
              <p className="trk-sub-h">Make substitution</p>

              {subError && <div className="notice notice-error">{subError}</div>}

              <div className="field">
                <label htmlFor="sub-slot">Batting position</label>
                <select
                  id="sub-slot"
                  value={subSlot}
                  onChange={(e) => { setSubSlot(Number(e.target.value)); setSubError(null); }}
                >
                  {order.map((s2) => (
                    <option key={s2.batting_order} value={s2.batting_order}>
                      {ordinal(s2.batting_order)} · {s2.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="sub-player">Player coming in</label>
                <select
                  id="sub-player"
                  value={subPlayer}
                  onChange={(e) => { setSubPlayer(e.target.value); setSubError(null); }}
                >
                  <option value="">Choose a player…</option>
                  {/* Anyone already occupying a slot is excluded — the
                      database enforces UNIQUE (game_id, player_id) too.
                      Tournament-roster players are ordered first by the query. */}
                  {substitutes
                    .filter((p) => !order.some((s2) => s2.player_id === p.player_id))
                    .map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {p.jersey_number != null ? `#${p.jersey_number} ` : ""}
                        {p.full_name}
                        {p.onTournamentRoster ? "" : " · not on tournament roster"}
                      </option>
                    ))}
                </select>
              </div>

              <p className="trk-sub-note">
                At-bats already recorded stay with the player who batted. The substitute is
                credited from their next plate appearance.
              </p>

              <div className="trk-sub-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={applySubstitution}
                  disabled={!subPlayer}
                >
                  Confirm substitution
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setSubSlot(null); setSubPlayer(""); setSubError(null); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!completedAt && live.length > 0 && canWrite && (
        <div className="trk-finish">
          {finishing === "confirm" ? (
            <div className="trk-finish-confirm">
              <p className="trk-finish-q">Finish QAB tracking?</p>
              <p className="trk-finish-figs">
                {totals.pa} plate {totals.pa === 1 ? "appearance" : "appearances"} ·{" "}
                {totals.qab} Quality At-{totals.qab === 1 ? "Bat" : "Bats"}
                {totals.qabPct != null && ` · ${totals.qabPct}% QAB`}
              </p>
              {finishError && <div className="notice notice-error">{finishError}</div>}

              {/* Optional. Win, loss or tie is derived by the database from
                  these two numbers — there is no separate result field to keep
                  in step, and leaving them blank finishes tracking anyway. */}
              {!scoreAllowed && (
                <p className="trk-finish-note">
                  This game is scheduled for a later date, so a score can&rsquo;t be recorded yet.
                  Finishing tracking still works — add the score from the game once it&rsquo;s
                  played.
                </p>
              )}

              {scoreAllowed && (
              <div className="trk-finish-score">
                <div className="field">
                  <label htmlFor="fin-us">Our score</label>
                  <input
                    id="fin-us"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="—"
                    value={ourScore}
                    onChange={(e) => { setOurScore(e.target.value); setFinishError(null); }}
                  />
                </div>
                <div className="field">
                  <label htmlFor="fin-them">Opponent score</label>
                  <input
                    id="fin-them"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="—"
                    value={oppScore}
                    onChange={(e) => { setOppScore(e.target.value); setFinishError(null); }}
                  />
                </div>
              </div>
              )}
              <p className="trk-finish-note">
                {scoreAllowed
                  ? "Score is optional — you can add it later from the game. "
                  : ""}
                You can still review and correct these at-bats afterward.
              </p>
              <div className="trk-finish-actions">
                <button type="button" className="btn btn-primary" onClick={confirmFinish}>
                  Finish tracking
                </button>
                <button type="button" className="btn" onClick={() => setFinishing(null)}>
                  Keep tracking
                </button>
              </div>
            </div>
          ) : finishing === "blocked" ? (
            <div className="trk-finish-blocked">
              <p>
                {finishBlock
                  ? `${finishBlock} at-${finishBlock === 1 ? "bat is" : "bats are"} still waiting to sync. They'll save when you're back online — finish tracking after that.`
                  : "Couldn't finish tracking just now. Check your connection and try again."}
              </p>
              <button type="button" className="btn" onClick={startFinish}>
                Try again
              </button>
            </div>
          ) : null}
        </div>
      )}

      {mode === "review" ? (
        <section className="trk-review">
          <h2 className="trk-history-h">
            Recorded plate appearances <span>({live.length})</span>
          </h2>
          <p className="trk-card-s">
            Nothing is added automatically here. Use “+ Add plate appearance” for a batter.
          </p>

          {reviewOrder.map((slot, i) => {
            const paRows = live
              .filter((r) => r.player_id === slot.player_id)
              .sort((a, b) => a.pa_number - b.pa_number);

            return (
              <div className="trk-player" key={slot.player_id}>
                <div className="trk-player-head">
                  <span className="trk-player-slot">{slot.batting_order ?? i + 1}</span>
                  <span className="trk-player-name">{slot.full_name}</span>
                  {slot.departed && <span className="tag-pickup">Subbed out</span>}
                  <span className="trk-player-jersey">
                    {slot.jersey_number != null ? `#${slot.jersey_number}` : "#—"}
                  </span>
                  {slot.participation === "pickup" && <span className="tag-pickup">Pickup</span>}
                  <span className="trk-player-count">
                    {paRows.length} {paRows.length === 1 ? "PA" : "PA"}
                  </span>
                </div>

                {paRows.length === 0 ? (
                  <p className="trk-player-none">No plate appearances recorded.</p>
                ) : (
                  <ul className="trk-pa-list">
                    {paRows.map((r) => (
                      <li key={r.id}>
                        <div className="trk-pa-row">
                          <span className="trk-pa-num">PA {r.pa_number}</span>
                          <span className="trk-pa-reasons">
                            {r.is_qab ? r.qab_reasons.map(reasonLabel).join(" • ") : "—"}
                          </span>
                          <span className={`trk-badge${r.is_qab ? " qab" : ""}`}>
                            {r.is_qab ? "QAB" : "No QAB"}
                          </span>
                          <span className="trk-pa-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmVoid(null);
                                setCorrecting(correcting?.id === r.id ? null : r);
                              }}
                              disabled={!canWrite}
                            >
                              {correcting?.id === r.id ? "Close" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="trk-pa-remove"
                              onClick={() => {
                                setCorrecting(null);
                                setConfirmVoid(confirmVoid?.id === r.id ? null : r);
                              }}
                              disabled={!canWrite}
                            >
                              Remove
                            </button>
                          </span>
                        </div>

                        {confirmVoid?.id === r.id && (
                          <div className="trk-confirm">
                            <p>
                              Remove <strong>{slot.full_name}</strong> PA {r.pa_number}? It will no
                              longer count in this game’s plate appearance or QAB statistics. The
                              record is kept, not deleted.
                            </p>
                            <div className="trk-confirm-actions">
                              <button
                                type="button"
                                className="trk-confirm-yes"
                                onClick={() => removePa(r)}
                              >
                                Remove PA
                              </button>
                              <button type="button" onClick={() => setConfirmVoid(null)}>
                                Keep it
                              </button>
                            </div>
                          </div>
                        )}

                        {correcting?.id === r.id && (
                          <InlineCorrection
                            row={r}
                            name={slot.full_name}
                            onCancel={() => setCorrecting(null)}
                            onApply={(reasons) => applyCorrection(r, reasons)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {completedAt ? (
                  <p className="trk-add-locked">
                    Tracking complete — resume to add a plate appearance.
                  </p>
                ) : (
                  <button
                    type="button"
                    className="trk-add-pa"
                    onClick={() => addPaFor(slot)}
                    disabled={!canWrite}
                  >
                    + Add plate appearance
                  </button>
                )}
              </div>
            );
          })}
        </section>
      ) : (
      <section className="trk-history">
        <h2 className="trk-history-h">This game <span>({live.length} PA)</span></h2>
        {live.length === 0 ? (
          <p className="trk-none">No plate appearances recorded yet.</p>
        ) : (
          <ul>
            {[...live]
              .sort((a, b) => (b.localSeq ?? 0) - (a.localSeq ?? 0))
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="trk-hist"
                    onClick={() => setMode("review")}
                    disabled={!canWrite}
                  >
                    <span className="trk-hist-top">
                      <span className="trk-hist-name">{nameOf(r.player_id)}</span>
                      <span className="trk-hist-pa">PA {r.pa_number}</span>
                      <span className={`trk-badge${r.is_qab ? " qab" : ""}`}>
                        {r.is_qab ? "QAB" : "No QAB"}
                      </span>
                    </span>
                    {r.is_qab && (
                      <span className="trk-hist-reasons">
                        {r.qab_reasons.map(reasonLabel).join(" • ")}
                      </span>
                    )}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      )}


    </div>
  );
}

/**
 * Correction is an inline panel, not a modal. A tracker who opens it by mistake
 * must be able to get out with one tap and without losing the live screen.
 */
function InlineCorrection({ row, name, onCancel, onApply }) {
  const [reasons, setReasons] = useState(row.qab_reasons ?? []);
  const toggle = (key) =>
    setReasons((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  return (
    <div className="trk-card trk-correct">
      <h2 className="trk-card-h">
        Correct {name} · PA {row.pa_number}
      </h2>
      <p className="trk-prompt-s">Select all that apply. Several reasons still count as one QAB.</p>
      <div className="trk-reasons">
        {QAB_REASONS.map((r) => {
          const on = reasons.includes(r.key);
          return (
            <button
              key={r.key}
              type="button"
              className={`trk-reason${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(r.key)}
            >
              <span className="trk-reason-check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
              <span className="trk-reason-label">{r.label}</span>
            </button>
          );
        })}
      </div>
      <div className="trk-commit">
        <button type="button" className="trk-save" onClick={() => onApply(reasons)}>
          Save correction
        </button>
        <button type="button" className="trk-noqab" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="trk-hint">
        Clearing every reason records this as an explicit non-QAB. It stays a plate appearance.
      </p>
    </div>
  );
}
