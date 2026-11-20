"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextHelp } from "./ContextHelp";
import Link from "next/link";
import {
  QAB_REASONS, reasonLabel, tallyPlateAppearances,
  MAX_NOTE_LENGTH, NOTE_TOO_LONG_ERROR, normalizeNote, noteLength, sameNote,
} from "../lib/qab-rules";
import { scoreEntry, formatFinalScore } from "../lib/game-rules";
import {
  recordPlateAppearance,
  voidPlateAppearance,
  correctPlateAppearance,
} from "../lib/actions/plate-appearances";
import {
  enqueue,
  flushQueue,
  queueStatus,
  isFlushing,
  clearBackoff,
  newPaId,
  reviewGroups,
  discardEntries,
  adoptForRetry,
} from "../lib/offline-queue";
import { savedInSlot } from "../lib/queue-recovery";
import { syncDisplay, blocksFinish } from "../lib/sync-status";
import { finishGameTracking, resumeGameTracking } from "../lib/actions/games";
import { substitutePlayer } from "../lib/actions/lineup";
import { resumePosition, defaultTrackerMode } from "../lib/tracker-cursor";
import { localDateIso, utcDateIso } from "../lib/local-date";
import { GameLink } from "./GameLink";
import { useSessionDismiss } from "../lib/useSessionDismiss";
import { nextGameAfter, gameNumber, nextGameLabel, gameStep, gameHref } from "../lib/game-flow-rules";

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

