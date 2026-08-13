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
        <span className="trk-tally">
          <strong>{totals.qabPct == null ? "—" : `${totals.qabPct}%`} QAB</strong>
          <em>
            {totals.qab} of {totals.pa} PA
          </em>
        </span>
      </header>

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

      {lastLive && (
        <div className="trk-last">
          <span className="trk-last-text">
            Last recorded: <strong>{nameOf(lastLive.player_id)}</strong> • PA {lastLive.pa_number}
          </span>
          <button type="button" className="trk-last-undo" onClick={undo} disabled={!canWrite}>
            Undo
          </button>
        </div>
      )}

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
                    onClick={() => setCorrecting(r)}
                    disabled={!canWrite}
                  >
                    <span className="trk-hist-top">
                      <span className="trk-hist-name">{nameOf(r.player_id)}</span>
                      <span className="trk-hist-pa">PA {r.pa_number}</span>
                      <span className={`trk-badge${r.is_qab ? " qab" : ""}`}>
                        {r.is_qab ? "QAB" : "No QAB"}
                      </span>
                    </span>
                    {/* Reason names, never a count. Several reasons describe one
                        quality at bat; a number here read as several QABs. */}
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
    <section className="trk-card trk-correct">
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
    </section>
  );
}
