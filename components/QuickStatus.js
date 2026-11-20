"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../lib/finance-rules";
import { quickAction, tournamentPayments } from "../lib/tournament-status";
import { setTournamentStatus, markTournamentPaidInFull, undoMarkTournamentPaidInFull } from "../lib/actions/tournaments";
import { useToast } from "./Toaster";
import { StSheet, SheetError, callAction, todayIso, useRefreshThen } from "./StSheet";

/**
 * Quick status actions for a tournament: Commit, Mark registered, Mark paid in
 * full. One implementation for Home, the season plan and the weekend card.
 *
 *   Mark registered   reversible and low risk: saves at once, Undo in the toast.
 *   Commit            changes the budget: asks first and shows the effect.
 *   Mark paid in full money: asks first; can also record the payment in Finance
 *                     (see markTournamentPaidInFull for the duplicate checks).
 *
 * Callers pass canWrite; without it no action renders at all.
 */
export function useQuickStatus({ transactions = [], budgetLines = [], seasonAvailable = null, onEditDetails = null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [, refreshThen] = useRefreshThen();
  const [dialog, setDialog] = useState(null);

  async function register(t) {
    setBusy(t.id);
    const res = await callAction(setTournamentStatus, { id: t.id, field: "paid_status", value: "Registered" });
    if (!res?.ok) {
      setBusy(null);
      toast(`Couldn't mark ${t.name} registered. Nothing changed. ${res?.error ?? ""}`.trim(), { kind: "error", retry: () => register(t) });
      return;
    }
    refreshThen(() => { setBusy(null); toast(`${t.name} is registered.`, {
      undo: async () => {
        // expected: Undo only applies while the status is still what this change set.
        const r = await callAction(setTournamentStatus, { id: t.id, field: "paid_status", value: res.previous ?? "Not Registered", expected: "Registered" });
        router.refresh();
        return r;
      },
      undoneMessage: `${t.name} is back to ${res.previous ?? "Not Registered"}.`,
    }); });
  }

  function run(t) {
    const q = quickAction(t);
    if (!q) return;
    if (q.kind === "register") return register(t);
    setDialog({ kind: q.kind, t });
  }

  const element = dialog ? (
    dialog.kind === "paid" ? (
      <PaidDialog t={dialog.t} transactions={transactions} budgetLines={budgetLines}
        onEditDetails={(t) => (onEditDetails ? onEditDetails(t) : router.push(`/tournaments?open=${t.id}`))}
        onClose={() => setDialog(null)}
        onDone={(res) => {
          const t = dialog.t;
          refreshThen(() => { setDialog(null); toast(`${t.name} is paid in full${res.recorded_amount != null ? ` and ${money(res.recorded_amount)} ${res.touched_txn_id ? "is marked paid" : "is recorded"} in Finance.` : ". No Finance transaction recorded."}`, {
            // The database decides: it refuses unless the tournament and its payments are exactly as this save left them.
            undo: async () => {
              const r = await callAction(undoMarkTournamentPaidInFull, { operation_id: res.operation_id });
              router.refresh();
              return r;
            },
            undoneMessage: `${t.name} is back to ${res.previous_status}.`,
          }); });
        }} />
    ) : (
      <CommitDialog t={dialog.t} budgetLines={budgetLines} seasonAvailable={seasonAvailable}
        onClose={() => setDialog(null)}
        onDone={(res) => {
          const t = dialog.t;
          refreshThen(() => { setDialog(null); toast(`Committed to ${t.name}.`, {
            undo: async () => {
              const r = await callAction(setTournamentStatus, { id: t.id, field: "decision", value: res.previous ?? "Considering", expected: "Committed" });
              router.refresh();
              return r;
            },
            undoneMessage: `${t.name} is back to ${res.previous ?? "Considering"}.`,
          }); });
        }} />
    )
  ) : null;

  return { run, busy, element };
}

/** The one quick action button for a tournament, or nothing. */
export function QuickButton({ t, quick, canWrite, variant = "secondary", size = "sm" }) {
  if (!canWrite) return null;
  const q = quickAction(t);
  if (!q) return null;
  const isBusy = quick.busy === t.id;
  return (
    <button type="button" className={`btn btn-${variant}${size === "sm" ? " btn-sm" : ""}`} disabled={isBusy}
      onClick={(e) => { e.stopPropagation(); quick.run(t); }}>
      {isBusy ? <><span className="st-spin" aria-hidden="true" />Saving</> : q.label}
    </button>
  );
}

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? "10000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
}