/** 1st, 2nd, 3rd… for the batting position line. */
function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function TrackerClient({ game, lineup, substitutes = [], initialRows, canWrite, userId = null, serverToday, tournamentGames = [] }) {
  const [rows, setRows] = useState(initialRows ?? []);
  // "Next game" offer after finishing (Release 2). "Not now" lasts for the
  // browser session. The offer never navigates by itself.
  const [nextDismissed, dismissNext, nextReady] = useSessionDismiss("next", game.id);
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
  // Optional plate appearance note (2026-11): context only, never counted.
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const noteTooLong = noteLength(note.trim()) > MAX_NOTE_LENGTH;
  // IMP-001: the status line is derived, never stored. "checked" flips only
  // after a successful read of the queue, so a phone that has not looked yet
  // (or could not look) never says "All saved".
  const [queueState, setQueueState] = useState(null);
  const [checked, setChecked] = useState(false);
  const [flushing, setFlushing] = useState(false);
  // Browser-reported connection (2026-11-19). It only changes what the status
  // line says; recording, the queue and syncing do not read it. A phone can
  // report online with no signal, so queue failures still show as they did.
  const [online, setOnline] = useState(true);
  // Presentation only. Switching modes never creates, edits, voids or
  // renumbers a plate appearance — it changes what is rendered and whether
  // advancing the batting order implicitly creates a PA.
  // The first render uses the server's date so it matches the HTML the server
  // sent; once mounted, the device's own date decides the default tab (a game
  // today must open live in the evening too). Only a tab nobody has touched
  // is changed.
  const firstMode = useRef(null);
  const [mode, setMode] = useState(() => {
    firstMode.current = defaultTrackerMode(game.game_date, serverToday ?? utcDateIso());
    return firstMode.current;
  });
  useEffect(() => {
    const local = defaultTrackerMode(game.game_date, localDateIso());
    setMode((cur) => (cur === firstMode.current ? local : cur));
  }, [game.game_date]);
  const [correcting, setCorrecting] = useState(null);
  const [confirmVoid, setConfirmVoid] = useState(null);
  const [completedAt, setCompletedAt] = useState(game.qab_completed_at ?? null);
  const [finishing, setFinishing] = useState(null); // null | "checking" | "confirm" | "blocked"
  // Where to bring the coach after a tap that changes what is on screen
  // (2026-11). Presentation only: {to, n} is read by one effect and nothing
  // else, so it never touches recording, lineup rules or the offline queue.
  const [scrollTo_, setScrollTo] = useState(null);
  const goTo = (to) => setScrollTo((c) => ({ to, n: (c?.n ?? 0) + 1 }));
  const [finishBlock, setFinishBlock] = useState(null);
  // Queued writes the database will never accept, awaiting the coach (ST-022).
  const [review, setReview] = useState([]);
  // Optional final score, entered in the finish confirmation.
  const [ourScore, setOurScore] = useState(game.runs_for ?? "");
  const [oppScore, setOppScore] = useState(game.runs_against ?? "");
  const [finishError, setFinishError] = useState(null);
  const [scoreNote, setScoreNote] = useState(null);
  // The game's final score as stored, shown on the completed state. Seeded
  // from the game; updated from the server's answer when a finish saves one.
  const [finalScore, setFinalScore] = useState({
    runsFor: game.runs_for ?? null,
    runsAgainst: game.runs_against ?? null,
    result: game.result ?? null,
  });

  /**
   * A game dated in the future cannot legally hold a score:
   * enforce_game_result_timing() refuses one. Tracking can still be finished,
   * so the fields are hidden rather than offered and then rejected.
   */
  const scoreAllowed = !game.game_date || game.game_date <= new Date().toISOString().slice(0, 10);
  // What the coach has typed in the finish panel: blank | partial | invalid | complete.
  const entry = scoreEntry(ourScore, oppScore);
  useEffect(() => {
    if (!scrollTo_) return;
    const { to } = scrollTo_;
    if (to === "top") {
      window.scrollTo(0, 0);
      return;
    }
    const el = document.querySelector(to);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    if (to === ".trk-finish-panel") {
      // The page header and the pinned Now batting card both sit over the top
      // of the screen, and their height changes with the phone, the batter's
      // name and the safe area. Measure what is actually covering the top
      // and leave the form's heading clear of it.
      const card = document.querySelector(".trk-batter");
      const covered = card ? card.getBoundingClientRect().bottom : 0;
      const gap = el.getBoundingClientRect().top - (covered + 12);
      if (gap < 0) window.scrollBy(0, gap);
      el.focus({ preventScroll: true });
    }
  }, [scrollTo_]);
  const busy = useRef(false);
  // Brief "your tap registered" state after a record. Presentation only: the
  // ref also holds the buttons for that moment so a second tap on the same
  // batter cannot record twice. It never touches the queue or the payload.
  const settling = useRef(false);
  const settleTimer = useRef(null);
  const [justRecorded, setJustRecorded] = useState(null); // "noqab" | "qab" | null
  useEffect(() => () => clearTimeout(settleTimer.current), []);

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

  // Saved rows as the server last reported them — never the optimistic ones —
  // so a queued write is only ever compared with what is really stored.
  const savedRows = useMemo(() => rows.filter((r) => !r.pending), [rows]);

  const refreshStatus = useCallback(async () => {
    const s = await queueStatus(game.id, userId);
    setQueueState(s);
    if (s.readable) {
      setChecked(true);
      try { setReview(await reviewGroups(game.id, userId)); } catch { /* the status line already says what it can */ }
    }
    return s;
  }, [game.id, userId]);

  const sync_ = useCallback(async (force = false) => {
    // Show "Syncing N" only while a pass is really sending something.
    const before = await queueStatus(game.id, userId);
    if (before.readable && before.waiting > 0) setFlushing(true);
    try {
      await flushQueue(send, { gameId: game.id, userId, savedRows, force: force === true });
    } finally {
      setFlushing(isFlushing());
    }
    await refreshStatus();
  }, [send, game.id, userId, savedRows, refreshStatus]);

  useEffect(() => {
    refreshStatus();
    sync_();
    // Reconnecting, or coming back to the app, drops the wait that was earned
    // while there was no signal and sends now (IMP-001). Still one pass at a
    // time, still in order; attempt counts are kept.
    const resumeNow = async () => {
      await clearBackoff(game.id);
      sync_();
    };
    const onVisible = () => { if (document.visibilityState === "visible") resumeNow(); };
    window.addEventListener("online", resumeNow);
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(sync_, 20000);
    return () => {
      window.removeEventListener("online", resumeNow);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [sync_, refreshStatus, game.id]);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // What the status line shows: one tested definition (lib/sync-status.js).
  const shownSync = syncDisplay({
    checked,
    status: queueState,
    flushingCount: flushing && queueState?.readable ? queueState.waiting : 0,
    online,
  });
  const sync = shownSync;

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
    // The confirmation lives in Live Tracking; from Edit at-bats there would
    // be nothing to see, so the screen switches first.
    setMode("live");
    setFinishing("checking");
    setFinishBlock(null);
    await flushQueue(send, { gameId: game.id, userId, savedRows, force: true });
    const s = await queueStatus(game.id, userId);
    await refreshStatus();
    // Nothing finishes while QAB data is unsynced or unresolved — but the
    // coach is told which, because "waiting to sync" is the wrong advice for
    // a write that needs a decision.
    if (blocksFinish(s)) {
      setFinishBlock(s);
      setFinishing("blocked");
      goTo(".trk-finish-panel");
      return;
    }
    setFinishing("confirm");
    goTo(".trk-finish-panel");
  };

  /**
   * Finish. withScore=false is the coach's explicit "Finish without a score":
   * nothing is sent for the score, so an existing score is left as it is.
   */
  const confirmFinish = async (withScore) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await finishGameTracking(
        game.id,
        withScore ? { runsFor: ourScore, runsAgainst: oppScore } : null
      );

      if (result.ok) {
        // Tracking is finished even when the score was refused, so the screen
        // always leaves the confirmation. A score that could not be stored is
        // reported afterwards rather than trapping the coach on this panel.
        setCompletedAt(result.completedAt);
        // Only a score the server actually saved replaces what is shown;
        // finishing without one never clears a score the game already had.
        if (result.runsFor != null && result.runsAgainst != null) {
          setFinalScore({ runsFor: result.runsFor, runsAgainst: result.runsAgainst, result: result.result ?? null });
        }
        setFinishing(null);
        setFinishError(null);
        setScoreNote(result.scoreNote ?? null);
        // The results card is at the top; the button that was tapped is not.
        goTo("top");
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
      if (result.ok) {
        setCompletedAt(null);
        // Resume means live entry, with the current batter in view.
        setMode("live");
        goTo("top");
      }
    } finally {
      busy.current = false;
    }
  };

  const advance = () => setCursor((c) => (order.length ? (c + 1) % order.length : 0));

  const commit = async (reasons) => {
    if (!batter || !canWrite || busy.current || settling.current || noteTooLong) return;
    busy.current = true;
    settling.current = true;
    setJustRecorded(reasons.length === 0 ? "noqab" : "qab");
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settling.current = false;
      setJustRecorded(null);
    }, 800);
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
        notes: normalizeNote(note),
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
          notes: payload.notes,
          voided_at: null,
          localSeq: Date.now(),
          pending: true,
        },
      ]);
      setSelected([]);
      setNote("");
      setNoteOpen(false);
      advance();

      await enqueue({ userId, op: "record", gameId: game.id, payload });
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

      await enqueue({ userId, op: "void", gameId: game.id, payload: { id: lastLive.id } });
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
      await enqueue({ userId, op: "void", gameId: game.id, payload: { id: row.id } });
      await refreshStatus();
      sync_();
    } finally {
      busy.current = false;
    }
  };

  const applyCorrection = async (row, reasons, nextNote) => {
    // The note is sent only when it changed, so a reason correction can never
    // touch it — and a note edit never needs the reason to change.
    const noteChanged = nextNote !== undefined && !sameNote(row.notes, nextNote);
    const notes = noteChanged ? normalizeNote(nextNote) : undefined;
    setRows((r) => (r.map((x) => (x.id === row.id
      ? { ...x, qab_reasons: reasons, is_qab: reasons.length > 0, ...(noteChanged ? { notes } : {}) }
      : x))));
    setCorrecting(null);
    await enqueue({
      userId, op: "correct", gameId: game.id,
      payload: noteChanged ? { id: row.id, reasons, notes } : { id: row.id, reasons },
    });
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
        userId,
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

  // One primary reason (2026-11). Choosing a reason replaces any earlier
  // choice; it never adds a second. Recording stays two steps: choose, then
  // Record QAB. "No QAB" still records with no reason in one tap.
  const choose = (key) => setSelected([key]);

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
      <div
        className={`trk-sync trk-sync-${shownSync.tone}`}
        role={shownSync.tone === "bad" ? "alert" : "status"}
      >
        <span>{shownSync.text}</span>
        {/* Retry only helps a write that can still go through; an at-bat
            awaiting review needs the decision below instead. */}
        {sync.retry && (
          <button type="button" onClick={() => sync_(true)}>
            Retry
          </button>
        )}
      </div>

      {review.length > 0 && (
        <QueueReview
          groups={review}
          rows={rows}
          nameOf={nameOf}
          canWrite={canWrite}
          onKeepSaved={async (g) => {
            await discardEntries(g.group.map((e) => e.seq), "kept_saved");
            await refreshStatus();
          }}
          onUseUnsynced={async (g, saved) => {
            const reasons = g.head.payload?.reasons ?? [];
            // The unsynced entry as a whole — reason and note — replaces what
            // is saved. A correction of the plate appearance that is already
            // saved — never a second plate appearance in the same slot.
            const notes = normalizeNote(g.head.payload?.notes);
            await enqueue({
              userId,
              op: "correct",
              gameId: game.id,
              payload: { id: saved.id, reasons, notes, expectedUpdatedAt: saved.updatedAt ?? null },
            });
            await discardEntries(g.group.map((e) => e.seq), "used_unsynced");
            setRows((r) => r.map((x) => (x.id === saved.id ? { ...x, qab_reasons: reasons, is_qab: reasons.length > 0, notes } : x)));
            await sync_(true);
          }}
          onRetry={async (g) => {
            await adoptForRetry(g.group.map((e) => e.seq), userId);
            await sync_(true);
          }}
          onDiscard={async (g) => {
            await discardEntries(g.group.map((e) => e.seq), "discarded");
            await refreshStatus();
          }}
        />
      )}

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

      {/* H3: a small "Need help?" that opens help IN PLACE while tracking, so
          the coach never leaves the game. No buttons that navigate away, and
          answers worded for someone already in the tracker. (2026-11) */}
      {mode === "live" && (
        <ContextHelp
          label="Need help?"
          align="end"
          title="Tracking help"
          context="tracker-live"
          questions={[
            { id: "qab-what-counts" },
            { id: "qab-after-game", ask: "Can I enter this after the game?" },
            { id: "qab-note", ask: "Can I add a note?" },
            { id: "qab-fix", ask: "What if I chose the wrong batter?" },
          ]}
          actions={false}
        />
      )}

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
            onClick={() => { setMode("live"); goTo("top"); }}
          >
            Live Tracking
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "review"}
            className={mode === "review" ? "on" : ""}
            onClick={() => { setMode("review"); goTo(".trk-review"); }}
          >
            Edit at-bats
          </button>
        </div>

        {!completedAt && live.length > 0 && canWrite && !(mode === "live" && finishing === "confirm") && (
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

      {/* Only while tracking is open (Release 3): a completed game says it is
          complete below, and the two must never contradict each other. */}
      {mode === "live" && !completedAt && live.length > 0 && (
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
          {formatFinalScore(finalScore.runsFor, finalScore.runsAgainst, finalScore.result) ? (
            <p className="trk-done-score">
              Final score <strong>{formatFinalScore(finalScore.runsFor, finalScore.runsAgainst, finalScore.result)}</strong>
            </p>
          ) : finalScore.result ? null : (
            scoreAllowed && (
              <p className="trk-done-noscore">
                No final score yet. Add it from Performance when the game is over.
              </p>
            )
          )}
          <p className="trk-done-note">
            You can edit or remove recorded at-bats anytime. To add a missed at-bat, resume
            tracking first.
          </p>
          {(() => {
            // Computed here, after finishing, from the device date. Only the
            // coaches who can act on it see it.
            const next = canWrite && nextReady && !nextDismissed ? nextGameAfter(tournamentGames, game.id, localDateIso()) : null;
            const step = next ? gameStep(next) : null;
            if (!next || !step) return null;
            return (
              <div className="trk-next" role="region" aria-label="Next game">
                <div className="trk-next-body">
                  <p className="trk-next-k">Next game</p>
                  <p className="trk-next-t">
                    {nextGameLabel(next, gameNumber(tournamentGames, next.id), localDateIso())}
                    {next.opponent_name ? ` vs ${next.opponent_name}` : ""}
                  </p>
                </div>
                <div className="trk-next-acts">
                  <GameLink className="btn btn-secondary" href={gameHref(game.tournament_id, next.id, step.route)}>
                    {step.label}
                  </GameLink>
                  <button type="button" className="btn btn-ghost" onClick={dismissNext}>
                    Not now
                  </button>
                </div>
              </div>
            );
          })()}
          <div className="trk-done-actions">
            {/* Returns to the same tournament on Performance (2026-11). */}
            <a className="btn btn-primary" href={`/performance?tournament=${encodeURIComponent(game.tournament_id)}`}>
              Back to Performance
            </a>
            <button type="button" className="btn" onClick={() => { setMode("review"); goTo(".trk-review"); }}>
              Edit at-bats
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
        <h2 className="trk-card-h" id="trk-reason-h">What made this a Quality At-Bat?</h2>
        <p className="trk-card-s">Choose the one primary reason.</p>

        <div className="trk-reasons" role="radiogroup" aria-labelledby="trk-reason-h">
          {QAB_REASONS.map((r) => {
            const on = selected[0] === r.key;
            return (
              <button
                key={r.key}
                type="button"
                role="radio"
                className={`trk-reason${on ? " on" : ""}`}
                aria-checked={on}
                onClick={() => choose(r.key)}
                disabled={!canWrite}
              >
                <span className="trk-reason-check trk-reason-radio" aria-hidden="true" />
                <span className="trk-reason-label">{r.label}</span>
              </button>
            );
          })}
        </div>

        <NoteField
          id="trk-note-live"
          value={note}
          open={noteOpen}
          onOpen={() => setNoteOpen(true)}
          onChange={setNote}
          disabled={!canWrite}
        />

        <div className="trk-commit">
          <button
            type="button"
            className="trk-save"
            onClick={() => commit(selected)}
            disabled={!canWrite || selected.length === 0 || noteTooLong}
            aria-describedby={canWrite && selected.length === 0 ? "trk-save-hint" : undefined}
          >
            Record QAB
          </button>
          <button
            type="button"
            className={`trk-noqab${justRecorded === "noqab" ? " is-recorded" : ""}`}
            onClick={() => commit([])}
            disabled={!canWrite || noteTooLong}
            aria-disabled={justRecorded ? "true" : undefined}
          >
            {justRecorded === "noqab" && <span className="trk-noqab-check" aria-hidden="true">✓</span>}
            No QAB
          </button>
          <span className="visually-hidden" role="status">
            {justRecorded === "noqab" ? "No QAB recorded" : ""}
          </span>
        </div>
        {/* The line keeps its space once a reason is chosen, so nothing below
            it moves in the middle of a game. */}
        {canWrite && (
          <p className="trk-save-hint" id="trk-save-hint">
            {selected.length === 0 ? "Choose a reason first" : "\u00a0"}
          </p>
        )}
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

      {mode === "live" && !completedAt && live.length > 0 && canWrite && (
        <div className="trk-finish trk-finish-panel" tabIndex={-1}>
          {finishing === "confirm" ? (
            <div className="trk-finish-confirm">
              <p className="trk-finish-q">Finish QAB tracking?</p>
              <p className="trk-finish-figs">
                {totals.pa} plate {totals.pa === 1 ? "appearance" : "appearances"} ·{" "}
                {totals.qab} Quality At-{totals.qab === 1 ? "Bat" : "Bats"}
                {totals.qabPct != null && ` · ${totals.qabPct}% QAB`}
              </p>
              {finishError && <div className="notice notice-error">{finishError}</div>}

              {/* The final score is asked for, not required. Win, loss or tie
                  is derived by the database from the two numbers. Finishing
                  without a score is an explicit choice, not the default. */}
              {!scoreAllowed && (
                <p className="trk-finish-note">
                  This game is scheduled for a later date, so a score can&rsquo;t be recorded yet.
                  Finishing tracking still works — add the score from Performance once it&rsquo;s
                  played.
                </p>
              )}

              {scoreAllowed && (
                <>
                  <p className="trk-finish-ask" id="fin-ask">
                    If the game is over, enter the final score.
                  </p>
                  <div className="trk-finish-score" role="group" aria-labelledby="fin-ask">
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
                  {entry.state === "partial" && (
                    <p className="trk-finish-hint" role="status">Enter both scores, or clear both.</p>
                  )}
                  {entry.state === "invalid" && (
                    <p className="trk-finish-hint" role="status">Scores are whole numbers of runs.</p>
                  )}
                </>
              )}

              <div className="trk-finish-actions">
                {!scoreAllowed ? (
                  <button type="button" className="btn btn-primary" onClick={() => confirmFinish(false)}>
                    Finish tracking
                  </button>
                ) : entry.state === "blank" ? (
                  /* Both blank: finishing without a score is the explicit,
                     labelled choice — one tap, no second warning. */
                  <button type="button" className="btn trk-finish-noscore" onClick={() => confirmFinish(false)}>
                    Finish without a score
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => confirmFinish(true)}
                    disabled={entry.state !== "complete"}
                  >
                    Save score and finish
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setFinishing(null)}>
                  Keep tracking
                </button>
              </div>
              <p className="trk-finish-note">
                {scoreAllowed && entry.state === "blank"
                  ? "You can add the score later from Performance. "
                  : ""}
                You can still review and correct these at-bats afterward.
              </p>
            </div>
          ) : finishing === "blocked" ? (
            <div className="trk-finish-blocked">
              <p>
                {finishBlockText(finishBlock)}
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
          {/* H3: Review & Edit questions, answered in place (2026-11). */}
          <ContextHelp
            label="Need help?"
            context="tracker-review"
            questions={[
              { id: "qab-fix", ask: "How do I fix the wrong batter?" },
              { id: "qab-reason-change", ask: "Can I change a QAB reason?" },
              { id: "qab-note", ask: "Can I edit a note?" },
            ]}
            actions={false}
          />
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

                        {r.notes && <p className="trk-pa-note">{r.notes}</p>}

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
                            onApply={(reasons, nextNote) => applyCorrection(r, reasons, nextNote)}
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
          <>
          {/* One grid for every row: Player | PA | QAB result. The PA and result
              columns are fixed, so a long name wraps inside its own column and
              never moves the labels beside it. */}
          <div className="trk-hist-cols" aria-hidden="true">
            <span>Player</span>
            <span>PA</span>
            <span>QAB result</span>
          </div>
          <ul>
            {[...live]
              .sort((a, b) => (b.localSeq ?? 0) - (a.localSeq ?? 0))
              .map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="trk-hist"
                    onClick={() => { setMode("review"); goTo(".trk-review"); }}
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
                    {r.notes && <span className="trk-hist-note">{r.notes}</span>}
                  </button>
                </li>
              ))}
          </ul>
          </>
        )}
      </section>
      )}


    </div>
  );
}

