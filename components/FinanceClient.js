"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { NeedsAction, FilterChip } from "./NeedsAction";
import { financeActions, FINANCE_FILTER_LABELS } from "../lib/readiness/finance";
import { isActual, CATEGORIES, TXN_STATUSES } from "../lib/finance-rules";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { HelpTip } from "./HelpTip";
import {
  saveBudgetItem,
  deleteBudgetItem,
  saveTransaction,
  deleteTransaction,
  savePlayerPayment,
  recordPayment,
  deletePaymentEntry,
} from "../lib/actions/finance";

const money = (n) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

const statusClass = (s) =>
  s === "Paid" ? "pill-paid"
  : s === "Received" ? "pill-registered"
  : s === "Ordered" ? "pill-deposit"
  : "pill-unregistered";

const payClass = (s) =>
  s === "Paid in Full" ? "pill-paid" : s === "Partial" ? "pill-deposit" : "pill-unregistered";

export function FinanceClient({
  budget, transactions, payments, summary, funds, dues, committedTournaments,
  tournaments, players, facilities, budgetItems, canWrite, seasonName,
  // Review surface only: lets /review render each tab. Defaults to the normal
  // starting tab, so nothing changes in the application itself.
  initialTab = "budget",
}) {
  const [tab, setTab] = useState(initialTab);
  const [actionId, setActionId] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const [editBudget, setEditBudget] = useState(null);
  const [editTxn, setEditTxn] = useState(null);
  const [detailTxn, setDetailTxn] = useState(null);
  const [detailPay, setDetailPay] = useState(null);
  const [editPay, setEditPay] = useState(null);
  const [openCats, setOpenCats] = useState({});

  const actions = useMemo(() => financeActions(payments), [payments]);

  useEffect(() => {
    if (actionId && !actions.some((a) => a.id === actionId)) setActionId(null);
  }, [actions, actionId]);

  const activeAction = actions.find((a) => a.id === actionId) ?? null;

  const overlayOpen = Boolean(editBudget || editTxn || detailTxn || detailPay || editPay);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editBudget) setEditBudget(null);
      else if (editTxn) setEditTxn(null);
      else if (editPay) setEditPay(null);
      else if (detailTxn) setDetailTxn(null);
      else setDetailPay(null);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editBudget, editTxn, editPay, detailTxn]);

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.();
      else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  function selectAction(id) {
    setActionId(id);
    if (id) setTab("payments");
  }

  const visiblePayments = activeAction
    ? payments.filter((p) => activeAction.affected.some((a) => a.id === p.id))
    : payments;

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Finance</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.finance}</div>
        </div>
      </div>

      {/* One tile per question. Funds In is never netted against expenses —
          they are two true figures side by side, not a net position. */}
      <div className="stat-grid stat-grid-3">
        <div className="card">
          <div className="stat-label">Remaining budget</div>
          <div className="stat-value">{money(summary.remainingBudget)}</div>
          <div className="stat-foot">
            {money(summary.actualExpenses)} spent of {money(summary.budgetedExpenses)}
          </div>
        </div>

        <div className="card">
          <div className="stat-label">Funds in <HelpTip term="Funds In" /></div>
          <div className="stat-value">{money(funds.total)}</div>
          <div className="stat-foot">
            {money(funds.playerDues)} dues · {money(funds.otherTotal)} other
          </div>
        </div>

        <div className={`card${dues.outstanding > 0 ? " card-alert" : ""}`}>
          <div className="stat-label">Outstanding dues</div>
          <div className="stat-value">{money(dues.outstanding)}</div>
          <div className="stat-foot">
            {money(dues.collected)} of {money(dues.expected)} collected
          </div>
        </div>
      </div>

      <NeedsAction actions={actions} activeId={actionId} onSelect={selectAction} showWhenClear />

      {activeAction && (
        <FilterChip
          label={`Showing ${activeAction.affected.length} ${FINANCE_FILTER_LABELS[activeAction.id] ?? "affected"}`}
          onClear={() => setActionId(null)}
        />
      )}

      <div className="tabs" role="tablist">
        {[
          { key: "budget", label: "Budget" },
          { key: "funds", label: "Funds In" },
          { key: "transactions", label: "Transactions" },
          { key: "payments", label: "Player Payments" },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? " on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "budget" && (
        <BudgetTab
          budget={budget}
          summary={summary}
          committedTournaments={committedTournaments}
          openCats={openCats}
          setOpenCats={setOpenCats}
          canWrite={canWrite}
          onAdd={() => setEditBudget("new")}
          onEdit={(row) => setEditBudget(row)}
          onDelete={(row) => {
            if (!confirm(`Delete the budget line "${row.name}"?`)) return;
            const fd = new FormData();
            fd.set("id", row.id);
            run(deleteBudgetItem, fd);
          }}
          pending={pending}
        />
      )}

      {tab === "funds" && <FundsInTab funds={funds} dues={dues} />}

      {tab === "transactions" && (
        <TransactionsTab
          transactions={transactions}
          canWrite={canWrite}
          onAdd={() => setEditTxn("new")}
          onOpen={(t) => setDetailTxn(t)}
        />
      )}

      {tab === "payments" && (
        <PaymentsTab
          payments={visiblePayments}
          canWrite={canWrite}
          onAdd={() => setEditPay("new")}
          onOpen={(p) => setDetailPay(p)}
        />
      )}

      {editBudget && (
        <BudgetForm
          row={editBudget === "new" ? null : editBudget}
          pending={pending}
          onSubmit={(fd) => run(saveBudgetItem, fd, () => setEditBudget(null))}
          onCancel={() => setEditBudget(null)}
        />
      )}

      {detailTxn && !editTxn && (
        <TransactionDetail
          t={detailTxn}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setDetailTxn(null)}
          onEdit={() => setEditTxn(detailTxn)}
          onDelete={() => {
            if (!confirm(`Delete "${detailTxn.item}"?`)) return;
            const fd = new FormData();
            fd.set("id", detailTxn.id);
            run(deleteTransaction, fd, () => setDetailTxn(null));
          }}
        />
      )}

      {editTxn && (
        <TransactionForm
          row={editTxn === "new" ? null : editTxn}
          budgetItems={budgetItems}
          tournaments={tournaments}
          players={players}
          facilities={facilities}
          pending={pending}
          onSubmit={(fd) => run(saveTransaction, fd, () => { setEditTxn(null); setDetailTxn(null); })}
          onCancel={() => setEditTxn(null)}
        />
      )}

      {detailPay && !editPay && (
        <PaymentDetail
          p={detailPay}
          canWrite={canWrite}
          pending={pending}
          onClose={() => setDetailPay(null)}
          onRecord={(fd) => run(recordPayment, fd, () => setDetailPay(null))}
          onDeleteEntry={(entryId) => {
            if (!confirm("Remove this payment entry?")) return;
            const fd = new FormData();
            fd.set("id", entryId);
            run(deletePaymentEntry, fd, () => setDetailPay(null));
          }}
          onEdit={() => setEditPay(detailPay)}
        />
      )}

      {editPay && (
        <PaymentForm
          row={editPay === "new" ? null : editPay}
          players={players}
          existing={payments}
          pending={pending}
          onSubmit={(fd) => run(savePlayerPayment, fd, () => { setEditPay(null); setDetailPay(null); })}
          onCancel={() => setEditPay(null)}
        />
      )}
    </>
  );
}