/**
 * Mark paid in full: one database save (status and Finance together).
 *
 * The dialog sends what it showed (status, paid so far, number of unpaid
 * entries). If the live figures differ the database saves nothing and returns
 * the new ones; the dialog updates and asks again. One request key per attempt
 * makes a double tap or retry return the first result instead of recording
 * twice. If an unpaid (To Pay) entry exists, that entry is marked Paid, so the
 * money is never recorded a second time.
 */
function PaidDialog({ t, transactions, budgetLines, onClose, onDone, onEditDetails }) {
  const first = tournamentPayments(t, transactions);
  const expenseLines = budgetLines.filter((l) => !l.is_income);
  const key = useRef(newKey());
  const [live, setLive] = useState({ status: t.paid_status, cost: first.cost ?? 0, paid: first.paid, remaining: first.remaining, entries: first.toPayEntries });
  const [entryId, setEntryId] = useState(first.toPayEntries[0]?.id ?? null);
  const entry = live.entries.find((x) => x.id === entryId) ?? live.entries[0] ?? null;
  const nothing = !entry && (live.remaining == null || live.remaining <= 0);
  // No cost at all: there is nothing Finance could record. Said plainly, with a way to set the cost first.
  const noCost = first.cost == null && live.cost === 0;
  const [also, setAlso] = useState(!nothing);
  const [amount, setAmount] = useState(String(entry ? entry.amount : live.remaining ?? ""));
  const [date, setDate] = useState(entry?.txn_date ?? todayIso());
  const [line, setLine] = useState(entry?.budget_item_id ?? t.budget_item_id ?? expenseLines[0]?.id ?? "");
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  // When the amount being recorded is less than what the tournament still owes,
  // the person must choose what happens to the difference: record it, or
  // correct the tournament cost. It is never left outstanding silently.
  const [fix, setFix] = useState(null);       // null | "record"
  const [recFrom, setRecFrom] = useState(0);  // the amount before "record" raised it
  const cents = (n) => Math.round(n * 100) / 100;
  const amt = Number(amount) || 0;
  const owed = live.remaining;
  const shortBy = also && !nothing && owed != null && amt > 0 ? cents(owed - (fix === "record" ? recFrom : amt)) : 0;
  const mismatch = shortBy > 0.004;

  function chooseFix(v) {
    if (v === "record" && fix !== "record") { setRecFrom(amt); setAmount(String(owed)); }
    setFix(v); setErr(null);
  }
  function editAmount(v) { setAmount(v); setFix(null); }

  function applyLive(state) {
    const entries = (state.to_pay ?? []).map((x) => ({ id: x.id, amount: Number(x.amount ?? 0), txn_date: x.txn_date, budget_item_id: x.budget_item_id }));
    const next = { status: state.status, cost: Number(state.total_cost ?? 0), paid: Number(state.paid), remaining: Number(state.remaining), entries };
    setLive(next);
    const e0 = entries[0] ?? null;
    setEntryId(e0?.id ?? null);
    setAmount(String(e0 ? e0.amount : next.remaining));
    setDate(e0?.txn_date ?? todayIso());
    setLine(e0?.budget_item_id ?? t.budget_item_id ?? line);
    setAlso(!(next.remaining <= 0 && !e0));
    setFix(null);
  }

  async function save() {
    if (saving) return;
    const amt = Number(amount);
    if (also && !nothing) {
      if (!(amt > 0)) return setErr("Enter an amount greater than zero.");
      if (!line) return setErr("Choose the budget line this payment counts against.");
      if (mismatch && !fix) return setErr(`Record the full ${money(owed)}, correct the cost in Edit details, or turn off the Finance entry to change only the status.`);
    }
    setSaving(true); setErr(null);
    const res = await callAction(markTournamentPaidInFull, {
      id: t.id, request_key: key.current,
      expected_status: live.status, expected_paid: live.paid, expected_to_pay_count: live.entries.length,
      // The cost and every unpaid entry as the dialog showed them: a changed cost or an edited entry is refused, not just a changed total.
      expected_cost: live.cost,
      expected_to_pay: JSON.stringify(live.entries.map((x) => ({ id: x.id, amount: x.amount, txn_date: x.txn_date, budget_item_id: x.budget_item_id }))),
      record_payment: also && !nothing ? "true" : "false",
      to_pay_id: also && !nothing && entry ? entry.id : null,
      amount: also && !nothing ? amt : null, date: also && !nothing ? date : null, budget_item_id: also && !nothing ? line : null,
    });
    if (res?.ok) return onDone(res);
    setSaving(false);
    if (res?.code === "changed" && res.state) {
      // Nothing was saved. Show the new figures and ask again with a fresh key (the request is different now).
      key.current = newKey();
      applyLive(res.state);
      setNotice("The balance changed while this was open. Nothing was saved. Check the new figures and save again.");
      return;
    }
    if (res?.code === "already_paid") { setNotice("This tournament was already marked paid in full. Nothing was changed."); return; }
    setErr(res?.error ?? "Couldn't save. Nothing was changed.");
  }

  return (
    <StSheet eyebrow="Payment" title={`Mark ${t.name} paid in full?`} onClose={onClose} busy={saving} size="sm"
      foot={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={`btn btn-primary${nothing && noCost ? " st-status-only" : ""}`} onClick={save} disabled={saving} data-autofocus>
          {saving ? <><span className="st-spin" aria-hidden="true" />Saving</> : err ? "Try again" : nothing && noCost ? "Mark paid, status only" : "Mark paid in full"}
        </button>
      </>}>
      <div className="st-change"><span>{live.status}</span><span aria-hidden="true">→</span><b>Paid in full</b></div>
      <dl className="st-kv">
        <div><dt>Total cost</dt><dd>{first.cost == null && live.cost === 0 ? "Not set" : money(live.cost)}</dd></div>
        <div><dt>Paid in Finance</dt><dd>{money(live.paid)}</dd></div>
        <div><dt>Still to pay</dt><dd><b>{live.remaining == null ? "Not set" : money(live.remaining)}</b></dd></div>
      </dl>
      {notice && <p className="st-note" role="alert">{notice}</p>}

      {nothing && noCost ? (
        <div className="st-nocost">
          <p className="st-note"><b>No cost is set for this tournament.</b> Marking it paid changes the status only. No Finance transaction recorded.</p>
          <button type="button" className="btn btn-secondary st-gap-edit" onClick={() => { onClose(); onEditDetails?.(t); }}>Add the cost first</button>
        </div>
      ) : nothing ? (
        <p className="st-note">Finance already shows the full cost as paid. This only changes the registration status.</p>
      ) : (
        <>
          <label className="st-check">
            <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} />
            <span>{entry ? "Also mark the unpaid Finance entry paid" : <>Also record the <b>{money(Number(amount) || 0)}</b> payment in Finance</>}</span>
          </label>
          {!also && <p className="st-note">Only the tournament status will change. No Finance transaction recorded.</p>}
          {also && entry && <p className="st-note">This marks the existing unpaid entry as paid. No second record is created.</p>}
          {also && (
            <>
              {live.entries.length > 1 && (
                <div className="field">
                  <label htmlFor="mp-entry">Which unpaid entry</label>
                  <select id="mp-entry" value={entry?.id ?? ""} onChange={(e) => { const x = live.entries.find((y) => y.id === e.target.value); setFix(null); setEntryId(x.id); setAmount(String(x.amount)); setDate(x.txn_date ?? todayIso()); setLine(x.budget_item_id ?? line); }}>
                    {live.entries.map((x) => <option key={x.id} value={x.id}>{money(x.amount)} on {x.txn_date}</option>)}
                  </select>
                </div>
              )}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="mp-amount">Amount</label>
                  <input id="mp-amount" type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => editAmount(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="mp-date">Date paid</label>
                  <input id="mp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              {mismatch && (
                <fieldset className="st-gap" aria-describedby="mp-gap-why">
                  <legend>The amounts don{"\u2019"}t match</legend>
                  <p id="mp-gap-why" className="st-note">
                    {money(live.cost)} is the tournament cost and {money(live.paid)} is paid, so {money(owed)} is still to pay. {entry ? <>The unpaid Finance entry is {money(fix === "record" ? recFrom : amt)}</> : <>You are recording {money(fix === "record" ? recFrom : amt)}</>}, which would leave <b>{money(shortBy)}</b> unpaid. Choose what to do about the difference.
                  </p>
                  <label className="st-radio">
                    <input type="radio" name="mp-fix" value="record" checked={fix === "record"} onChange={() => chooseFix("record")} />
                    <span><b>Record the full {money(owed)}</b><small>{entry ? `Raises the unpaid entry from ${money(recFrom || amt)} to ${money(owed)} and marks it paid.` : `Records ${money(owed)} as paid.`}</small></span>
                  </label>
                  <button type="button" className="btn btn-secondary st-gap-edit" onClick={() => { onClose(); onEditDetails?.(t); }}>
                    Correct the cost in Edit details
                  </button>
                  <p className="st-note">Closes this and opens Edit details. After you fix the cost, open Mark paid in full again.</p>
                </fieldset>
              )}
              <div className="field">
                <label htmlFor="mp-line">Budget line</label>
                <select id="mp-line" value={line} onChange={(e) => setLine(e.target.value)}>
                  {!line && <option value="">Choose a line</option>}
                  {expenseLines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </>
          )}
        </>
      )}
      <SheetError>{err}</SheetError>
    </StSheet>
  );
}