/** Finish-gate message for what is still outstanding (ST-022). */
function finishBlockText(s) {
  if (!s) return "Couldn't finish tracking just now. Check your connection and try again.";
  if (s.readable === false) return "This phone could not confirm what is saved, so tracking can't be finished yet. Try again in a moment.";
  if (s.review > 0) {
    return `${s.review} at-${s.review === 1 ? "bat needs" : "bats need"} your review before tracking can finish. Choose what to keep above.`;
  }
  if (s.other > 0) {
    return `${s.other} at-${s.other === 1 ? "bat was" : "bats were"} recorded on this device by another account and ${s.other === 1 ? "hasn't" : "haven't"} synced. Sign in as that account to sync ${s.other === 1 ? "it" : "them"}, then finish tracking.`;
  }
  return `${s.waiting} at-${s.waiting === 1 ? "bat is" : "bats are"} still waiting to sync. They'll save when you're back online — finish tracking after that.`;
}

const reasonText = (reasons) => (reasons?.length ? reasons.map(reasonLabel).join(" • ") : "Not a QAB");

const REVIEW_MESSAGE = {
  game_complete: "Tracking for this game was finished before this was saved. Resume tracking, then try again.",
  past_season: "This season is read-only, so this can't be saved.",
  not_allowed: "Your account can't save this.",
  not_found: "The at-bat this changes no longer exists.",
  stale: "The saved at-bat changed after this was entered.",
  invalid: "This entry can't be saved as it is.",
};