/* ---------------- Funds In ---------------- */

/**
 * Money coming in, kept separate from expenses.
 *
 * Player dues derive from Player Payments and are read-only here — recording
 * them as transactions as well would double-count every payment.
 */
export function FundsInTab({ funds, dues }) {
  const rows = [
    {
      label: "Player dues",
      received: funds.playerDues,
      goal: dues.expected,
      note: "Derived from Player Payments",
      derived: true,
    },
    { label: "Fundraising", received: funds.fundraising, goal: funds.fundraisingGoal },
    { label: "Sponsorships / donations", received: funds.sponsors, goal: funds.sponsorsGoal },
  ];

  if (funds.other !== 0 || funds.otherGoal > 0) {
    rows.push({ label: "Other", received: funds.other, goal: funds.otherGoal });
  }

  const pct = (r, g) => (g > 0 ? Math.round((r / g) * 100) : null);

  return (
    <>
      <div className="tab-head">
        <div className="page-sub">
          Money received this season. Kept separate from expenses — never netted against the budget.
        </div>
      </div>

      <div className="card card-flush">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Received</th>
              <th>Goal</th>
              <th>% of goal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  <span className="cell-name">{r.label}</span>
                  {r.derived && <span className="role-tag">Derived</span>}
                  {r.note && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.note}</div>
                  )}
                </td>
                <td className="t-cost">{money(r.received)}</td>
                <td className="t-cost">{r.goal > 0 ? money(r.goal) : <span className="muted">—</span>}</td>
                <td className="t-cost">
                  {pct(r.received, r.goal) == null
                    ? <span className="muted">—</span>
                    : `${pct(r.received, r.goal)}%`}
                </td>
              </tr>
            ))}
            <tr className="funds-total">
              <td><span className="cell-name">Total funds in</span></td>
              <td className="t-cost">{money(funds.total)}</td>
              <td className="t-cost">
                {funds.totalGoal + dues.expected > 0
                  ? money(funds.totalGoal + dues.expected)
                  : <span className="muted">—</span>}
              </td>
              <td className="t-cost">
                {pct(funds.total, funds.totalGoal + dues.expected) == null
                  ? <span className="muted">—</span>
                  : `${pct(funds.total, funds.totalGoal + dues.expected)}%`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="field-note">
        Player dues are recorded in Player Payments and appear here automatically. They cannot be
        entered as transactions, which keeps the same payment from being counted twice.
      </p>
    </>
  );
}

