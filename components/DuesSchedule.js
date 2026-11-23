"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, cents } from "../lib/finance-rules";
import {
  duesStanding, templateFitsPlayer, templateTotalCents, validateScheduleDraft, parseDollarsToCents, MAX_INSTALLMENTS,
} from "../lib/dues-schedule";
import {
  saveTeamSchedule, previewTeamSchedule, applyTeamSchedule, loadDuesSnapshot, savePlayerSchedule,
} from "../lib/actions/dues-schedule";
import { useToast } from "./Toaster";
import { StSheet, SheetError, callAction, fmtDay, useRefreshThen } from "./StSheet";

/**
 * Player dues schedules (2026-11).
 *
 * What is ACTUAL and what is CALCULATED, everywhere on these screens:
 *   Recorded payments  real money in payment history. This module never creates,
 *                      edits or removes one.
 *   Covered            a calculation. Recorded payments are applied to the oldest
 *                      installment first, on screen, so Chris can see what the money
 *                      already received means for the schedule.
 * All arithmetic is in lib/dues-schedule.js; nothing here computes its own answer.
 */

const $ = (c) => money((c ?? 0) / 100);

export function standingForRecord(p, installments, today) {
  return duesStanding({
    totalCents: cents(p.totalDue),
    creditedCents: cents(p.totalPaid),
    exempt: Boolean(p.exempt),
    installments: installments ?? [],
    today,
  });
}

/** Short status for a list row. Neutral (nothing) until the device date is known. */
export function DuesStatusChip({ standing }) {
  if (!standing) return null;
  switch (standing.status) {
    case "past-due": return <span className="ds-chip ds-owed">Past due {$(standing.pastDueCents)}</span>;
    case "due-today": return <span className="ds-chip ds-due">Due today {$(standing.nextScheduled.amountCents)}</span>;
    case "on-track": return <span className="ds-chip ds-neutral">On schedule</span>;
    case "no-schedule": return <span className="ds-chip ds-none">No schedule</span>;
    case "schedule-mismatch": return <span className="ds-chip ds-due">Schedule needs review</span>;
    default: return null; // paid, exempt, no dues, loading
  }
}

const STATE_LABEL = { paid: "Covered", "past-due": "Past due", "due-today": "Due today", upcoming: "Upcoming", unknown: "" };