/**
 * Needs review (ST-022): queued QAB writes the database will never accept,
 * one card each, with the decision the coach has to make. Nothing here is
 * removed without a tap, and anything removed goes to the local discarded log.
 */
const sameReasonsText = (a, b) => reasonText(a) === reasonText(b);

function QueueReview({ groups, rows, nameOf, canWrite, onKeepSaved, onUseUnsynced, onRetry, onDiscard }) {
  const [busy, setBusy] = useState(false);
  const act = (fn) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  const savedRows = rows.filter((r) => !r.pending);

  return (
    <section className="trk-review-q" aria-labelledby="trk-review-q-h">
      <h2 className="trk-review-q-h" id="trk-review-q-h">
        {groups.length === 1 ? "1 at-bat needs your review" : `${groups.length} at-bats need your review`}
      </h2>
      <ul className="trk-review-q-list">
        {groups.map((g) => {
          const { head } = g;
          const p = head.payload ?? {};
          const target = head.op === "record" ? null : rows.find((r) => r.id === p.id);
          const playerId = head.op === "record" ? p.playerId : target?.player_id;
          const paNumber = head.op === "record" ? p.paNumber : target?.pa_number;
          const heading = `${nameOf(playerId)} · PA ${paNumber ?? "?"}`;

          const fromServer = head.conflict
            ? { id: head.conflict.id, reasons: head.conflict.reasons, notes: head.conflict.notes ?? null, updatedAt: head.conflict.updatedAt }
            : null;
          const local = savedInSlot(head, savedRows);
          const saved = fromServer ?? (local ? { id: local.id, reasons: local.qab_reasons ?? [], notes: local.notes ?? null, updatedAt: local.updated_at } : null);
          // Notes that differ are shown side by side; neither is ever dropped
          // without the coach choosing.
          const notesDiffer = Boolean(saved) && head.op === "record" && !sameNote(saved.notes, p.notes);
          const conflict = head.op === "record" && saved;
          const unsynced =
            head.op === "void" ? "Remove this at-bat" : reasonText(p.reasons);
          const canUse = conflict && g.group.length === 1;

          return (
            <li key={head.seq} className="trk-review-q-item">
              <p className="trk-review-q-name">{heading}</p>
              {conflict ? (
                <dl className="trk-review-q-cmp">
                  <div><dt>Saved</dt><dd>{reasonText(saved.reasons)}</dd></div>
                  <div><dt>Unsynced</dt><dd>{unsynced}</dd></div>
                  {notesDiffer && (
                    <>
                      <div><dt>Saved note</dt><dd>{normalizeNote(saved.notes) ?? "No note"}</dd></div>
                      <div><dt>Unsynced note</dt><dd>{normalizeNote(p.notes) ?? "No note"}</dd></div>
                    </>
                  )}
                </dl>
              ) : (
                <>
                  <dl className="trk-review-q-cmp">
                    <div><dt>Unsynced</dt><dd>{head.op === "correct" ? `Change to ${unsynced}` : unsynced}</dd></div>
                  </dl>
                  <p className="trk-review-q-why">
                    {head.code === "unconfirmed"
                      ? "Entered on this device before an update and not saved yet."
                      : REVIEW_MESSAGE[head.code] ?? head.lastError ?? "This couldn't be saved."}
                  </p>
                </>
              )}
              {g.group.length > 1 && (
                <p className="trk-review-q-why">
                  {g.group.length - 1} later {g.group.length === 2 ? "change depends" : "changes depend"} on this one and will be handled with it.
                </p>
              )}
              {canWrite && (
                <div className="trk-review-q-actions">
                  {conflict ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={act(() => onKeepSaved(g))}>
                        Keep saved
                      </button>
                      {canUse && (
                        <button type="button" className="btn" disabled={busy} onClick={act(() => onUseUnsynced(g, saved))}>
                          {notesDiffer && sameReasonsText(saved.reasons, p.reasons) ? "Use unsynced note" : <>Use {unsynced}</>}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={act(() => onRetry(g))}>
                        {head.code === "unconfirmed" ? "Save" : "Try again"}
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={act(() => onDiscard(g))}>
                        Discard
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Optional plate appearance note (2026-11). A quiet "+ Add note" until
 * opened, so it stays secondary to the reason. Context only: nothing that
 * counts QABs, results or records reads it.
 */
/**
 * Opening the on-screen keyboard shrinks the page above it. The Record and No
 * QAB buttons sit under the note, so once the keyboard has settled they are
 * brought back above the bottom navigation. Scrolling only; nothing recorded.
 */
function keepRecordInView() {
  setTimeout(() => {
    document.querySelector(".trk-commit")?.scrollIntoView({ block: "nearest" });
  }, 350);
}

function NoteField({ id, value, open, onOpen, onChange, disabled = false }) {
  if (!open) {
    return (
      <button type="button" className="trk-note-add" onClick={onOpen} disabled={disabled}>
        + Add note
      </button>
    );
  }
  const used = noteLength(value.trim());
  const over = used > MAX_NOTE_LENGTH;
  return (
    <div className="trk-note">
      <label htmlFor={id} className="trk-note-label">
        Note <span>(optional)</span>
      </label>
      <textarea
        id={id}
        className="trk-note-input"
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={id === "trk-note-live" ? keepRecordInView : undefined}
        disabled={disabled}
        aria-describedby={`${id}-count`}
        aria-invalid={over || undefined}
      />
      <p id={`${id}-count`} className={`trk-note-count${over ? " over" : ""}`} aria-live="polite">
        {over ? NOTE_TOO_LONG_ERROR : `${used}/${MAX_NOTE_LENGTH}`}
      </p>
    </div>
  );
}

/** The correction panel's explicit "not a QAB" choice. */
const NO_QAB = "__no_qab__";

/**
 * Correction is an inline panel, not a modal. A tracker who opens it by mistake
 * must be able to get out with one tap and without losing the live screen.
 */
function InlineCorrection({ row, name, onCancel, onApply }) {
  // One primary reason (2026-11). The choice is a reason key, NO_QAB, or —
  // only for a plate appearance saved with two reasons before the one-reason
  // rule — null, meaning "not chosen yet": nothing is pre-selected, because
  // pre-selecting either reason would silently drop the other.
  const saved = row.qab_reasons ?? [];
  const legacy = saved.length > 1;
  const [choice, setChoice] = useState(legacy ? null : saved[0] ?? NO_QAB);
  const reasons = choice === NO_QAB || choice === null ? [] : [choice];
  const [note, setNote] = useState(row.notes ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(row.notes));
  const noteTooLong = noteLength(note.trim()) > MAX_NOTE_LENGTH;

  return (
    <div className="trk-card trk-correct">
      <h2 className="trk-card-h" id={`trk-correct-h-${row.id}`}>
        Correct {name} · PA {row.pa_number}
      </h2>
      <p className="trk-prompt-s">
        {legacy
          ? "This plate appearance was saved with more than one reason. Choose the one primary reason."
          : "Choose the one primary reason, or No QAB."}
      </p>
      <div className="trk-reasons" role="radiogroup" aria-labelledby={`trk-correct-h-${row.id}`}>
        {QAB_REASONS.map((r) => {
          const on = choice === r.key;
          return (
            <button
              key={r.key}
              type="button"
              role="radio"
              className={`trk-reason${on ? " on" : ""}`}
              aria-checked={on}
              onClick={() => setChoice(r.key)}
            >
              <span className="trk-reason-check trk-reason-radio" aria-hidden="true" />
              <span className="trk-reason-label">{r.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          className={`trk-reason trk-reason-none${choice === NO_QAB ? " on" : ""}`}
          aria-checked={choice === NO_QAB}
          onClick={() => setChoice(NO_QAB)}
        >
          <span className="trk-reason-check trk-reason-radio" aria-hidden="true" />
          <span className="trk-reason-label">No QAB</span>
        </button>
      </div>
      <NoteField
        id={`trk-note-${row.id}`}
        value={note}
        open={noteOpen}
        onOpen={() => setNoteOpen(true)}
        onChange={setNote}
      />
      <div className="trk-commit">
        <button
          type="button"
          className="trk-save"
          onClick={() => onApply(reasons, note)}
          disabled={choice === null || noteTooLong}
        >
          Save correction
        </button>
        <button type="button" className="trk-noqab" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="trk-hint">
        No QAB keeps this as a plate appearance that was not a quality at-bat.
      </p>
    </div>
  );
}