/* ---------------- Budget ---------------- */

export function BudgetTab({ budget, summary, committedTournaments, openCats, setOpenCats, canWrite, onAdd, onEdit, onDelete, pending }) {
  const recorded = summary.actualExpenses;

  return (
    <>
      <div className="tab-head">
        <div className="page-sub">
          Planned expenses only. Actual spend derives from paid transactions linked to each
          budget line. Income targets live in Funds In.
        </div>
        {canWrite && <button className="btn btn-primary" onClick={onAdd}>Add budget line</button>}
      </div>

      {committedTournaments > 0 && (
        <div className="reconcile">
          Committed tournament cost <strong>{money(committedTournaments)}</strong>
          <span className="muted"> · recorded in Finance {money(recorded)}</span>
        </div>
      )}

      {budget.expenses.length === 0 ? (
        <div className="card">
          <div className="empty">
            <h3>No budget yet</h3>
            <p>Plan what you expect to spend this season: tournament fees, uniforms, equipment. Actual spending fills in from your transactions.</p>
            {canWrite && <button className="btn btn-primary" onClick={onAdd}>Add budget line</button>}
          </div>
        </div>
      ) : (
        <>
          <BudgetSection
            title="Expenses" groups={budget.expenses} openCats={openCats}
            setOpenCats={setOpenCats} canWrite={canWrite} onEdit={onEdit}
            onDelete={onDelete} pending={pending}
          />
        </>
      )}

      {budget.unlinked.length > 0 && (
        <div className="card unlinked-note">
          <strong>{budget.unlinked.length}</strong> transaction
          {budget.unlinked.length === 1 ? " is" : "s are"} not linked to a budget line, so
          {budget.unlinked.length === 1 ? " it does" : " they do"} not appear against any category above.
        </div>
      )}
    </>
  );
}

