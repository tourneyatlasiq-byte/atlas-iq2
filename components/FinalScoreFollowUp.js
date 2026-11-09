"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordFinalScore } from "../lib/actions/games";
import { scoreEntry, formatFinalScore } from "../lib/game-rules";

/**
 * Performance follow-up: tracked games finished without a final score
 * (2026-11).
 *
 * The page passes only the games that need one (needsFinalScore in
 * lib/game-rules). Each can take its score right here — two numbers and Save —
 * through recordFinalScore, which writes the score and nothing else; the
 * database derives W/L/T. A saved game leaves the list at once and the page
 * refreshes from the database, so the season record and report Result column
 * pick the score up from the same game row. With none left, the card is gone.
 *
 * An attention item, not an error: neutral styling, kept compact.
 *
 * Screen only. The printable QAB reports carry no missing-score warning.
 */
export function FinalScoreFollowUp({ games = [], canWrite = false }) {
  const router = useRouter();
  const [openId, setOpenId] = useState(null);
  const [us, setUs] = useState("");
  const [them, setThem] = useState("");
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  // Games saved in this view leave the list at once, before the refresh lands.
  const [doneIds, setDoneIds] = useState([]);
  const [pending, startTransition] = useTransition();

  const remaining = games.filter((g) => !doneIds.includes(g.gameId));
  // Nothing left to score: no card at all.
  if (remaining.length === 0) return null;
  const one = remaining.length === 1;

  const entry = scoreEntry(us, them);
  const open = (id) => { setOpenId(id); setUs(""); setThem(""); setError(null); setSaved(null); };

  const save = (g) => {
    setError(null);
    startTransition(async () => {
      const r = await recordFinalScore(g.gameId, us, them);
      if (!r.ok) { setError(r.error); return; }
      setSaved(`vs ${g.opponent}: ${formatFinalScore(r.runsFor, r.runsAgainst, r.result)}`);
      setDoneIds((ids) => [...ids, g.gameId]);
      setOpenId(null);
      router.refresh();
    });
  };

  return (
    <section className="fsf" aria-labelledby="fsf-h">
      <h2 className="fsf-h" id="fsf-h">
        {one ? "1 game needs its final score" : `${remaining.length} games need final scores`}
      </h2>
      <p className="fsf-sub">
        {one
          ? "QAB tracking is complete, but the final score hasn't been recorded."
          : "QAB tracking is complete, but the final scores haven't been recorded."}
      </p>
      <ul className="fsf-list">
        {remaining.map((g) => (
          <li key={g.gameId} className="fsf-item">
            <div className="fsf-row">
              <span className="fsf-id">
                <span className="fsf-opp">vs {g.opponent}</span>
                <span className="fsf-meta">{g.dateLabel}{g.tournament && ` · ${g.tournament}`}</span>
              </span>
              {canWrite && openId !== g.gameId && (
                <button type="button" className="btn fsf-add" onClick={() => open(g.gameId)}>
                  Add score
                </button>
              )}
            </div>

            {openId === g.gameId && (
              <div className="fsf-form" role="group" aria-label={`Final score vs ${g.opponent}`}>
                <div className="fsf-fields">
                  <div className="field">
                    <label htmlFor={`fsf-us-${g.gameId}`}>Our score</label>
                    <input id={`fsf-us-${g.gameId}`} type="number" min="0" step="1" inputMode="numeric"
                      value={us} onChange={(e) => { setUs(e.target.value); setError(null); }} autoFocus />
                  </div>
                  <div className="field">
                    <label htmlFor={`fsf-them-${g.gameId}`}>Opponent score</label>
                    <input id={`fsf-them-${g.gameId}`} type="number" min="0" step="1" inputMode="numeric"
                      value={them} onChange={(e) => { setThem(e.target.value); setError(null); }} />
                  </div>
                </div>
                {entry.state === "partial" && <p className="fsf-hint" role="status">Enter both scores.</p>}
                {entry.state === "invalid" && <p className="fsf-hint" role="status">Scores are whole numbers of runs.</p>}
                {error && <div className="notice notice-error">{error}</div>}
                <div className="fsf-actions">
                  <button type="button" className="btn btn-primary" onClick={() => save(g)}
                    disabled={pending || entry.state !== "complete"}>
                    {pending ? "Saving…" : "Save score"}
                  </button>
                  <button type="button" className="btn" onClick={() => setOpenId(null)} disabled={pending}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {saved && <p className="fsf-saved" role="status">Saved — {saved}.</p>}
    </section>
  );
}
