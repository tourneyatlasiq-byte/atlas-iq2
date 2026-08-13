"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QAB_REASONS, reasonLabel, formatQab, tallyPlateAppearances } from "../lib/qab-rules";
import {
  recordPlateAppearance,
  voidPlateAppearance,
  correctPlateAppearance,
} from "../lib/actions/plate-appearances";
import { enqueue, flushQueue, queueStatus, newPaId } from "../lib/offline-queue";

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

export function TrackerClient({ game, lineup, initialRows, canWrite }) {
  const [rows, setRows] = useState(initialRows ?? []);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState([]);
  const [sync, setSync] = useState(SYNCED);
  const [correcting, setCorrecting] = useState(null);
  const busy = useRef(false);

  const order = lineup ?? [];
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

  const advance = () => setCursor((c) => (order.length ? (c + 1) % order.length : 0));

  const commit = async (reasons) => {
    if (!batter || !canWrite || busy.current) return;
    busy.current = true;
    try {
      const id = newPaId();
      const paNumber = paNumberFor(batter.player_id);
      const payload = {
        id,
        gameId: game.id,
        playerId: batter.player_id,
        paNumber,
        reasons,
      };

      setRows((r) => [
        ...r,
        {
          id,
          player_id: batter.player_id,
          pa_number: paNumber,
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

  const applyCorrection = async (row, reasons) => {
    setRows((r) => (r.map((x) => (x.id === row.id ? { ...x, qab_reasons: reasons, is_qab: reasons.length > 0 } : x))));
    setCorrecting(null);
    await enqueue({ op: "correct", gameId: game.id, payload: { id: row.id, reasons } });
    await refreshStatus();
    sync_();
  };

  const nameOf = (playerId) =>
    order.find((s) => s.player_id === playerId)?.full_name ?? "Unknown player";

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
        <span className="trk-tally">{formatQab(totals.qab, totals.pa)}</span>
      </header>

      <div className="trk-batter">
        <div className="trk-batter-top">
          <span className="trk-slot">{cursor + 1}</span>
          <span className="trk-name">{batter.full_name}</span>
        </div>
        <div className="trk-batter-meta">
          <span className="trk-jersey">
            {batter.jersey_number != null ? `#${batter.jersey_number}` : "#—"}
          </span>
          {batter.participation === "pickup" && <span className="tag-pickup">Pickup</span>}
          <span className="trk-pa">Plate appearance {paNumberFor(batter.player_id)}</span>
        </div>
      </div>

      <div className="trk-prompt">
        <p className="trk-prompt-q">What made this a Quality At-Bat?</p>
        <p className="trk-prompt-s">Select all that apply.</p>
      </div>

      <div className="trk-reasons">
        {QAB_REASONS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`trk-reason${selected.includes(r.key) ? " on" : ""}`}
            aria-pressed={selected.includes(r.key)}
            onClick={() => toggle(r.key)}
            disabled={!canWrite}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="trk-commit">
        <button
          type="button"
          className="trk-noqab"
          onClick={() => commit([])}
          disabled={!canWrite}
        >
          No QAB
        </button>
        <button
          type="button"
          className="trk-save"
          onClick={() => commit(selected)}
          disabled={!canWrite || selected.length === 0}
        >
          Record QAB
        </button>
      </div>

      <div className="trk-undo">
        <button type="button" onClick={undo} disabled={!lastLive || !canWrite}>
          {lastLive ? `Undo ${nameOf(lastLive.player_id)} PA ${lastLive.pa_number}` : "Nothing to undo"}
        </button>
      </div>

      <section className="trk-history">
        <h2>This game ({live.length} PA)</h2>
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
                    onClick={() => setCorrecting(r)}
                    disabled={!canWrite}
                  >
                    <span className="trk-hist-name">
                      {nameOf(r.player_id)} · PA {r.pa_number}
                    </span>
                    <span className={`trk-hist-tag${r.is_qab ? " qab" : ""}`}>
                      {/* Reason names, never a count. Several reasons describe one
                          quality at bat; a number here read as several QABs. */}
                      {r.is_qab
                        ? `QAB • ${r.qab_reasons.map(reasonLabel).join(", ")}`
                        : "No QAB"}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      {correcting && (
        <CorrectionPanel
          row={correcting}
          name={nameOf(correcting.player_id)}
          onCancel={() => setCorrecting(null)}
          onApply={(reasons) => applyCorrection(correcting, reasons)}
        />
      )}
    </div>
  );
}

/**
 * Correction is an inline panel, not a modal. A tracker who opens it by mistake
 * must be able to get out with one tap and without losing the live screen.
 */
function CorrectionPanel({ row, name, onCancel, onApply }) {
  const [reasons, setReasons] = useState(row.qab_reasons ?? []);
  const toggle = (key) =>
    setReasons((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  return (
    <section className="trk-correct">
      <h2>
        Correct {name} · PA {row.pa_number}
      </h2>
      <p className="trk-prompt-s">Select all that apply. Several reasons still count as one QAB.</p>
      <div className="trk-reasons">
        {QAB_REASONS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`trk-reason${reasons.includes(r.key) ? " on" : ""}`}
            aria-pressed={reasons.includes(r.key)}
            onClick={() => toggle(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="trk-commit">
        <button type="button" className="trk-noqab" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="trk-save" onClick={() => onApply(reasons)}>
          Save correction
        </button>
      </div>
      <p className="trk-hint">
        Clearing every reason records this as an explicit non-QAB. It stays a plate appearance.
      </p>
    </section>
  );
}