function BudgetSection({ title, groups, openCats, setOpenCats, canWrite, onEdit, onDelete, pending, income }) {
  if (groups.length === 0) return null;

  return (
    <div className="group">
      <div className="group-head" style={{ cursor: "default" }}>
        <span className={`group-title ${income ? "decision-committed" : "decision-considering"}`}>{title}</span>
      </div>

      <div className="card card-flush">
        {groups.map((g) => {
          const open = openCats[g.category] ?? false;
          const over = g.variance > 0 && !income;
          return (
            <div key={g.category}>
              <button
                className="budget-cat"
                onClick={() => setOpenCats({ ...openCats, [g.category]: !open })}
                aria-expanded={open}
              >
                <span className={`group-caret${open ? "" : " collapsed"}`} aria-hidden="true">▾</span>
                <span className="budget-cat-name">{g.category}</span>
                <span className="budget-figs">
                  <span><em>Budget</em>{money(g.budgeted)}</span>
                  <span><em>Spent</em>{money(g.actual)}</span>
                  {/* Over replaces Remaining rather than sitting beside a
                      negative number — it says the same thing more plainly. */}
                  <span className={over ? "over" : ""}>
                    <em>{over ? "Over" : "Remaining"}</em>
                    {money(over ? Math.abs(g.remaining) : g.remaining)}
                  </span>
                </span>
                <span className="budget-bar" aria-hidden="true">
                  <span
                    className={`budget-bar-fill${over ? " over" : ""}`}
                    style={{ width: `${Math.min(100, g.percentUsed ?? 0)}%` }}
                  />
                  <em>{g.percentUsed == null ? "—" : `${g.percentUsed}%`}</em>
                </span>
              </button>

              {open && (
                <table className="table budget-lines">
                  <thead>
                    <tr>
                      <th>Line item</th>
                      <th>Budget</th>
                      <th>{income ? "Received" : "Spent"}</th>
                      <th>Remaining</th>
                      <th>% used</th>
                      {canWrite && <th aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.name}
                          {r.committed > 0 && (
                            <span className="gap-flag" title="Ordered or received, not yet paid">
                              {money(r.committed)} committed
                            </span>
                          )}
                        </td>
                        <td>{money(r.budgeted)}</td>
                        <td>{money(r.actual)}</td>
                        <td className={r.remaining < 0 && !income ? "over" : ""}>
                          {r.remaining < 0 && !income
                            ? `Over ${money(Math.abs(r.remaining))}`
                            : money(r.remaining)}
                        </td>
                        <td>{r.percentUsed == null ? "—" : `${r.percentUsed}%`}</td>
                        {canWrite && (
                          <td className="td-actions">
                            <button className="btn btn-ghost" onClick={() => onEdit(r)} disabled={pending}>Edit</button>
                            <button className="btn btn-danger-ghost" onClick={() => onDelete(r)} disabled={pending}>Delete</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BudgetForm({ row, pending, onSubmit, onCancel }) {
  const isNew = !row;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="id" value={row.id} />}
          <div className="modal-head">
            <h2>{isNew ? "Add budget line" : `Edit ${row.name}`}</h2>
          </div>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="b-name">Line item</label>
              <input id="b-name" name="name" required placeholder="e.g. Game uniform set"
                     defaultValue={row?.name ?? ""} />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="b-cat">Category</label>
                <input id="b-cat" name="category" required list="fin-categories"
                       defaultValue={row?.category ?? ""} />
                <datalist id="fin-categories">
                  {CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="b-amt">Budgeted amount</label>
                <input id="b-amt" name="budgeted" type="number" min="0" step="1"
                       defaultValue={row?.budgeted ?? ""} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="b-income">Type</label>
              <select id="b-income" name="is_income" defaultValue={row?.is_income ? "true" : "false"}>
                <option value="false">Expense</option>
                <option value="true">Income</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="b-notes">Notes</label>
              <textarea id="b-notes" name="notes" rows={2} defaultValue={row?.notes ?? ""} />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add budget line" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Transactions ---------------- */

export function TransactionsTab({ transactions, canWrite, onAdd, onOpen }) {
  const [q, setQ] = useState("");
  const rows = transactions.filter((t) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return `${t.item} ${t.vendor ?? ""} ${t.budget_item?.category ?? t.category}`.toLowerCase().includes(s);
  });

  return (
    <>
      <div className="tab-head">
        <input className="toolbar-search" type="search" placeholder="Search transactions"
               value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        {canWrite && <button className="btn btn-primary" onClick={onAdd}>Add transaction</button>}
      </div>

      <div className="card card-flush">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>{transactions.length === 0 ? "No transactions yet" : "Nothing matches"}</h3>
            <p>
              {transactions.length === 0
                ? "Every real payment goes here — entry fees, uniforms, field rental. Link one to a budget line to see it in your budget."
                : "Try a different search."}
            </p>
            {transactions.length === 0 && canWrite && (
              <button className="btn btn-primary" onClick={onAdd}>Add transaction</button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Budget line</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="row-click" onClick={() => onOpen(t)}>
                  <td className="nowrap">{fmtDate(t.txn_date)}</td>
                  <td>
                    <span className="cell-name">{t.item}</span>
                    {t.is_income && <span className="role-tag">Income</span>}
                    {t.vendor && <div className="txn-vendor">{t.vendor}</div>}
                  </td>
                  <td>
                    {t.budget_item
                      ? t.budget_item.category
                      : <span className="muted">{t.category}</span>}
                  </td>
                  <td className="t-cost txn-amount">
                    {money(t.actual_amount)}
                    <span className={`txn-status ${statusClass(t.status)}`} title={t.status}>
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function DRow({ label, value }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{empty ? <span className="muted">—</span> : value}</span>
    </div>
  );
}

function TransactionDetail({ t, canWrite, pending, onClose, onEdit, onDelete }) {
  const counted = isActual(t);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{t.item}</h2>
            <div className="drawer-head-meta">
              <span className="drawer-head-dates">{fmtDate(t.txn_date)}</span>
              {t.vendor && <span>{t.vendor}</span>}
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${statusClass(t.status)}`}>{t.status}</span>
              {t.is_income && <span className="pill pill-paid">Income</span>}
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          <div className="cost-box">
            <div className="cost-row cost-total">
              <span>Amount</span><span>{money(t.actual_amount)}</span>
            </div>
          </div>
          <p className="section-note">
            {counted
              ? `Counts toward actual ${t.is_income ? "income" : "expenses"}.`
              : t.actual_amount == null
                ? "No amount recorded yet, so this does not affect actual reporting."
                : "Not yet paid, so this is reported as committed rather than actual."}
          </p>

          <section className="detail-section" style={{ marginTop: 22 }}>
            <h3 className="detail-section-title">Details</h3>
            <DRow label="Budget line" value={t.budget_item ? `${t.budget_item.category} · ${t.budget_item.name}` : null} />
            <DRow label="Category" value={t.budget_item?.category ?? t.category} />
            <DRow label="Quantity" value={t.quantity} />
          </section>

          <section className="detail-section">
            <h3 className="detail-section-title">Linked to</h3>
            <DRow label="Tournament" value={t.tournament?.name} />
            <DRow label="Player" value={t.player?.full_name} />
            <DRow label="Facility" value={t.facility?.name} />
          </section>

          <section className="detail-section">
            <h3 className="detail-section-title">Notes</h3>
            <p className="section-body">{t.notes ?? <span className="muted">No notes.</span>}</p>
          </section>
        </div>

        {canWrite && (
          <div className="drawer-foot">
            <button className="btn btn-danger-ghost" onClick={onDelete} disabled={pending}>Delete</button>
            <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit details</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function TransactionForm({ row, budgetItems, tournaments, players, facilities, pending, onSubmit, onCancel }) {
  const isNew = !row;
  const [budgetItemId, setBudgetItemId] = useState(row?.budget_item_id ?? "");
  const [amount, setAmount] = useState(row?.actual_amount ?? "");
  const [tournamentId, setTournamentId] = useState(row?.tournament_id ?? "");

  const linked = budgetItems.find((b) => b.id === budgetItemId) ?? null;

  /** Picking a tournament pre-fills its committed cost. Always editable. */
  function pickTournament(id) {
    setTournamentId(id);
    const t = tournaments.find((x) => x.id === id);
    if (t && (amount === "" || amount == null)) setAmount(t.total_cost ?? "");
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="id" value={row.id} />}
          <div className="modal-head">
            <h2>{isNew ? "Add transaction" : `Edit ${row.item}`}</h2>
            {isNew && <div className="page-sub">A description, date and budget line are enough to start.</div>}
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="t-item">Description</label>
              <input id="t-item" name="item" required placeholder="e.g. Fall Kickoff entry"
                     defaultValue={row?.item ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="t-date">Date</label>
                <input id="t-date" name="txn_date" type="date" required defaultValue={row?.txn_date ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="t-vendor">Vendor</label>
                <input id="t-vendor" name="vendor" defaultValue={row?.vendor ?? ""} />
              </div>
            </div>

            <div className="field">
              <label htmlFor="t-budget">Budget line</label>
              <select id="t-budget" name="budget_item_id" value={budgetItemId}
                      onChange={(e) => setBudgetItemId(e.target.value)}>
                <option value="">Not linked</option>
                {budgetItems.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.category} · {b.name}{b.is_income ? " (income)" : ""}
                  </option>
                ))}
              </select>
              {linked && (
                <p className="field-note">
                  Category and income type come from this budget line.
                </p>
              )}
            </div>

            {!linked && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="t-cat">Category</label>
                  <input id="t-cat" name="category" list="txn-categories" defaultValue={row?.category ?? ""} />
                  <datalist id="txn-categories">
                    {CATEGORIES.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="t-income">Type</label>
                  <select id="t-income" name="is_income" defaultValue={row?.is_income ? "true" : "false"}>
                    <option value="false">Expense</option>
                    <option value="true">Income</option>
                  </select>
                </div>
              </div>
            )}

            <div className="field-row">
              <div className="field">
                <label htmlFor="t-amount">Amount</label>
                <input id="t-amount" name="actual_amount" type="number" min="0" step="1"
                       value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="t-status">Status</label>
                <select id="t-status" name="status" defaultValue={row?.status ?? "Planned"}>
                  {TXN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <p className="field-note">
              Only paid transactions with an amount count toward actual reporting.
            </p>

            <div className="form-divider">Linked to (optional)</div>

            <div className="field">
              <label htmlFor="t-tourn">Tournament</label>
              <select id="t-tourn" name="tournament_id" value={tournamentId}
                      onChange={(e) => pickTournament(e.target.value)}>
                <option value="">—</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {money(t.total_cost)}</option>
                ))}
              </select>
              <p className="field-note">Picking a tournament suggests its committed cost. Adjust to what you actually paid.</p>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="t-player">Player</label>
                <select id="t-player" name="player_id" defaultValue={row?.player_id ?? ""}>
                  <option value="">—</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {(p.person_type ?? "player") !== "player" ? ` (${p.person_type})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="t-fac">Facility</label>
                <select id="t-fac" name="facility_id" defaultValue={row?.facility_id ?? ""}>
                  <option value="">—</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="t-qty">Quantity</label>
              <input id="t-qty" name="quantity" type="number" min="0" step="1" defaultValue={row?.quantity ?? ""} />
            </div>

            <div className="field">
              <label htmlFor="t-notes">Notes</label>
              <textarea id="t-notes" name="notes" rows={2} defaultValue={row?.notes ?? ""} />
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add transaction" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Player payments ---------------- */

export function PaymentsTab({ payments, canWrite, onAdd, onOpen }) {
  return (
    <>
      <div className="tab-head">
        <div className="page-sub">Amounts owed by each player for this season.</div>
        {canWrite && <button className="btn btn-primary" onClick={onAdd}>Add player payment</button>}
      </div>

      <div className="card card-flush">
        {payments.length === 0 ? (
          <div className="empty">
            <h3>No player payments yet</h3>
            <p>Set what each family owes for the season. Record payments as they arrive and Atlas keeps the balances for you.</p>
            {canWrite && <button className="btn btn-primary" onClick={onAdd}>Add player payment</button>}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Total due</th>
                <th>Paid</th>
                <th>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="row-click" onClick={() => onOpen(p)}>
                  <td className="cell-name">{p.player?.full_name ?? <span className="muted">Unlinked</span>}</td>
                  <td>{money(p.totalDue)}</td>
                  <td>{money(p.totalPaid)}</td>
                  <td className="t-cost">{money(p.balance)}</td>
                  <td><span className={`pill ${payClass(p.status)}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function PaymentDetail({ p, canWrite, pending, onClose, onRecord, onDeleteEntry, onEdit }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{p.player?.full_name ?? "Unlinked payment"}</h2>
            <div className="drawer-head-meta">
              <span className="drawer-head-dates">{money(p.balance)} outstanding</span>
            </div>
            <div className="drawer-head-pills">
              <span className={`pill ${payClass(p.status)}`}>{p.status}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          <div className="cost-box">
            <div className="cost-row"><span>Total due</span><span>{money(p.totalDue)}</span></div>
            <div className="cost-row"><span>Paid</span><span>{money(p.totalPaid)}</span></div>
            <div className="cost-row cost-total"><span>Balance</span><span>{money(p.balance)}</span></div>
          </div>

          <section className="detail-section" style={{ marginTop: 22 }}>
            <h3 className="detail-section-title">Payment history</h3>
            {p.log.length === 0 ? (
              <p className="section-body muted">No payments recorded yet.</p>
            ) : (
              <table className="table">
                <tbody>
                  {p.log.map((l) => (
                    <tr key={l.id}>
                      <td>{l.month_label ?? fmtDate(l.paid_date)}</td>
                      <td className="muted">{fmtDate(l.paid_date)}</td>
                      <td className="t-cost">{money(l.amount)}</td>
                      {canWrite && (
                        <td className="td-actions">
                          <button className="btn btn-danger-ghost" disabled={pending}
                                  onClick={() => onDeleteEntry(l.id)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {canWrite && p.balance > 0 && (
            <section className="detail-section">
              <h3 className="detail-section-title">Record a payment</h3>
              <form action={onRecord}>
                <input type="hidden" name="payment_id" value={p.id} />
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="r-amount">Amount</label>
                    <input id="r-amount" name="amount" type="number" min="1" step="1" required />
                  </div>
                  <div className="field">
                    <label htmlFor="r-date">Date</label>
                    <input id="r-date" name="paid_date" type="date" required />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="r-label">Label</label>
                  <input id="r-label" name="month_label" placeholder="e.g. Feb 2027" />
                </div>
                <button type="submit" className="btn btn-primary" style={{ marginTop: 14 }} disabled={pending}>
                  {pending ? "Saving…" : "Record payment"}
                </button>
              </form>
            </section>
          )}
        </div>

        {canWrite && (
          <div className="drawer-foot">
            <span />
            <button className="btn btn-secondary" onClick={onEdit} disabled={pending}>Edit total due</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function PaymentForm({ row, players, existing, pending, onSubmit, onCancel }) {
  const isNew = !row;
  const taken = new Set(existing.map((p) => p.player_id));
  // Season fees are owed by players. Coaches and other staff are excluded.
  const available = players.filter(
    (p) => !taken.has(p.id) && (p.person_type ?? "player") === "player"
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          {row && <input type="hidden" name="id" value={row.id} />}
          {row && <input type="hidden" name="player_id" value={row.player_id ?? ""} />}
          <div className="modal-head">
            <h2>{isNew ? "Add player payment" : `Edit ${row.player?.full_name}`}</h2>
          </div>
          <div className="modal-body">
            {isNew && (
              <div className="field">
                <label htmlFor="p-player">Player</label>
                <select id="p-player" name="player_id" required>
                  <option value="">Pick a player</option>
                  {available.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                {available.length === 0 && (
                  <p className="field-note">
                    Every player already has a payment record for this season. Coaches and
                    staff are not included, since season fees apply to players only.
                  </p>
                )}
              </div>
            )}
            <div className="field">
              <label htmlFor="p-cost">Total due for the season</label>
              <input id="p-cost" name="initial_cost" type="number" min="0" step="1" required
                     defaultValue={row?.totalDue ?? ""} />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
