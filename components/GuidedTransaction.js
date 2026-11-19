"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money, budgetLineFinance, sumMoney, isBlockedIncomeCategory, CATEGORIES } from "../lib/finance-rules";
import { saveTransaction, undoNewTransaction, saveBudgetItem } from "../lib/actions/finance";
import { addTournament, setTournamentBudgetLine } from "../lib/actions/tournaments";
import { useToast } from "./Toaster";
import { StSheet, SheetError, callAction, todayIso, fmtDay, useRefreshThen } from "./StSheet";

/**
 * Add transaction, one question at a time (requirements:
 * claude/finance-add-transaction-guided-entry.md).
 *
 *   1 What it's for      kind and description
 *   2 Where it counts    tournament and budget line, adapted to the kind
 *   3 How much           amount, Paid / To pay, date, payee, More details
 *   4 Review             what changes, duplicate check, save
 *
 * saveTransaction's rules are unchanged and still decide: a budget line is
 * required, it must belong to this season, income is always Paid, Player Dues
 * income is refused. Editing an existing transaction keeps the full form.
 *
 * A missing tournament or budget line is created inside the flow. The draft is
 * held in this component's state the whole time, so nothing typed is lost.
 */
const KINDS = [
  { id: "tournament", label: "Tournament fee", hint: "Entry, gate fee or deposit", category: "Tournament Fees" },
  { id: "uniforms", label: "Uniforms and gear", hint: "Jerseys, pants, bags", category: "Player Uniforms" },
  { id: "facility", label: "Field or facility", hint: "Rentals, lights, cages", category: "Field / Facility Costs" },
  { id: "equipment", label: "Equipment", hint: "Bats, helmets, balls", category: "Equipment" },
  { id: "other", label: "Other expense", hint: "Anything else you pay", category: null },
  { id: "income", label: "Money in", hint: "Sponsor, fundraiser, other", category: null },
];