/** The installments, each with how much of it recorded payments cover (a calculation). */
export function InstallmentRows({ standing }) {
  return (
    <ul className="ds-rows">
      {standing.rows.map((r) => (
        <li key={`${r.dueDate}-${r.position}`} className={`ds-row ds-s-${r.state}`}>
          <div className="ds-row-main">
            <span className="ds-row-date">{fmtDay(r.dueDate)}</span>
            {STATE_LABEL[r.state] && <span className={`ds-state ds-st-${r.state}`}>{STATE_LABEL[r.state]}</span>}
            <b className="ds-row-amt">{$(r.amountCents)}</b>
          </div>
          <div className="ds-row-cover">
            Covered by payments received: <b>{$(r.paidCents)}</b>
            {r.remainingCents > 0 && r.paidCents > 0 ? <> · {$(r.remainingCents)} still to cover</> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CoverageNote() {
  return (
    <p className="ds-note">
      &ldquo;Covered&rdquo; is a calculation, not a payment. Recorded payments are counted against the oldest
      installment first. No payment is attached to an installment, and nothing here changes payment history.
    </p>
  );
}

function Fig({ label, value, sub, tone, className = "" }) {
  return (
    <div className={`ds-fig ${tone ? `ds-fig-${tone}` : ""} ${className}`}>
      <span className="ds-fig-l">{label}</span>
      <span className="ds-fig-v">{value}</span>
      {sub ? <span className="ds-fig-s">{sub}</span> : null}
    </div>
  );
}

/** The six figures. Past due and the next payment are always separate. */
export function ScheduleFigures({ standing, entries }) {
  const known = standing.status !== "loading";
  const next = standing.nextScheduled;
  return (
    <div className="ds-figs">
      <Fig label="Total dues" value={$(standing.totalCents)} />
      <Fig label="Payments received" value={$(standing.creditedCents)} sub={`${entries} ${entries === 1 ? "payment" : "payments"}`} />
      <Fig label="Remaining balance" value={$(standing.remainingCents)} />
      <Fig label="Due by today" value={known ? $(standing.dueByTodayCents) : "…"} sub={known ? "Includes today" : "Checking today's date"} />
      <Fig label="Past due" value={known ? $(standing.pastDueCents) : "…"} tone={known && standing.pastDueCents > 0 ? "owed" : null}
        sub={known && standing.oldestPastDueDate ? `Oldest ${fmtDay(standing.oldestPastDueDate)}` : null} />
      <Fig label="Next scheduled payment" className="ds-next"
        value={!known ? "…" : next ? $(next.amountCents) : "None"}
        sub={!known ? null : next ? (next.dueToday ? "Due today" : fmtDay(next.dueDate)) : "Nothing left to schedule"} />
    </div>
  );
}

/** The schedule section of a player's drawer. */
export function ScheduleSection({ p, standing, today, canWrite, onSchedule }) {
  if (standing.status === "exempt" || standing.status === "no-dues") return null;
  return (
    <section className="detail-section ds-section">
      <div className="ds-sec-head">
        <h3 className="detail-section-title">Payment schedule</h3>
        {standing.hasSchedule && canWrite && <button type="button" className="ds-link" onClick={onSchedule}>Edit schedule</button>}
      </div>
      {standing.hasSchedule ? (
        <>
          <ScheduleFigures standing={standing} entries={(p.log ?? []).length} />
          {standing.status === "schedule-mismatch" && (
            <p className="st-warn">This schedule adds up to {$(standing.totalCents + standing.mismatchCents)} but the total dues are {$(standing.totalCents)}. Open Edit schedule to fix it.</p>
          )}
          <InstallmentRows standing={standing} />
        </>
      ) : (
        <div className="ds-empty">
          <p>No payment dates set.</p>
          {canWrite && <button type="button" className="btn btn-secondary" onClick={onSchedule}>Add payment schedule</button>}
        </div>
      )}
      {today ? null : <p className="ds-note">Checking today&rsquo;s date.</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Editable list of date + amount rows, used by the team and player sheets */
/* ------------------------------------------------------------------ */

function RowsEditor({ rows, setRows, disabled }) {
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="ds-edit">
      {rows.length > 0 && <div className="ds-edit-head" aria-hidden="true"><span>Due date</span><span>Amount</span><span /></div>}
      {rows.map((r, i) => (
        <div className="ds-edit-row" key={i}>
          <input type="date" aria-label={`Payment ${i + 1} due date`} value={r.dueDate} disabled={disabled}
            onChange={(e) => set(i, { dueDate: e.target.value })} />
          <div className="ds-edit-money">
            <input inputMode="decimal" autoComplete="off" aria-label={`Payment ${i + 1} amount`} value={r.amount} disabled={disabled}
              onChange={(e) => set(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })} />
          </div>
          <button type="button" className="ds-x" aria-label={`Remove payment ${i + 1}`} disabled={disabled}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}>&times;</button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost ds-add" disabled={disabled || rows.length >= MAX_INSTALLMENTS}
        onClick={() => setRows([...rows, { dueDate: nextDueDate(rows), amount: "" }])}>+ Add installment</button>
    </div>
  );
}

/** A new installment starts one month after the last dated one (or today), so a date is always showing. */
function nextDueDate(rows) {
  const last = [...rows].reverse().find((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate ?? ""))?.dueDate;
  const [y, m, d] = last ? last.split("-").map(Number) : (() => { const t = new Date(); return [t.getFullYear(), t.getMonth() + 1, t.getDate()]; })();
  const base = last ? new Date(y, m, 1) : new Date(y, m - 1, d); // last: first of the next month's slot, then clamp the day
  if (last) base.setDate(Math.min(d, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
  const p2 = (n) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${p2(base.getMonth() + 1)}-${p2(base.getDate())}`;
}

const rowsFromItems = (items) => (items ?? []).map((i) => ({ dueDate: i.dueDate, amount: (i.amountCents / 100).toFixed(2) }));
const payloadRows = (rows) => rows.map((r) => ({ due_date: r.dueDate, amount: (parseDollarsToCents(r.amount) ?? 0) / 100 }));
const ERRORS = {
  "missing-date": "Every payment needs a due date.",
  "bad-amount": "Every payment needs an amount above zero.",
  "duplicate-date": "Two payments have the same date.",
  "too-many": `A schedule can have at most ${MAX_INSTALLMENTS} payments.`,
};
const firstError = (errors) => errors.map((e) => ERRORS[e]).find(Boolean) ?? null;

/* ------------------------------------------------------------------ */
/* Team schedule                                                        */
/* ------------------------------------------------------------------ */

export function TeamScheduleSheet({ template, payments, onClose, onSavedChoosePlayers }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(template ? rowsFromItems(template.items) : [{ dueDate: "", amount: "" }]);
  const [name, setName] = useState(template?.name ?? "Standard schedule");
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [, refreshThen] = useRefreshThen();
  const inFlight = useRef(false);
  const common = useMemo(() => commonPlayerTotalCents(payments), [payments]);

  const sum = rows.reduce((s, r) => s + (parseDollarsToCents(r.amount) ?? 0), 0);
  const check = validateScheduleDraft({ totalCents: sum, paidCents: 0, rows });
  const problem = firstError(check.errors);
  const valid = check.ok && rows.length > 0 && sum > 0;

  async function save(thenChoose) {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setSaving(true); setErr(null);
    const res = await callAction(saveTeamSchedule, {
      template_id: template?.id ?? null,
      expected_revision: template?.revision ?? null,
      name,
      items: JSON.stringify(payloadRows(rows)),
    });
    inFlight.current = false; setSaving(false);
    if (!res?.ok) {
      setErr(res?.code === "changed" ? `${res.error} Close this and open it again to see the latest.` : res?.error ?? "Couldn't save the schedule.");
      return;
    }
    refreshThen(() => {
      onClose();
      if (thenChoose) onSavedChoosePlayers?.();
      else toast("Team schedule saved. Choose players from the Apply schedule button.");
    });
  }

  return (
    <StSheet eyebrow="Player dues" title="Team schedule" onClose={onClose} busy={saving}
      foot={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-secondary" onClick={() => save(false)} disabled={!valid || saving}>Save</button>
        <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={!valid || saving}>
          {saving ? "Saving" : "Save and continue"}
        </button>
      </>}>
      <p className="ds-lead">
        Enter the date and amount of each payment, including months that have already passed. Saving the schedule
        does not change any player. You choose who it applies to next.
      </p>
      <div className="field">
        <label htmlFor="ts-name">Name</label>
        <input id="ts-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <RowsEditor rows={rows} setRows={setRows} disabled={saving} />
      <div className={`ds-total${valid ? "" : " ds-total-off"}`}>
        <span>Schedule total</span><b>{$(sum)}</b>
      </div>
      <p className="ds-note">It fits any player whose total dues equal {$(sum)}. Anyone else needs their own schedule.</p>
      {common != null && sum !== common && <p className="st-warn">Most players on this team owe {$(common)}, but this schedule totals {$(sum)}. It will not fit them until the payments add up to {$(common)}.</p>}
      {problem && <p className="st-warn">{problem}</p>}
      <SheetError>{err}</SheetError>
    </StSheet>
  );
}

/* ------------------------------------------------------------------ */
/* Apply the team schedule: choose players, then review the coverage    */
/* ------------------------------------------------------------------ */

/** The total most players on the team owe (cents), or null when nobody owes dues. Used to catch a schedule that fits no one. */
export function commonPlayerTotalCents(payments) {
  const counts = new Map();
  for (const p of payments ?? []) {
    const c = cents(p.totalDue);
    if (p.exempt || c <= 0) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = null;
  for (const [c, n] of counts) if (!best || n > best.n || (n === best.n && c > best.c)) best = { c, n };
  return best?.c ?? null;
}

const BLOCK_REASON = {
  exempt: "Owes no dues",
  no_dues: "Owes no dues",
  total_differs: "Owes a different total. Needs its own schedule.",
  has_schedule: "Already has a schedule",
};

export function ApplyScheduleSheet({ template, payments, byPayment, today, onClose, onEditSchedule, justSaved = false }) {
  const router = useRouter();
  const toast = useToast();
  const [, refreshThen] = useRefreshThen();
  const tplTotal = templateTotalCents(template.items);
  const batchKey = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
  const inFlight = useRef(false);

  // Every player is listed. Anyone who cannot take this schedule says why, so nobody looks missing.
  const candidates = useMemo(() => payments
    .map((p) => {
      const noDues = !!p.exempt || cents(p.totalDue) <= 0;
      const fits = !noDues && templateFitsPlayer(template.items, cents(p.totalDue));
      const why = p.exempt ? "Exempt. Owes no dues."
        : noDues ? "Owes no dues."
        : !fits ? `Owes ${money(p.totalDue)}, not ${$(tplTotal)}. Needs its own schedule.` : null;
      return { p, fits, noDues, why, has: (byPayment[p.id] ?? []).length > 0 };
    })
    .sort((a, b) => Number(b.fits) - Number(a.fits)), [payments, byPayment, template, tplTotal]);

  const [stage, setStage] = useState("select");
  const [picked, setPicked] = useState(() => new Set(candidates.filter((c) => c.fits && !c.has).map((c) => c.p.id)));
  const [replace, setReplace] = useState(() => new Set());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  const toggle = (set, setter, id) => setter((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const eligible = candidates.filter((c) => c.fits);
  const chosen = candidates.filter((c) => picked.has(c.p.id) && c.fits && (!c.has || replace.has(c.p.id)));

  async function review() {
    if (chosen.length === 0) return;
    setBusy(true); setErr(null);
    const res = await callAction(previewTeamSchedule, { template_id: template.id, payment_ids: JSON.stringify(chosen.map((c) => c.p.id)) });
    setBusy(false);
    if (!res?.ok) { setErr(res?.error ?? "Couldn't load the preview."); return; }
    setPreview(res); setStage("review");
  }

  const items = preview ? preview.items.map((i, n) => ({ position: n + 1, dueDate: i.due_date, amountCents: cents(i.amount) })) : [];
  const reviewed = useMemo(() => (preview?.players ?? []).map((pl) => ({
    pl,
    standing: duesStanding({ totalCents: cents(pl.total), creditedCents: cents(pl.credited), exempt: false, installments: items, today }),
  })), [preview, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const pastDueAfter = reviewed.filter((r) => r.standing.status === "past-due");

  async function apply() {
    if (inFlight.current || !preview || !today) return;
    inFlight.current = true; setBusy(true); setErr(null);
    const entries = preview.players.map((pl) => ({ payment_id: pl.payment_id, expected_version: pl.version, replace: replace.has(pl.payment_id) }));
    const res = await callAction(applyTeamSchedule, { template_id: template.id, batch_key: batchKey.current, expected_revision: preview.revision, entries: JSON.stringify(entries) });
    inFlight.current = false; setBusy(false);
    if (!res?.ok) {
      if (res?.code === "template_changed") {
        setErr("The team schedule was changed after you reviewed it. Nothing was applied. Choose players and review again.");
        setStage("select"); setPreview(null); router.refresh();
        batchKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
        return;
      }
      if (res?.code === "changed") {
        const names = (res.players ?? []).map((x) => x.player_name).filter(Boolean).join(", ");
        setErr(`${names ? `${names} changed` : "Some players changed"} while you were reviewing. Nothing was saved. Review again.`);
        setStage("select"); setPreview(null); router.refresh();
        // A new key: this was refused, not applied, so nothing is repeated.
        batchKey.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
        return;
      }
      setErr(res?.error ?? "Couldn't apply the schedule. Nothing was saved.");
      return;
    }
    refreshThen(() => {
      onClose();
      toast(res.duplicate
        ? "That request was already applied. Nothing was added twice."
        : `Schedule applied to ${res.applied} ${res.applied === 1 ? "player" : "players"}. No payments were changed.`);
    });
  }

  const title = stage === "select" ? "Choose players" : "Review before applying";
  return (
    <StSheet eyebrow={stage === "select" ? "Apply team schedule · Step 1 of 2" : "Apply team schedule · Step 2 of 2"} title={title} onClose={onClose} busy={busy}
      back={stage === "review" ? { label: "Choose players", onClick: () => { setStage("select"); setErr(null); } } : undefined}
      foot={stage === "select" ? <>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={review} disabled={busy || chosen.length === 0}>
          {busy ? "Loading" : chosen.length === 0 ? "Choose players" : `Review ${chosen.length} ${chosen.length === 1 ? "player" : "players"}`}
        </button>
      </> : <>
        <button type="button" className="btn btn-secondary" onClick={() => setStage("select")} disabled={busy}>Back</button>
        <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !today}>
          {busy ? "Applying" : !today ? "Checking today's date" : `Apply to ${reviewed.length} ${reviewed.length === 1 ? "player" : "players"}`}
        </button>
      </>}>
      {stage === "select" ? (
        <>
          {justSaved && <p className="ds-saved" role="status">Team schedule saved. Nothing has been applied yet.</p>}
          <div className="ds-sched-sum">
            <span className="st-eyebrow">{template.name}</span>
            <b>{$(tplTotal)}</b>
            <span>{template.items.length} {template.items.length === 1 ? "payment" : "payments"}, {fmtDay(template.items[0].dueDate)} to {fmtDay(template.items.at(-1).dueDate)}</span>
          </div>
          <p className="ds-lead">
            Choose who gets this schedule. It adds the dates only. Payments already recorded are never re-entered or
            changed; they are counted against the oldest installments for you to review next.
          </p>
          {eligible.length === 0 && (
            <div className="ds-nofit" role="alert">
              <b>No player can take this schedule.</b>
              <span>
                It totals {$(tplTotal)}
                {commonPlayerTotalCents(payments) != null ? <>, but most players owe {$(commonPlayerTotalCents(payments))}</> : null}.
                A team schedule only fits players whose total dues equal its total. Check that every payment is entered.
              </span>
              {onEditSchedule && <button type="button" className="btn btn-secondary" onClick={onEditSchedule}>Edit team schedule</button>}
            </div>
          )}
          <div className="ds-pick-head">
            <span>{chosen.length} selected · {eligible.length} of {candidates.length} can take this schedule</span>
            <span className="ds-pick-bulk">
              <button type="button" className="ds-link" onClick={() => setPicked((cur) => new Set([...cur, ...eligible.filter((c) => !c.has).map((c) => c.p.id)]))}>Select all</button>
              <button type="button" className="ds-link" disabled={picked.size === 0} onClick={() => { setPicked(new Set()); setReplace(new Set()); }}>Clear</button>
            </span>
          </div>
          <ul className="ds-pick">
            {candidates.map(({ p, fits, has, why, noDues }) => {
              const on = picked.has(p.id);
              return (
                <li key={p.id} className={fits ? "" : "ds-pick-off"}>
                  <label>
                    <input type="checkbox" checked={on && fits} disabled={!fits} onChange={() => toggle(picked, setPicked, p.id)} />
                    <span className="ds-pick-name">{p.displayName}</span>
                    <span className="ds-pick-sub">Owes {money(p.totalDue)} · {money(p.totalPaid)} recorded</span>
                    {!fits && <span className={noDues ? "ds-pick-why ds-pick-why-neutral" : "ds-pick-why"}>{noDues ? "Skipped" : "Not selectable"}: {why}</span>}
                    {fits && has && <span className="ds-pick-has">{BLOCK_REASON.has_schedule}</span>}
                  </label>
                  {fits && has && on && (
                    <label className="ds-replace">
                      <input type="checkbox" checked={replace.has(p.id)} onChange={() => toggle(replace, setReplace, p.id)} />
                      Replace their schedule (the old one is kept as history)
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
          {eligible.length < candidates.length && <p className="ds-note">Players who are exempt, owe no dues, or owe a different total cannot take this schedule and are shown dimmed with the reason.</p>}
        </>
      ) : (
        <>
          <div className="ds-callout">
            <b>Nothing is changed by reviewing.</b> Applying adds installments only. It does not create a payment, change
            a payment, or change anyone&rsquo;s total dues.
          </div>
          <div className="ds-review-sum">
            <span><b>{reviewed.length}</b> {reviewed.length === 1 ? "player" : "players"}</span>
            <span><b>{pastDueAfter.length}</b> past due after applying</span>
            <span><b>{$(pastDueAfter.reduce((s, r) => s + r.standing.pastDueCents, 0))}</b> past due in total</span>
          </div>
          {!today && <p className="st-warn">Checking today&rsquo;s date. Past due amounts appear once it is known.</p>}
          <ul className="ds-review">
            {reviewed.map(({ pl, standing }) => {
              const isOpen = open.has(pl.payment_id);
              return (
                <li key={pl.payment_id} className="ds-review-item">
                  <div className="ds-review-top">
                    <b>{pl.player_name ?? "Player"}</b>
                    <DuesStatusChip standing={standing} />
                  </div>
                  <div className="ds-review-line">
                    <span className="ds-lbl">Recorded payments</span>
                    <b>{$(standing.creditedCents)}</b>
                    <span className="muted">{pl.payments.length} {pl.payments.length === 1 ? "payment" : "payments"} · actual</span>
                  </div>
                  <div className="ds-review-line">
                    <span className="ds-lbl">Covered by calculation</span>
                    <span>{coverageSentence(standing)}</span>
                  </div>
                  {standing.nextScheduled && (
                    <div className="ds-review-line">
                      <span className="ds-lbl">Next scheduled payment</span>
                      <span>{$(standing.nextScheduled.amountCents)} {standing.nextScheduled.dueToday ? "due today" : `on ${fmtDay(standing.nextScheduled.dueDate)}`}</span>
                    </div>
                  )}
                  <button type="button" className="ds-link" aria-expanded={isOpen} onClick={() => toggle(open, setOpen, pl.payment_id)}>
                    {isOpen ? "Hide details" : "Show payments and coverage"}
                  </button>
                  {isOpen && (
                    <div className="ds-detail">
                      <p className="st-eyebrow">Recorded payments (actual)</p>
                      <ul className="st-hist">
                        {pl.payments.length === 0 ? <li><span>No payments recorded</span></li> : pl.payments.map((x) => (
                          <li key={x.id}><span>{x.paid_date ? fmtDay(x.paid_date) : "No date"}{x.label ? ` · ${x.label}` : ""}</span><b>{money(x.amount)}</b></li>
                        ))}
                      </ul>
                      <p className="st-eyebrow">Schedule coverage (calculated)</p>
                      <InstallmentRows standing={standing} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <SheetError>{err}</SheetError>
    </StSheet>
  );
}

/** "Covers Sep 1 in full and $400 of Oct 1" in plain words. */
function coverageSentence(standing) {
  const full = standing.rows.filter((r) => r.remainingCents === 0);
  const part = standing.rows.find((r) => r.paidCents > 0 && r.remainingCents > 0);
  if (standing.creditedCents === 0) return "Nothing yet. Every installment is still to cover.";
  const bits = [];
  if (full.length === 1) bits.push(`${fmtDay(full[0].dueDate)} in full`);
  else if (full.length > 1) bits.push(`${full.length} installments in full (${fmtDay(full[0].dueDate)} to ${fmtDay(full.at(-1).dueDate)})`);
  if (part) bits.push(`${$(part.paidCents)} of ${fmtDay(part.dueDate)}`);
  return `Covers ${bits.join(" and ")}.`;
}

/* ------------------------------------------------------------------ */
/* One player: total dues, exempt and schedule, saved together          */
/* ------------------------------------------------------------------ */

const rowsFromSnapshot = (list) => (list ?? []).map((i) => ({ dueDate: i.due_date, amount: Number(i.amount).toFixed(2) }));

export function ChangeScheduleSheet({ p, template, today, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [, refreshThen] = useRefreshThen();

  // Everything editable, and the version of it, comes from ONE call made when the sheet opens.
  // Nothing is taken from the page behind the sheet, which may be older than the database.
  const [snap, setSnap] = useState(null);
  const [total, setTotal] = useState("");
  const [exempt, setExempt] = useState(false);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    callAction(loadDuesSnapshot, { payment_id: p.id }).then((r) => {
      if (!live) return;
      if (!r?.ok) { setErr(r?.error ?? "Couldn't load this player."); return; }
      const sn = r.snapshot;
      setSnap(sn);
      setTotal((cents(sn.total) / 100).toFixed(2));
      setExempt(Boolean(sn.exempt));
      setRows(rowsFromSnapshot(sn.installments));
    });
    return () => { live = false; };
  }, [p.id]);

  const version = snap?.version ?? null;
  const paidCents = cents(snap?.paid ?? 0);
  const hadSchedule = (snap?.installments ?? []).length > 0;
  const hasPayments = paidCents > 0;

  const totalCents = exempt ? 0 : (parseDollarsToCents(total) ?? NaN);
  const check = validateScheduleDraft({ totalCents: Number.isNaN(totalCents) ? 0 : totalCents, paidCents, rows: exempt ? [] : rows });
  const totalOk = !Number.isNaN(totalCents);
  const rowsProblem = firstError(check.errors);
  const mismatch = !exempt && rows.length > 0 && check.errors.includes("total-mismatch");
  const belowPaid = !exempt && check.errors.includes("total-below-paid");
  const valid = Boolean(version) && totalOk && !belowPaid && !rowsProblem && !mismatch && (exempt || hadSchedule || rows.length > 0);
  const fitsTemplate = template && totalOk && templateFitsPlayer(template.items, totalCents);

  const live = useMemo(() => {
    const rowsClean = !check.errors.some((e) => e === "missing-date" || e === "bad-amount" || e === "duplicate-date" || e === "too-many");
    if (exempt || !totalOk || rows.length === 0 || !rowsClean) return null;
    return duesStanding({
      totalCents: check.ok ? totalCents : check.sumCents, creditedCents: Math.min(paidCents, check.sumCents), exempt: false, today,
      installments: check.rows.map((r, i) => ({ position: i + 1, dueDate: r.dueDate, amountCents: r.amountCents })),
    });
  }, [exempt, totalOk, totalCents, rows, check.ok, check.sumCents, today]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setSaving(true); setErr(null);
    const instal = exempt ? "" : rows.length > 0 ? JSON.stringify(payloadRows(rows)) : hadSchedule ? "[]" : "";
    const res = await callAction(savePlayerSchedule, {
      payment_id: p.id, expected_version: version, total: exempt ? 0 : totalCents / 100, exempt: exempt ? "true" : "false", installments: instal,
    });
    inFlight.current = false; setSaving(false);
    if (!res?.ok) {
      if (res?.code === "changed") setStale(true);
      setErr(res?.error ?? "Couldn't save. Nothing was changed.");
      return;
    }
    refreshThen(() => { onClose(); toast(res.unchanged ? "Nothing needed to change." : `Saved ${p.displayName}'s dues and schedule. No payments were changed.`); });
  }

  return (
    <StSheet eyebrow="Player dues" title={p.displayName} onClose={onClose} busy={saving}
      foot={stale ? <>
        <button type="button" className="btn btn-primary" onClick={() => { router.refresh(); onClose(); }}>Close and refresh</button>
      </> : <>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!valid || saving}>{saving ? "Saving" : "Save schedule"}</button>
      </>}>
      {!snap ? (
        <p className="ds-note" role="status">{err ? "" : "Loading the latest figures for this player."}</p>
      ) : (
        <>
      {!exempt && (
        <>
          <div className="field">
            <label htmlFor="cs-total">Season dues</label>
            <div className="st-money">
              <input id="cs-total" inputMode="decimal" autoComplete="off" value={total} disabled={saving}
                onChange={(e) => setTotal(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            {belowPaid && <p className="st-warn">Total dues can&rsquo;t be less than the {money(snap?.paid ?? 0)} already paid.</p>}
          </div>

          <div className="ds-recv">
            <span>Payments already received</span>
            <b>{money(snap.paid)}</b>
            <small>{hasPayments ? "Existing payments count automatically toward this schedule." : "None yet."}</small>
          </div>

          <div className="ds-sec-head">
            <p className="st-eyebrow">Payment schedule</p>
            <div className="ds-sec-actions">
              {template && (
                <button type="button" className="ds-link" disabled={!fitsTemplate || saving}
                  title={fitsTemplate ? "" : "Only for a player whose total equals the team schedule"}
                  onClick={() => setRows(rowsFromItems(template.items))}>Start from team schedule</button>
              )}
              {rows.length > 0 && <button type="button" className="ds-link" disabled={saving} onClick={() => setRows([])}>Clear schedule</button>}
            </div>
          </div>
          {rows.length === 0 && <p className="ds-note">No payment dates set.</p>}
          <RowsEditor rows={rows} setRows={setRows} disabled={saving} />
          {rows.length > 0 && (
            <div className={`ds-total${mismatch ? " ds-total-bad" : ""}`}>
              <span>Schedule total</span><b>{$(check.sumCents)}</b>
              <span className="ds-total-of">of {$(Number.isNaN(totalCents) ? 0 : totalCents)}</span>
            </div>
          )}
          {mismatch && <p className="st-warn">{check.diffCents > 0 ? `${$(check.diffCents)} too much` : `${$(-check.diffCents)} short`}. The payments must add up to the total dues.</p>}
          {rowsProblem && <p className="st-warn">{rowsProblem}</p>}

          {live && (
            <div className="ds-live">
              <p className="st-eyebrow">What the {money(snap.paid)} received covers</p>
              {hasPayments && <p className="ds-cover-line">{coverageSentence(live)}</p>}
              <InstallmentRows standing={live} />
              {live.status === "past-due" && <p className="ds-note">Past due: <b>{$(live.pastDueCents)}</b>.</p>}
            </div>
          )}
        </>
      )}
      {!hasPayments && (
      <label className="ds-exempt">
        <input type="checkbox" checked={exempt} disabled={hasPayments || saving} onChange={(e) => setExempt(e.target.checked)} />
        <span>This player owes no dues (exempt)</span>
      </label>
      )}
      {exempt && hadSchedule && <p className="ds-note">Their current schedule is kept as history and no longer counts.</p>}

        </>
      )}
      <SheetError>{err}</SheetError>
    </StSheet>
  );
}
