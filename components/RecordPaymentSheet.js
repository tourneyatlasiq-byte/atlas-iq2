"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "../lib/finance-rules";
import { recordPayment, undoRecordedPayment } from "../lib/actions/finance";
import { useToast } from "./Toaster";
import { StSheet, SheetError, callAction, todayIso, fmtDay, useRefreshThen } from "./StSheet";

/**
 * Record a dues payment. Used from Home and Finance.
 *
 * The amount starts at the player's balance and stays editable, so a partial
 * payment is one edit. recordPayment's rules are unchanged: an obligation must
 * exist and any positive amount is accepted (the server allows more than the
 * balance, so this warns rather than blocks).
 *
 * Duplicate prevention: the button is disabled while saving, and a payment with
 * the same amount and date already in the history needs an explicit second
 * confirmation. Two coaches entering the same cheque is the realistic case.
 */
export function RecordPaymentSheet({ p, onClose, onSaved }) {
  const router = useRouter();
  const toast = useToast();
  const balance = Math.max(0, Number(p.balance ?? 0));
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : "");
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  const [, refreshThen] = useRefreshThen();
  // One key per open sheet: a double tap or a retry after a bad connection returns the first result.
  const key = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);

  const a = Math.round(Number(String(amount).replace(/[$,\s]/g, "")) * 100) / 100;
  const valid = Number.isFinite(a) && a > 0;
  const dup = valid && (p.log ?? []).find((l) => Math.round(Number(l.amount) * 100) === Math.round(a * 100) && l.paid_date === date);
  const over = valid && balance > 0 && a > balance;

  async function save() {
    if (!valid) return;
    if (dup && !confirmDup) { setConfirmDup(true); return; }
    setSaving(true); setErr(null);
    // expected_paid: what this sheet showed. If another screen recorded a payment first, the database refuses and nothing is double counted.
    const res = await callAction(recordPayment, { payment_id: p.id, request_key: key.current, expected_paid: p.totalPaid, amount: a, paid_date: date, month_label: label || null });
    if (!res?.ok) {
      setSaving(false);
      if (res?.code === "changed") { router.refresh(); setErr(`${res.error} The balance shown here is being refreshed. Check it and save again.`); return; }
      setErr(res?.error ?? "Couldn't save the payment.");
      return;
    }
    onSaved?.(p.id);
    const left = Math.max(0, Math.round((balance - a) * 100) / 100);
    // Closes once the refreshed balances are on screen.
    refreshThen(() => {
      onClose();
      toast(res.duplicate ? `That payment from ${p.displayName} was already recorded. Nothing was added twice.` : `Recorded ${money(a)} from ${p.displayName}. ${left > 0 ? `${money(left)} left.` : "Paid in full."}`, {
        // The database decides: Undo is refused once the dues or payments changed after this save.
        undo: res.operation_id && !res.duplicate ? async () => { const r = await callAction(undoRecordedPayment, { operation_id: res.operation_id }); router.refresh(); return r; } : undefined,
        undoneMessage: "Payment removed.",
      });
    });
  }

  const paidPct = p.totalDue > 0 ? Math.min(100, (p.totalPaid / p.totalDue) * 100) : 0;
  return (
    <StSheet eyebrow="Record payment" title={p.displayName} onClose={onClose} busy={saving}
      foot={<>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!valid || saving}>
          {saving ? <><span className="st-spin" aria-hidden="true" />Saving</>
            : confirmDup ? `Record another ${money(a)}`
            : err ? "Try again"
            : valid ? `Record ${money(a)}` : "Enter an amount"}
        </button>
      </>}>
      <div className="st-balance">
        <span className="st-eyebrow">{balance > 0 ? "Balance" : "Settled"}</span>
        <span className="st-balance-fig">{money(balance)}</span>
        <span className="st-balance-sub">{money(p.totalPaid)} paid of {money(p.totalDue)} dues</span>
        <span className="st-bar" aria-hidden="true"><i className="st-bar-dues" style={{ width: `${paidPct}%` }} /></span>
      </div>

      <div className="field">
        <label htmlFor="rp-amount">Amount received</label>
        <div className="st-money">
          <input id="rp-amount" inputMode="decimal" autoComplete="off" value={amount} data-autofocus
            onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, "")); setConfirmDup(false); }} />
        </div>
        {balance > 0 && (
          <div className="st-quick" role="group" aria-label="Quick amounts">
            <button type="button" aria-pressed={a === balance} onClick={() => { setAmount(balance.toFixed(2)); setConfirmDup(false); }}>Full balance {money(balance)}</button>
            <button type="button" aria-pressed={a === Math.round(balance * 50) / 100} onClick={() => { setAmount((Math.round(balance * 50) / 100).toFixed(2)); setConfirmDup(false); }}>Half {money(Math.round(balance * 50) / 100)}</button>
          </div>
        )}
        {over && <p className="st-warn">That&rsquo;s more than the {money(balance)} balance. The extra will show as overpaid.</p>}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="rp-date">Date received</label>
          <input id="rp-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setConfirmDup(false); }} />
        </div>
        <div className="field">
          <label htmlFor="rp-label">For <span className="muted">(optional)</span></label>
          <input id="rp-label" value={label} placeholder="e.g. Winter dues" onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      {dup && confirmDup && (
        <div className="st-dup" role="alert">
          <b>A {money(a)} payment on this date is already recorded.</b> If this is a second payment, choose Record another. If it&rsquo;s the same payment, cancel.
        </div>
      )}
      <SheetError>{err}</SheetError>

      <div>
        <p className="st-eyebrow" style={{ margin: "4px 0 0" }}>Payment history</p>
        <ul className="st-hist">
          {(p.log ?? []).length === 0 ? <li><span>No payments yet</span></li> :
            p.log.map((l) => (
              <li key={l.id}><span>{l.paid_date ? fmtDay(l.paid_date) : "No date"}{l.month_label ? ` · ${l.month_label}` : ""}</span><b>{money(l.amount)}</b></li>
            ))}
        </ul>
      </div>
    </StSheet>
  );
}