export function GuidedTransaction({ budgetItems = [], tournaments = [], players = [], facilities = [], transactions = [], onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState({ step: 1, kind: "", item: "", tid: "", lid: "", amount: "", status: "Paid", date: todayIso(), vendor: "", playerId: "", facilityId: "", quantity: "", notes: "", q: "" });
  const [sub, setSub] = useState(null); // null | { kind: "t" | "l", ...fields }
  const [extraT, setExtraT] = useState([]);
  const [extraL, setExtraL] = useState([]);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dupOk, setDupOk] = useState(false);
  // A tournament with no budget line can be put on the chosen line at save,
  // as the full form already offers. Ticked by default; never touches a
  // tournament that already has a line.
  const [assignT, setAssignT] = useState(true);
  const [, refreshThen] = useRefreshThen();
  // One key per open sheet: a double tap or a retry after a bad connection returns the first row instead of adding a second.
  const key = useRef(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  const allT = useMemo(() => [...tournaments, ...extraT.filter((e) => !tournaments.some((t) => t.id === e.id))], [tournaments, extraT]);
  const allL = useMemo(() => [...budgetItems, ...extraL.filter((e) => !budgetItems.some((b) => b.id === e.id))], [budgetItems, extraL]);
  const kind = KINDS.find((k) => k.id === d.kind) ?? null;
  const income = d.kind === "income";
  const lines = allL.filter((l) => (income ? l.is_income && !isBlockedIncomeCategory(l.category) : !l.is_income));
  const tourn = allT.find((t) => t.id === d.tid) ?? null;
  const line = allL.find((l) => l.id === d.lid) ?? null;
  const amt = Math.round(Number(String(d.amount).replace(/[$,\s]/g, "")) * 100) / 100;
  const amountOk = Number.isFinite(amt) && amt > 0;

  const fin = (txns, l, ts = allT) => budgetLineFinance(l, txns, ts);
  const seasonAvail = (txns, ts = allT) => {
    const ex = allL.filter((l) => !l.is_income).map((l) => fin(txns, l, ts));
    return sumMoney([sumMoney(ex.map((f) => f.planned)), -sumMoney(ex.map((f) => f.committed))]);
  };

  function pickKind(k) {
    const def = k.category ? allL.find((l) => !l.is_income && l.category === k.category) : null;
    set({ kind: k.id, lid: k.id === "income" ? (allL.find((l) => l.is_income && !isBlockedIncomeCategory(l.category))?.id ?? "") : def?.id ?? (d.kind === "income" ? "" : d.lid), status: k.id === "income" ? "Paid" : d.status });
  }
  function pickTournament(t) {
    set({ tid: t.id, lid: d.kind === "tournament" && t.budget_item_id ? t.budget_item_id : d.lid, vendor: d.vendor || (t.provider?.name ?? "") });
    setNotice(null);
  }
  const next = () => { setErr(null); setNotice(null); set({ step: d.step + 1 }); };
  const back = () => { setErr(null); set({ step: d.step - 1 }); };

  const step2Ok = (d.kind === "tournament" ? Boolean(d.tid) : true) && Boolean(d.lid);
  const draftItem = d.item.trim() || (tourn ? `${tourn.name}${d.kind === "tournament" ? " entry" : ""}` : kind?.label ?? "");

  const draftTxn = { id: "draft", budget_item_id: d.lid, tournament_id: d.tid || null, is_income: income, status: income ? "Paid" : d.status, actual_amount: amt };
  const dups = amountOk ? transactions.filter((x) =>
    Math.round(Number(x.actual_amount) * 100) === Math.round(amt * 100) && x.txn_date === d.date &&
    (d.tid ? x.tournament_id === d.tid : x.budget_item_id === d.lid)) : [];

  async function save() {
    if (dups.length && !dupOk) { setDupOk(true); return; }
    setSaving(true); setErr(null);
    const res = await callAction(saveTransaction, {
      budget_item_id: d.lid, item: draftItem, txn_date: d.date, vendor: d.vendor || null,
      actual_amount: amt, status: income ? null : d.status, tournament_id: d.tid || null,
      player_id: d.playerId || null, facility_id: d.facilityId || null, quantity: d.quantity || null, notes: d.notes || null,
      request_key: key.current,
    });
    if (!res?.ok) { setSaving(false); setErr(res?.error ?? "Couldn't save the transaction."); return; }
    let assignNote = "";
    if (tourn && !income && !tourn.budget_item_id && assignT && d.lid) {
      const r2 = await callAction(setTournamentBudgetLine, { tournament_id: tourn.id, budget_item_id: d.lid });
      assignNote = r2?.ok ? ` ${tourn.name} now counts against ${line?.name ?? "that line"}.` : ` The transaction is saved, but ${tourn.name} couldn't be put on the budget line: ${r2?.error ?? ""}`;
    }
    refreshThen(() => { onClose();
    toast(res.duplicate ? `${draftItem} was already saved. Nothing was added twice.` : `Saved ${draftItem}, ${money(amt)}${income ? " received" : d.status === "To Pay" ? " to pay" : " paid"}.${assignNote}`, {
      // Removes the row only while it is still exactly as saved (a later edit makes Undo refuse).
      undo: res.id && !res.duplicate ? async () => {
        const r = await callAction(undoNewTransaction, { id: res.id, expected_amount: amt, expected_status: income ? "Paid" : d.status, expected_date: d.date, expected_budget_item_id: d.lid, expected_item: draftItem });
        router.refresh();
        return r;
      } : undefined,
      undoneMessage: "Transaction removed.",
    }); });
  }

  /* ---------- inline creation ---------- */
  async function saveNewTournament() {
    const s = sub;
    if (!s.name?.trim() || !s.start) { setErr("Add a name and a start date."); return; }
    setSaving(true); setErr(null);
    const res = await callAction(addTournament, { name: s.name.trim(), start_date: s.start, end_date: s.end || s.start, entry_fee: s.fee || null, decision: s.decision ?? "Committed", paid_status: "Not Registered" });
    if (!res?.ok || !res.id) { setSaving(false); setErr(res?.error ?? "Couldn't add the tournament."); return; }
    let lineId = s.lid || "";
    if (lineId) {
      const r2 = await callAction(setTournamentBudgetLine, { tournament_id: res.id, budget_item_id: lineId });
      if (!r2?.ok) { lineId = ""; setNotice(`${s.name.trim()} was added, but its budget line couldn't be set: ${r2?.error ?? ""} Choose a line below.`); }
    }
    setSaving(false);
    const fee = s.fee === "" || s.fee == null ? null : Number(s.fee);
    setExtraT((x) => [...x, { id: res.id, name: s.name.trim(), start_date: s.start, end_date: s.end || s.start, total_cost: fee, budget_item_id: lineId || null, decision: s.decision ?? "Committed", paid_status: "Not Registered" }]);
    setSub(null);
    set({ tid: res.id, lid: d.kind === "tournament" ? (lineId || d.lid) : d.lid, q: "" });
    setNotice((n) => n ?? `${s.name.trim()} is on your season plan. Your transaction is just as you left it.`);
    router.refresh();
  }
  async function saveNewLine() {
    const s = sub;
    if (!s.name?.trim()) { setErr("Give the line a name."); return; }
    setSaving(true); setErr(null);
    const res = await callAction(saveBudgetItem, { name: s.name.trim(), category: s.category || "Other", budgeted: s.amount || 0, is_income: income ? "true" : "false", budget_method: "total" });
    setSaving(false);
    if (!res?.ok || !res.item) { setErr(res?.error ?? "Couldn't add the budget line."); return; }
    setExtraL((x) => [...x, res.item]);
    setSub(null);
    set({ lid: res.item.id });
    setNotice(`${res.item.name} is in your budget. Your transaction is just as you left it.`);
    router.refresh();
  }

  if (sub?.kind === "t") {
    return (
      <StSheet eyebrow="New tournament" title={sub.name?.trim() || "Add a tournament"} onClose={onClose} busy={saving}
        back={{ label: "Back to transaction", onClick: () => { setErr(null); setSub(null); } }}
        foot={<>
          <button type="button" className="btn btn-secondary" onClick={() => { setErr(null); setSub(null); }} disabled={saving}>Back</button>
          <button type="button" className="btn btn-primary" onClick={saveNewTournament} disabled={saving}>{saving ? <><span className="st-spin" aria-hidden="true" />Saving</> : err ? "Try again" : "Add tournament"}</button>
        </>}>
        <p className="st-note">Your transaction is kept as a draft while you add this.</p>
        <div className="field"><label htmlFor="gt-nt-name">Tournament name</label><input id="gt-nt-name" data-autofocus value={sub.name ?? ""} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="gt-nt-start">Starts</label><input id="gt-nt-start" type="date" value={sub.start ?? ""} onChange={(e) => setSub({ ...sub, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="gt-nt-end">Ends</label><input id="gt-nt-end" type="date" value={sub.end ?? ""} onChange={(e) => setSub({ ...sub, end: e.target.value })} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label htmlFor="gt-nt-fee">Entry fee</label><input id="gt-nt-fee" inputMode="decimal" value={sub.fee ?? ""} onChange={(e) => setSub({ ...sub, fee: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
          <div className="field"><label htmlFor="gt-nt-line">Budget line</label>
            <select id="gt-nt-line" value={sub.lid ?? ""} onChange={(e) => setSub({ ...sub, lid: e.target.value })}>
              <option value="">No budget line yet</option>
              {allL.filter((l) => !l.is_income).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></div>
        </div>
        <div className="field"><span className="st-label">Decision</span>
          <div className="st-seg" role="group" aria-label="Decision">
            {["Committed", "Considering"].map((v) => <button key={v} type="button" aria-pressed={(sub.decision ?? "Committed") === v} onClick={() => setSub({ ...sub, decision: v })}>{v}</button>)}
          </div>
          <span className="st-hint">Committed tournaments count against their budget line. You can add the organizer, venue and more from Tournaments later.</span>
        </div>
        <SheetError>{err}</SheetError>
      </StSheet>
    );
  }
  if (sub?.kind === "l") {
    return (
      <StSheet eyebrow="New budget line" title={sub.name?.trim() || "Add a budget line"} onClose={onClose} busy={saving}
        back={{ label: "Back to transaction", onClick: () => { setErr(null); setSub(null); } }}
        foot={<>
          <button type="button" className="btn btn-secondary" onClick={() => { setErr(null); setSub(null); }} disabled={saving}>Back</button>
          <button type="button" className="btn btn-primary" onClick={saveNewLine} disabled={saving}>{saving ? <><span className="st-spin" aria-hidden="true" />Saving</> : err ? "Try again" : "Add budget line"}</button>
        </>}>
        <p className="st-note">Your transaction is kept as a draft while you add this.</p>
        <div className="field"><label htmlFor="gt-nl-name">Line name</label><input id="gt-nl-name" data-autofocus value={sub.name ?? ""} placeholder={income ? "e.g. Sponsors" : "e.g. Hotel block"} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></div>
        <div className="field-row">
          <div className="field"><label htmlFor="gt-nl-cat">Category</label>
            <select id="gt-nl-cat" value={sub.category ?? ""} onChange={(e) => setSub({ ...sub, category: e.target.value })}>
              {CATEGORIES.filter((c) => !(income && isBlockedIncomeCategory(c))).map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div className="field"><label htmlFor="gt-nl-amt">{income ? "Expected for the season" : "Planned for the season"}</label><input id="gt-nl-amt" inputMode="decimal" value={sub.amount ?? ""} onChange={(e) => setSub({ ...sub, amount: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
        </div>
        <SheetError>{err}</SheetError>
      </StSheet>
    );
  }

  const TITLES = ["What's it for?", income ? "Which income line?" : "Where does it count?", income ? "How much came in?" : "How much?", "Check and save"];
  const prog = <div className="st-prog" aria-hidden="true">{[1, 2, 3, 4].map((i) => <i key={i} className={d.step >= i ? "on" : ""} />)}</div>;
  const backBtn = d.step > 1
    ? <button type="button" className="btn btn-secondary" onClick={back} disabled={saving}>Back</button>
    : <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>;

  let body = null, primary = null;
  if (d.step === 1) {
    body = (<>
      <div className="st-kinds" role="group" aria-label="What it's for">
        {KINDS.map((k) => (
          <button key={k.id} type="button" aria-pressed={d.kind === k.id} onClick={() => pickKind(k)}>
            <b>{k.label}</b><span>{k.hint}</span>
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="gt-item">Description</label>
        <input id="gt-item" value={d.item} placeholder={d.kind === "tournament" ? "Filled in from the tournament if left blank" : "e.g. Practice balls"} onChange={(e) => set({ item: e.target.value })} />
      </div>
    </>);
    primary = <button type="button" className="btn btn-primary" onClick={next} disabled={!d.kind}>Next</button>;
  }
  if (d.step === 2) {
    const ql = d.q.trim().toLowerCase();
    const today = todayIso();
    const tList = allT.filter((t) => t.decision !== "Declined" && ((t.end_date ?? t.start_date ?? "") >= today || t.id === d.tid))
      .filter((t) => !ql || t.name.toLowerCase().includes(ql)).sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
    const tPicker = (
      <div className="field">
        <label htmlFor="gt-q">{d.kind === "tournament" ? "Which tournament?" : "For a tournament? (optional)"}</label>
        <input id="gt-q" value={d.q} placeholder="Search this season's tournaments" autoComplete="off" onChange={(e) => set({ q: e.target.value })} />
        <div className="st-picker" role="group" aria-label="Tournaments">
          {d.kind !== "tournament" && (
            <button type="button" className="st-opt" aria-pressed={!d.tid} onClick={() => set({ tid: "" })}><span className="st-rad" /><span><b>Not for a tournament</b></span></button>
          )}
          {tList.slice(0, 6).map((t) => (
            <button key={t.id} type="button" className="st-opt" aria-pressed={d.tid === t.id} onClick={() => pickTournament(t)}>
              <span className="st-rad" />
              <span style={{ minWidth: 0 }}><b>{t.name}</b><span>{t.start_date ? fmtDay(t.start_date) : "No date"} · {t.decision === "Considering" ? "Considering" : t.paid_status}</span></span>
              <span className="st-opt-fig">{t.total_cost == null ? "" : money(t.total_cost)}</span>
            </button>
          ))}
          <button type="button" className="st-opt is-add" onClick={() => { setErr(null); setSub({ kind: "t", name: d.q.trim(), decision: "Committed", fee: d.amount, lid: allL.find((l) => !l.is_income && l.category === "Tournament Fees")?.id ?? "" }); }}>
            <span aria-hidden="true">+</span><span>{d.q.trim() && tList.length === 0 ? `Add “${d.q.trim()}” as a new tournament` : "Add a tournament that isn’t listed"}</span>
          </button>
        </div>
      </div>
    );
    const lPicker = (
      <div className="field">
        <span className="st-label">{income ? "Income line" : "Budget line"}</span>
        {tourn && d.kind === "tournament" && tourn.budget_item_id === d.lid && d.lid && <span className="st-hint">Suggested from the tournament.</span>}
        {income && <span className="st-hint">Player dues are recorded under Player Dues, not here.</span>}
        <div className="st-picker" role="group" aria-label={income ? "Income lines" : "Budget lines"}>
          {lines.map((l) => {
            const f = fin(transactions, l);
            return (
              <button key={l.id} type="button" className="st-opt" aria-pressed={d.lid === l.id} onClick={() => set({ lid: l.id })}>
                <span className="st-rad" /><span style={{ minWidth: 0 }}><b>{l.name}</b><span>{income ? l.category : `${money(f.available)} available`}</span></span>
              </button>
            );
          })}
          <button type="button" className="st-opt is-add" onClick={() => { setErr(null); setSub({ kind: "l", category: kind?.category ?? (income ? "Sponsors" : "Other") }); }}>
            <span aria-hidden="true">+</span><span>Add a{income ? "n income" : " budget"} line</span>
          </button>
        </div>
      </div>
    );
    body = (<>
      {notice && <p className="st-ok" role="status">{notice}</p>}
      {d.kind === "tournament" ? <>{tPicker}{lPicker}</> : <>{lPicker}{tPicker}</>}
    </>);
    primary = <button type="button" className="btn btn-primary" onClick={next} disabled={!step2Ok}>Next</button>;
  }
  if (d.step === 3) {
    body = (<>
      <div className="field">
        <label htmlFor="gt-amt">Amount</label>
        <div className="st-money"><input id="gt-amt" inputMode="decimal" autoComplete="off" data-autofocus value={d.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
        {d.kind === "tournament" && tourn?.total_cost != null && !d.amount && (
          <div className="st-quick"><button type="button" onClick={() => set({ amount: Number(tourn.total_cost).toFixed(2) })}>Full cost {money(tourn.total_cost)}</button></div>
        )}
      </div>
      {income ? <p className="st-note">Money in is recorded as received.</p> : (
        <div className="field"><span className="st-label">Status</span>
          <div className="st-seg" role="group" aria-label="Status">
            {[["Paid", "Paid"], ["To Pay", "To pay"]].map(([v, l]) => <button key={v} type="button" aria-pressed={d.status === v} onClick={() => set({ status: v })}>{l}</button>)}
          </div>
          <span className="st-hint">{d.status === "Paid" ? "Money has left the account." : "Owed, not paid yet. Shows in To pay until it’s marked Paid."}</span>
        </div>
      )}
      <div className="field-row">
        <div className="field"><label htmlFor="gt-date">Date</label><input id="gt-date" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></div>
        <div className="field"><label htmlFor="gt-vendor">{income ? "Received from" : "Paid to"}</label><input id="gt-vendor" value={d.vendor} onChange={(e) => set({ vendor: e.target.value })} /></div>
      </div>
      <details className="st-more">
        <summary>More details</summary>
        <div className="field-row">
          <div className="field"><label htmlFor="gt-player">Player</label>
            <select id="gt-player" value={d.playerId} onChange={(e) => set({ playerId: e.target.value })}><option value="">None</option>{players.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          <div className="field"><label htmlFor="gt-fac">Facility</label>
            <select id="gt-fac" value={d.facilityId} onChange={(e) => set({ facilityId: e.target.value })}><option value="">None</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="gt-qty">Quantity</label><input id="gt-qty" inputMode="numeric" value={d.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
        <div className="field"><label htmlFor="gt-notes">Notes</label><textarea id="gt-notes" rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
      </details>
    </>);
    primary = <button type="button" className="btn btn-primary" onClick={next} disabled={!amountOk}>Review</button>;
  }
  if (d.step === 4) {
    const before = line ? fin(transactions, line) : null;
    // Simulated exactly as the save would leave things, including putting an
    // unassigned tournament on this line when that box is ticked.
    const simT = tourn && !tourn.budget_item_id && assignT && d.lid ? allT.map((t) => (t.id === tourn.id ? { ...t, budget_item_id: d.lid } : t)) : allT;
    const after = line ? fin([...transactions, draftTxn], line, simT) : null;
    const sBefore = seasonAvail(transactions), sAfter = seasonAvail([...transactions, draftTxn], simT);
    const absorbed = !income && tourn && tourn.decision === "Committed" && (tourn.budget_item_id === d.lid) && Math.round(sBefore * 100) === Math.round(sAfter * 100);
    const edit = (s) => <button type="button" className="st-link" onClick={() => set({ step: s })}>Edit</button>;
    body = (<>
      <ul className="st-review">
        <li><span>What</span><b>{draftItem}</b>{edit(1)}</li>
        <li><span>Kind</span><b>{kind?.label}</b>{edit(1)}</li>
        {tourn && <li><span>Tournament</span><b>{tourn.name}</b>{edit(2)}</li>}
        <li><span>{income ? "Income line" : "Budget line"}</span><b>{line?.name ?? "None"}</b>{edit(2)}</li>
        <li><span>Amount</span><b>{money(amt)}{income ? " received" : ` · ${d.status === "To Pay" ? "To pay" : "Paid"}`}</b>{edit(3)}</li>
        <li><span>Date</span><b>{fmtDay(d.date)}{d.vendor ? ` · ${d.vendor}` : ""}</b>{edit(3)}</li>
      </ul>
      {!income && line && (
        <div className="st-impact">
          <span className="st-eyebrow">What changes</span>
          <div><span>{line.name} available</span><b>{money(before.available)} → {money(after.available)}</b></div>
          <div><span>Available budget</span><b>{money(sBefore)} → {money(sAfter)}</b></div>
          {absorbed && <p>It&rsquo;s recorded against {tourn.name}&rsquo;s {money(tourn.total_cost)} commitment, which is already counted, so Available budget doesn&rsquo;t change.</p>}
        </div>
      )}
      {tourn && !income && !tourn.budget_item_id && d.lid && (
        <label className="st-check">
          <input type="checkbox" checked={assignT} onChange={(e) => setAssignT(e.target.checked)} />
          <span>{tourn.name} isn&rsquo;t on a budget line. Put it on <b>{line?.name}</b> too, so its full cost counts in Available budget.</span>
        </label>
      )}
      {income && <div className="st-impact"><span className="st-eyebrow">What changes</span><div><span>Money In</span><b>+{money(amt)}</b></div></div>}
      {dups.length > 0 && dupOk && (
        <div className="st-dup" role="alert"><b>A {money(amt)} transaction on this date is already recorded{tourn ? ` for ${tourn.name}` : line ? ` on ${line.name}` : ""}:</b> {dups[0].item ?? "untitled"}. If this is a separate payment, choose Save anyway. If not, go back.</div>
      )}
      <SheetError>{err}</SheetError>
    </>);
    primary = <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? <><span className="st-spin" aria-hidden="true" />Saving</> : dups.length && dupOk ? "Save anyway" : err ? "Try again" : "Save transaction"}</button>;
  }

  return (
    <StSheet eyebrow={`Add transaction · Step ${d.step} of 4`} title={TITLES[d.step - 1]} onClose={onClose} busy={saving}
      foot={<>{backBtn}<span className="st-grow" />{primary}</>}>
      {prog}
      {body}
    </StSheet>
  );
}