function CommitDialog({ t, budgetLines, seasonAvailable, onClose, onDone }) {
  const line = budgetLines.find((l) => l.id === t.budget_item_id) ?? null;
  const cost = Number(t.total_cost ?? 0);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setErr(null);
    const res = await callAction(setTournamentStatus, { id: t.id, field: "decision", value: "Committed" });
    if (res?.ok) return onDone(res);
    setSaving(false);
    setErr(res?.error ?? "Couldn't save. Nothing was changed.");
  }
  return (
    <StSheet eyebrow="Decision" title={`Commit to ${t.name}?`} onClose={onClose} busy={saving} size="sm"
      foot={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} data-autofocus>
          {saving ? <><span className="st-spin" aria-hidden="true" />Saving</> : err ? "Try again" : "Commit"}
        </button>
      </>}>
      <div className="st-change"><span>Considering</span><span aria-hidden="true">→</span><b>Committed</b></div>
      {t.total_cost == null ? (
        <p className="st-note">No cost is set yet, so the budget won&rsquo;t change until you add its fees.</p>
      ) : line ? (
        <dl className="st-kv">
          <div><dt>Adds to {line.name}</dt><dd>{money(cost)}</dd></div>
          <div><dt>{line.name} available</dt><dd>{money(line.available)} → <b>{money(line.available - cost)}</b></dd></div>
          {seasonAvailable != null && <div><dt>Available budget</dt><dd>{money(seasonAvailable)} → <b>{money(seasonAvailable - cost)}</b></dd></div>}
        </dl>
      ) : (
        <p className="st-note">It isn&rsquo;t on a budget line yet, so its {money(cost)} won&rsquo;t reduce Available budget until you assign one.</p>
      )}
      <p className="st-note">It will show as not registered until you mark it.</p>
      <SheetError>{err}</SheetError>
    </StSheet>
  );
}
