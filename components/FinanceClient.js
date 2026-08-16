"use client";

import Link from "next/link";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import { useActionFeedback } from "../lib/useActionFeedback";
import { PageHelp } from "./PageHelp";
import { useOpenParam } from "./useOpenParam";
import { RelatedLink } from "./RelatedLink";
import { NeedsAction, FilterChip } from "./NeedsAction";
import { SearchPicker } from "./SearchPicker";
import { setDuesForAll } from "../lib/actions/finance";
import { setTournamentBudgetLine } from "../lib/actions/tournaments";
import { financeActions, FINANCE_FILTER_LABELS } from "../lib/readiness/finance";
import {
  isActual, CATEGORIES, TXN_STATUSES, money, quantity, cents, sumMoney,
  tournamentPaidTotal, duesCollectedPercent, outstandingTotal,
} from "../lib/finance-rules";
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

/** A thin bar. Restraint on purpose — Finance should not become a chart page. */
function Meter({ value, total, hidePct = false }) {
  if (!total || total <= 0) return null;
  const pct = Math.min(100, Math.round((value / total) * 100));
  return (
    <span className="meter" role="img" aria-label={`${pct} percent`}>
      <span className="meter-fill" style={{ width: `${pct}%` }} />
      {!hidePct && <span className="meter-pct">{pct}%</span>}
    </span>
  );
}

/**
 * Budget = Paid + To Pay + Available, as one bar.
 *
 * The three segments are mutually exclusive and fill the track, so the
 * relationship is visible rather than asserted. Paid and To Pay share a hue
 * and sit adjacent because Paid is contained within total commitment; the
 * uncommitted remainder is the empty part of the track.
 *
 * Widths are computed in integer cents and the last segment takes the
 * remainder, so the three can never total 99% or 101% through rounding.
 *
 * Over-commitment is real and must not be hidden: when committed exceeds the
 * budget the bar scales to committed instead, and Available reports the
 * overspend rather than clamping to zero.
 */
function BudgetSplit({ summary }) {
  const budget = cents(summary.budgetedExpenses);
  const paid = Math.max(0, cents(summary.actualExpenses));
  const toPay = Math.max(0, cents(summary.toPay));
  const available = cents(summary.availableBudget);
  const over = available < 0;

  if (budget <= 0 && paid + toPay <= 0) return null;

  const denominator = Math.max(budget, paid + toPay, 1);
  const pctPaid = (paid / denominator) * 100;
  const pctToPay = (toPay / denominator) * 100;
  const pctAvailable = Math.max(0, 100 - pctPaid - pctToPay);

  const label = `${summaryMoney(summary.actualExpenses)} paid, ${summaryMoney(
    summary.toPay
  )} to pay, ${summaryMoney(Math.abs(summary.availableBudget))} ${over ? "over budget" : "available"}`;

  return (
    <div className="fin-split">
      <div className="fin-split-bar" role="img" aria-label={label}>
        <span className="fin-split-seg seg-paid" style={{ width: `${pctPaid}%` }} />
        <span className="fin-split-seg seg-topay" style={{ width: `${pctToPay}%` }} />
        <span className="fin-split-seg seg-available" style={{ width: `${pctAvailable}%` }} />
      </div>

      <dl className="fin-split-legend">
        <div className="fin-split-item">
          <dt><span className="fin-split-key seg-paid" aria-hidden="true" />Paid</dt>
          <dd>{summaryMoney(summary.actualExpenses)}</dd>
        </div>
        <div className="fin-split-item">
          <dt><span className="fin-split-key seg-topay" aria-hidden="true" />To pay</dt>
          <dd>{summaryMoney(summary.toPay)}</dd>
        </div>
        <div className="fin-split-item">
          <dt><span className="fin-split-key seg-available" aria-hidden="true" />
            {over ? "Over budget" : "Available"}
          </dt>
          <dd className={over ? "over" : undefined}>
            {summaryMoney(Math.abs(summary.availableBudget))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Committed tournaments that no budget category accounts for.
 *
 * Deliberately not auto-assigned and not folded into the totals: the coach
 * chooses the category, using the same tournament/budget relationship the
 * Tournaments module already writes. Until then the wording must not imply
 * these amounts are inside any category's Available.
 */
function UnassignedCommitments({ tournaments, budgetItems, canWrite, pending, onAssign }) {
  const [choice, setChoice] = useState({});
  const expenseLines = (budgetItems ?? []).filter((b) => !b.is_income);
  const total = sumMoney(tournaments.map((t) => t.amount));

  return (
    <div className="fin-unassigned">
      <p className="fin-unassigned-lead">
        <strong>{summaryMoney(total)}</strong> of committed tournament cost is not assigned to a
        budget category, so it is <em>not</em> included in any category&rsquo;s available budget.
      </p>

      <ul className="fin-unassigned-list">
        {tournaments.map((t) => (
          <li key={t.id} className="fin-unassigned-row">
            <span className="fin-unassigned-name">
              {t.name}
              <span className="budget-sub">{money(t.amount)} committed &middot; no budget category</span>
            </span>

            {canWrite && (
              <span className="fin-unassigned-assign">
                <select
                  className="fin-select"
                  aria-label={`Budget category for ${t.name}`}
                  value={choice[t.id] ?? ""}
                  onChange={(e) => setChoice({ ...choice, [t.id]: e.target.value })}
                >
                  <option value="">Choose a budget line…</option>
                  {expenseLines.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.category} · {b.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary"
                  disabled={pending || !choice[t.id]}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("tournament_id", t.id);
                    fd.set("budget_item_id", choice[t.id]);
                    onAssign(fd);
                  }}
                >
                  Assign
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Plain wording for the Finance action rows. Display only — the rules in
 * lib/readiness/finance.js are untouched.
 */
function financeActionText(a, dues) {
  const n = a.affected?.length ?? 0;
  if (a.id === "outstanding") {
    const owed = outstandingTotal(a.affected);
    return `${n} ${n === 1 ? "player still owes" : "players still owe"} ${money(owed)}`;
  }
  if (a.id === "not-started") {
    return `${n} ${n === 1 ? "player hasn't" : "players haven't"} paid anything yet`;
  }
  return a.detail;
}


function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

const payClass = (s) =>
  s === "Paid in Full" ? "pill-paid" : s === "Partial" ? "pill-deposit" : "pill-unregistered";

const statusClass = (s) =>
  s === "Paid" ? "pill-paid"
  : s === "Received" ? "pill-registered"
  : s === "Ordered" ? "pill-deposit"
  : "pill-unregistered";


export function FinanceClient({
  budget, transactions, payments, summary, funds, dues, committedTournaments,
  unassignedTournaments = [],
  tournaments, players, facilities, budgetItems, canWrite,
  // Review surface only: lets /review render each tab. Defaults to the normal
  // starting tab, so nothing changes in the application itself.
  initialTab = "budget",
  seasonPhase = "current",
  autoOpen = false,
  initialTournament = null,
  rosterPlayers = [],
  autoAddDues = false,
}) {
  const [tab, setTab] = useState(initialTab);

  /**
   * ?tournament=<id> narrows Transactions to one event. Filtered from the
   * transactions already in scope — no extra query. Cleared by the chip.
   */
  const [tournamentFilter, setTournamentFilter] = useState(initialTournament ?? null);
  const filterTournament = tournamentFilter
    ? tournaments.find((t) => t.id === tournamentFilter) ?? null
    : null;
  const [actionId, setActionId] = useState(null);
  const { error, setError, notice, pending, run } = useActionFeedback();

  const [editBudget, setEditBudget] = useState(null);
  // Create-and-link: a budget line created from inside the transaction form.
  const [lineDraft, setLineDraft] = useState(null);
  const [justCreatedLineId, setJustCreatedLineId] = useState(null);
  // Opened directly from the help panel, alongside the requested tab.
  const [editTxn, setEditTxn] = useState(autoOpen && initialTab === "transactions" ? "new" : null);
  const [detailTxn, setDetailTxn] = useState(null);

  // ?open=<player_payments.id> opens that payment drawer — the destination
  // record, not the player.
  // Drawer state lives in the URL, so refresh and Back behave properly.
  const { detail: detailPay, openDetail, closeDetail } = useOpenParam(payments);
  // Arrives from the roster prompt: /finance?tab=payments&add=dues
  const [editPay, setEditPay] = useState(autoAddDues ? "new" : null);
  const [openCats, setOpenCats] = useState({});

  const actions = useMemo(
    () => (seasonPhase === "current" ? financeActions(payments, rosterPlayers) : []),
    [payments, seasonPhase]
  );

  useEffect(() => {
    if (actionId && !actions.some((a) => a.id === actionId)) setActionId(null);
  }, [actions, actionId]);

  const activeAction = actions.find((a) => a.id === actionId) ?? null;

  /**
   * The dues-setup gap, shown inside the Player Dues panel rather than in the
   * page-level Needs attention list — it is a dues story, and it explains why
   * those players are absent from every dues figure.
   */
  const duesAction = useMemo(() => actions.find((a) => a.id === "no-dues") ?? null, [actions]);

  // Everything the two panels above do not already tell.
  const otherActions = useMemo(
    () =>
      actions.filter(
        (a) => a.id !== "outstanding" && a.id !== "not-started" && a.id !== "no-dues"
      ),
    [actions]
  );

  const overlayOpen = Boolean(editBudget || editTxn || detailTxn || detailPay || editPay);
  useEffect(() => {
    if (!overlayOpen) return;
    function onKey(e) {
      if (e.key !== "Escape") return;
      if (editBudget) setEditBudget(null);
      else if (editTxn) setEditTxn(null);
      else if (editPay) setEditPay(null);
      else if (detailTxn) setDetailTxn(null);
      else closeDetail();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [overlayOpen, editBudget, editTxn, editPay, detailTxn]);


  /**
   * The tab strip, used as the scroll target for summary CTAs.
   *
   * Summary links sit above the tabs and change content below them. On a short
   * viewport the tab content is off-screen, so clicking "View player balances"
   * switched the tab correctly but looked like nothing had happened.
   */
  const tabsRef = useRef(null);

  /**
   * Needs attention is collapsed by default. It is an exception state, so it
   * should state the problem in one line and stay out of the way until the
   * coach chooses to resolve it.
   */
  const [needsOpen, setNeedsOpen] = useState(false);
  const unassignedTotal = useMemo(
    () => sumMoney(unassignedTournaments.map((t) => t.amount)),
    [unassignedTournaments]
  );
  const needsCount = otherActions.length + unassignedTournaments.length;

  /**
   * Switch tab and bring the result into view.
   *
   * rAF defers the scroll until after React has committed the new tab, so we
   * scroll to the rendered destination rather than the previous layout.
   * Honours prefers-reduced-motion.
   */
  function goToTab(key) {
    setTab(key);
    requestAnimationFrame(() => {
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      tabsRef.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });
  }

  function selectAction(id) {
    setActionId(id);
    if (id) goToTab("payments");
  }

  /**
   * Payments narrowed to the selected action.
   *
   * Matched on player_id, not row id. The three actions carry different record
   * shapes in `affected`: "outstanding" and "not-started" hold player_payments
   * rows, while "no-dues" holds team_season_players rows. Comparing `a.id` to
   * `p.id` therefore compared keys from two different tables and could never
   * match for "no-dues". player_id is the one identifier both shapes share.
   *
   * Note this narrows correctly but still yields an empty list for "no-dues",
   * because those players have no player_payments row by definition. The empty
   * state below distinguishes that from a team with no dues set up at all.
   */
  const visiblePayments = activeAction
    ? payments.filter((p) =>
        activeAction.affected.some((a) => a.player_id != null && a.player_id === p.player_id)
      )
    : payments;

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="page-head">
        <div>
          <h1>Finance</h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.finance}</div>
        </div>
        <div className="fin-head-actions">
          {/* Contextual entry point. The report is a separate document with
              its own layout — this navigates to it rather than printing this
              page. No Reports area exists yet, by design. */}
          <Link className="btn btn-secondary" href="/reports/season-budget">
            Parent budget report
          </Link>
          <PageHelp />
        </div>
      </div>

      {/*
        Season budget leads; player dues sit beside it as the second story.

        The budget panel uses ONE segmented bar rather than a row of cards.
        Paid is contained within committed, so four equally weighted figures
        invite a coach to add overlapping numbers. Three mutually exclusive
        segments that fill the bar make Budget = Paid + To Pay + Available
        structural instead of something a caption has to explain.
      */}
      <div className="summary-band summary-band-flat fin-band">
        <div className="summary-band-grid">
          <section className="fin-budget-panel">
            <p className="fin-panel-label">Total season budget</p>
            <p className="fin-budget-hero">{summaryMoney(summary.budgetedExpenses)}</p>

            <BudgetSplit summary={summary} />

            <p className="fin-budget-context">
              {summary.budgetedExpenses > 0 ? (
                <>
                  <strong>{summary.percentCommitted ?? 0}% of budget committed</strong>
                  <span className="muted">
                    {" · "}
                    {summaryMoney(summary.committedExpenses)} total
                  </span>
                </>
              ) : (
                "No budget planned for this season yet."
              )}
            </p>

            <button className="fin-lead-link" onClick={() => goToTab("budget")}>
              View full budget →
            </button>
          </section>

          <section className="fin-dues-panel">
            <p className="fin-panel-label">
              Player dues <HelpTip term="Player Dues" />
            </p>
            <p className="fin-dues-hero">
              {duesCollectedPercent(dues) ?? 0}%
              <span className="fin-dues-hero-unit">collected</span>
            </p>

            <p className="fin-dues-amounts">
              {money(dues.collected)} collected of {money(dues.expected)}
            </p>

            <Meter value={dues.collected} total={dues.expected} hidePct />

            <p className="fin-dues-outstanding">
              <span className={dues.outstanding > 0 ? "fin-owed" : "fin-settled"}>
                {dues.outstanding > 0
                  ? `${money(dues.outstanding)} outstanding`
                  : "All dues collected"}
              </span>
            </p>

            <button className="fin-lead-link" onClick={() => selectAction("outstanding")}>
              View player balances →
            </button>

            {/* One compact line, not a card nested inside a card. A player with
                no dues record is excluded from expected, collected AND
                outstanding, so this is the only place they appear. */}
            {duesAction && (
              <p className="fin-dues-gap">
                <span className="fin-dues-gap-mark" aria-hidden="true" />
                <span className="fin-dues-gap-text">
                  <strong>
                    {duesAction.affected.length === 1
                      ? "1 player has no dues set"
                      : `${duesAction.affected.length} players have no dues set`}
                  </strong>{" "}
                  —{" "}
                  {duesAction.affected
                    .map((a) => a.player?.full_name)
                    .filter(Boolean)
                    .join(", ")}
                  , not counted above.
                  {canWrite && (
                    <button
                      className="fin-lead-link fin-dues-gap-cta"
                      onClick={() => {
                        goToTab("payments");
                        setEditPay("new");
                      }}
                    >
                      Set dues →
                    </button>
                  )}
                </span>
              </p>
            )}
          </section>
        </div>
      </div>

      {/* An exception state, sized like one. Collapsed by default: the summary
          says what is wrong and how much it is worth, and the resolution
          controls appear only when the coach asks for them. */}
      {needsCount > 0 && (
        <section className="card fin-attention">
          <div className="fin-attention-head">
            <p className="fin-attention-title">
              Needs attention
              <span className="fin-attention-count">{needsCount}</span>
            </p>
            <button
              className="fin-lead-link"
              onClick={() => setNeedsOpen(!needsOpen)}
              aria-expanded={needsOpen}
            >
              {needsOpen ? "Hide" : "Review"} →
            </button>
          </div>

          <p className="fin-attention-summary">
            {unassignedTournaments.length > 0 && (
              <>
                <strong>{summaryMoney(unassignedTotal)}</strong> in tournament commitments needs a
                budget category.
              </>
            )}
            {unassignedTournaments.length > 0 && otherActions.length > 0 && " "}
            {otherActions.map((a) => financeActionText(a, dues)).join(" · ")}
          </p>

          {needsOpen && (
            <div className="fin-attention-body">
              {unassignedTournaments.length > 0 && (
                <UnassignedCommitments
                  tournaments={unassignedTournaments}
                  budgetItems={budgetItems}
                  canWrite={canWrite}
                  pending={pending}
                  onAssign={(fd) =>
                    run(setTournamentBudgetLine, fd, {
                      success: "Tournament assigned to a budget category",
                    })
                  }
                />
              )}

              {otherActions.length > 0 && (
                <ul className="briefing-list">
                  {otherActions.map((a) => (
                    <li key={a.id} className="briefing-item">
                      <button
                        className={`briefing-link fin-needs-link${actionId === a.id ? " on" : ""}`}
                        onClick={() => selectAction(actionId === a.id ? null : a.id)}
                      >
                        <span className="briefing-dot dot-attention" aria-hidden="true" />
                        <span className="briefing-text">
                          <span className="briefing-what">{financeActionText(a, dues)}</span>
                        </span>
                        <span className="fin-needs-go" aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {activeAction && (
        <FilterChip
          label={`Showing ${activeAction.affected.length} ${FINANCE_FILTER_LABELS[activeAction.id] ?? "affected"}`}
          onClear={() => setActionId(null)}
        />
      )}

      <div className="tabs" role="tablist" ref={tabsRef}>
        {[
          { key: "budget", label: "Budget" },
          { key: "transactions", label: "Transactions" },
          { key: "funds", label: "Money In" },
          { key: "payments", label: "Player Dues" },
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
          tournamentPaid={tournamentPaidTotal(transactions)}
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
          onOpen={(p) => openDetail(p)}
          onBulk={(fd) => run(setDuesForAll, fd, { success: "Dues set for the players who needed them" })}
          pending={pending}
          filtered={Boolean(activeAction)}
          filterLabel={activeAction ? FINANCE_FILTER_LABELS[activeAction.id] ?? null : null}
          onClearFilter={() => setActionId(null)}
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
          onCreateBudgetLine={(seed) => setLineDraft(seed)}
          justCreatedLineId={justCreatedLineId}
        />
      )}

      {/* Rendered alongside the transaction form, never in place of it, so
          nothing the coach has typed is unmounted. */}
      {lineDraft && (
        <BudgetForm
          row={null}
          seedName={lineDraft.name}
          seedIsIncome={lineDraft.isIncome}
          pending={pending}
          onCancel={() => setLineDraft(null)}
          onSubmit={(fd) =>
            run(saveBudgetItem, fd, (result) => {
              if (!result.item?.id) return;
              setLineDraft(null);
              // revalidatePath in the action refreshes budgetItems; the id is
              // remembered so the form selects it when they arrive.
              setJustCreatedLineId(result.item.id);
            })
          }
        />
      )}

      {detailPay && !editPay && (
        <PaymentDetail
          p={detailPay}
          canWrite={canWrite}
          pending={pending}
          onClose={() => { closeDetail(); }}
          onRecord={(fd) => run(recordPayment, fd, { onDone: () => closeDetail(), success: "Payment recorded" })}
          onDeleteEntry={(entryId) => {
            if (!confirm("Remove this payment entry?")) return;
            const fd = new FormData();
            fd.set("id", entryId);
            run(deletePaymentEntry, fd, () => closeDetail());
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
          onSubmit={(fd, scope) =>
            run(scope === "all" ? setDuesForAll : savePlayerPayment, fd, () => {
              setEditPay(null);
              closeDetail();
            })
          }
          onCancel={() => setEditPay(null)}
        />
      )}
    </>
  );
}

/* ---------------- Money In ---------------- */

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
      note: "Derived from Player Dues",
      derived: true,
      goalWord: "expected",
    },
    { label: "Fundraising", received: funds.fundraising, goal: funds.fundraisingGoal, goalWord: "goal" },
    { label: "Sponsorships / donations", received: funds.sponsors, goal: funds.sponsorsGoal, goalWord: "goal" },
  ];

  if (funds.other !== 0 || funds.otherGoal > 0) {
    rows.push({ label: "Other", received: funds.other, goal: funds.otherGoal, goalWord: "goal" });
  }


  return (
    <>
      <div className="tab-head">
        <div className="page-sub">
          Money received this season. Kept separate from expenses — never netted against the budget.
        </div>
      </div>

      {/* Total leads: it is the answer to "how much came in?". The sources
          beneath explain it, and one of them is Player Dues — which is why
          this total is deliberately not repeated in the page header. */}
      <div className="fi-total">
        <p className="fin-panel-label">Total received this season</p>
        <p className="fi-total-value">{summaryMoney(funds.total)}</p>
      </div>

      <div className="fi-grid">
        {rows.map((r) => {
          const remaining = Math.max(0, (r.goal ?? 0) - r.received);
          return (
            <div key={r.label} className="fi-card">
              <div className="fi-row-head">
                <span className="fi-source">
                  {r.label}
                  {r.derived && <span className="role-tag">From Player Dues</span>}
                </span>
                <span className="fi-received">{money(r.received)}</span>
              </div>

              {r.goal > 0 ? (
                <>
                  <Meter value={r.received} total={r.goal} />
                  <p className="fi-row-foot">
                    {remaining > 0 ? (
                      <>
                        {money(remaining)}{" "}
                        {r.goalWord === "expected" ? "still to collect" : "to goal"}
                      </>
                    ) : (
                      <span className="fi-met">Target met</span>
                    )}
                    <span className="muted">
                      {" · "}
                      {money(r.goal)} {r.goalWord}
                    </span>
                  </p>
                </>
              ) : (
                <p className="fi-row-foot muted">No target set</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------------- Budget ---------------- */

export function BudgetTab({ budget, summary, committedTournaments, tournamentPaid = 0, openCats, setOpenCats, canWrite, onAdd, onEdit, onDelete, pending }) {

  return (
    <>
      {/* One compact header region. Previously the explanation sat in a
          space-between row with the button pinned right, and the tournament
          commitment stacked underneath as a full-width card — which is what
          opened the wide empty gap between the two on a laptop. The commitment
          line and the action now share the row beneath the explanation. */}
      {/* Commitments are supporting information, so they sit beside the
          explanation rather than forming another band. The Add action moved to
          the Expenses heading row, where the thing it adds to lives. */}
      <div className="budget-intro">
        <div className="budget-intro-text">
          <h2 className="budget-intro-title">Season budget</h2>
          <p className="page-sub">
            Plan expenses and see how much of each category has actually been used.
          </p>
          {committedTournaments > 0 && (
            <p className="budget-intro-note">
              <strong>{summaryMoney(committedTournaments)}</strong> committed to tournaments
              <span className="budget-bar-dot" aria-hidden="true"> · </span>
              <strong>{summaryMoney(tournamentPaid)}</strong> paid
            </p>
          )}
        </div>
        {canWrite && (
          <button className="btn btn-primary budget-intro-action" onClick={onAdd}>
            + Add budget item
          </button>
        )}
      </div>

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

/**
 * Whole dollars at summary level, cents when they matter.
 *
 * A column of $22,000.00 / $5,050.00 / $16,950.00 is four characters of
 * trailing zeros the reader has to skip. Detail rows keep exact cents, and
 * nothing about stored precision changes.
 */
function summaryMoney(n) {
  if (n == null) return "—";
  const v = Number(n);
  return Number.isInteger(v)
    ? `$${v.toLocaleString("en-US")}`
    : money(v);
}

function BudgetSection({ title, groups, openCats, setOpenCats, canWrite, onEdit, onDelete, pending, income, action }) {
  if (groups.length === 0) return null;

  return (
    <div className="group">
      <div className="group-head group-head-action" style={{ cursor: "default" }}>
        <span className={`group-title ${income ? "decision-committed" : "decision-considering"}`}>{title}</span>
        {action}
      </div>

      {/* One header for the whole area, not one per category. Every category
          and line item shares the same grid, so figures line up down the page
          instead of restarting as a separate spreadsheet each time. */}
      {/* One grid definition drives the header, every category row and every
          line item, so a value in a detail row sits directly beneath the same
          value in its parent. Each figure gets its own column — combining Used
          and Budget in one cell is what caused the wrapping. */}
      <div className="card card-flush budget-board">
        <div className="budget-row budget-colhead" aria-hidden="true">
          <span />
          <span>Category</span>
          <span className="budget-num">Budget</span>
          <span className="budget-num">Paid</span>
          <span className="budget-num">To pay</span>
          <span className="budget-num budget-num-avail">Available</span>
          <span />
        </div>

        {groups.map((g) => {
          const open = openCats[g.category] ?? false;

          return (
            <div key={g.category} className={`budget-group${open ? " is-open" : ""}`}>
              <button
                className="budget-row budget-cat"
                onClick={() => setOpenCats({ ...openCats, [g.category]: !open })}
                aria-expanded={open}
              >
                <span className={`group-caret${open ? "" : " collapsed"}`} aria-hidden="true">▾</span>

                <span className="budget-name">
                  <span className="budget-cat-name">{g.category}</span>
                  {/* Same information the Status column carried, in plain
                      English beneath the category it describes. */}
                  <span className="budget-sub budget-cat-sub">
                    {g.percentCommitted == null
                      ? "No spending recorded"
                      : `${g.percentCommitted}% of budget committed`}
                  </span>
                </span>

                <span className="budget-num">{summaryMoney(g.budgeted)}</span>
                <span className="budget-num">{summaryMoney(g.paidTotal)}</span>
                <span className="budget-num">{summaryMoney(g.toPay)}</span>
                <span className={`budget-num budget-num-avail strong${g.available < 0 ? " over" : ""}`}>
                  {g.available < 0
                    ? `Over ${summaryMoney(Math.abs(g.available))}`
                    : summaryMoney(g.available)}
                </span>

                {/* Track 6 is shared with the line rows' actions. The category
                    row keeps the cell so the columns stay aligned; its Status
                    text now lives beneath the category name. */}
                <span />
              </button>

              {open &&
                g.rows.map((r) => (
                  <div key={r.id} className="budget-row budget-line">
                    <span />

                    <span className="budget-name budget-name-indent">
                      <span className="budget-line-name">{r.name}</span>
                      {r.quantity != null && r.unitCost != null && (
                        <span className="budget-sub">
                          {quantity(r.quantity)} &times; {money(r.unitCost)}
                        </span>
                      )}
                    </span>

                    <span className="budget-num">{money(r.budgeted)}</span>
                    <span className="budget-num">{money(r.actual)}</span>
                    <span className="budget-num">{income ? money(0) : money(r.toPay)}</span>
                    <span className={`budget-num budget-num-avail${r.available < 0 ? " over" : ""}`}>
                      {r.available < 0
                        ? `Over ${money(Math.abs(r.available))}`
                        : money(r.available)}
                    </span>

                    <span className="budget-line-actions">
                      {canWrite && (
                        <>
                          <button className="btn btn-ghost" onClick={() => onEdit(r)} disabled={pending}>Edit</button>
                          <button className="btn btn-danger-ghost" onClick={() => onDelete(r)} disabled={pending}>Delete</button>
                        </>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BudgetForm({ row, pending, onSubmit, onCancel, seedName = "", seedIsIncome = false }) {
  const isNew = !row;

  // An existing line already tells us which mode it was saved in.
  const [method, setMethod] = useState(row?.quantity != null ? "quantity" : "total");
  const [qty, setQty] = useState(row?.quantity ?? "");
  const [unit, setUnit] = useState(row?.unitCost ?? "");

  // Live preview only. The server recalculates on save, so a stale preview
  // can never become a stored total.
  const plannedTotal =
    Number(String(qty).replace(/[$,\s]/g, "") || 0) *
    Number(String(unit).replace(/[$,\s]/g, "") || 0);
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
                     defaultValue={row?.name ?? seedName} />
            </div>
            <div className="field">
              <label htmlFor="b-cat">Category</label>
              <input id="b-cat" name="category" required list="fin-categories"
                     defaultValue={row?.category ?? ""} />
              <datalist id="fin-categories">
                {CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>

            {/* Total amount stays the default. Quantity mode exists so a coach
                budgeting 16 jerseys at $120 doesn't multiply in Excel first. */}
            <input type="hidden" name="budget_method" value={method} />

            <div className="field">
              <label>How is this budgeted?</label>
              <div className="segmented" role="group" aria-label="Budget method">
                <button type="button" className={`segment${method === "total" ? " on" : ""}`}
                        aria-pressed={method === "total"} onClick={() => setMethod("total")}>
                  Total amount
                </button>
                <button type="button" className={`segment${method === "quantity" ? " on" : ""}`}
                        aria-pressed={method === "quantity"} onClick={() => setMethod("quantity")}>
                  Quantity &times; unit cost
                </button>
              </div>
            </div>

            {method === "total" ? (
              <div className="field">
                <label htmlFor="b-amt">Budgeted amount</label>
                <div className="input-money">
                  <span aria-hidden="true">$</span>
                  <input id="b-amt" name="budgeted" type="number" min="0" step="0.01"
                         inputMode="decimal" defaultValue={row?.budgeted ?? ""} />
                </div>
              </div>
            ) : (
              <>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="b-qty">Quantity</label>
                    <input id="b-qty" name="quantity" type="number" min="0" step="any"
                           inputMode="decimal" value={qty}
                           onChange={(e) => setQty(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="b-unit">Unit cost</label>
                    <div className="input-money">
                      <span aria-hidden="true">$</span>
                      <input id="b-unit" name="unit_cost" type="number" min="0" step="0.01"
                             inputMode="decimal" value={unit}
                             onChange={(e) => setUnit(e.target.value)} />
                    </div>
                  </div>
                </div>
                <p className="planned-total">
                  Planned total <strong>{money(plannedTotal)}</strong>
                </p>
              </>
            )}
            <div className="field">
              <label htmlFor="b-income">Type</label>
              <select id="b-income" name="is_income"
                      defaultValue={(row?.is_income ?? seedIsIncome) ? "true" : "false"}>
                <option value="false">Expense</option>
                <option value="true">Income</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="b-notes">Notes</label>
              <textarea id="b-notes" name="notes" rows={2}
                        placeholder="e.g. 15 players + 1 extra jersey"
                        defaultValue={row?.notes ?? ""} />
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
        <input className="toolbar-search" type="search" placeholder="Search by description or vendor"
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
          <table className="table txn-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
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
                    {t.tournament?.id && (
                      <div className="txn-vendor">
                        <RelatedLink
                          href={`/tournaments?open=${t.tournament.id}`}
                          season={t.season_id}
                          title={`Open ${t.tournament.name} in Tournaments`}
                        >
                          {t.tournament.name}
                        </RelatedLink>
                      </div>
                    )}
                  </td>
                  <td>
                    {t.budget_item
                      ? t.budget_item.category
                      : <span className="muted">{t.category}</span>}
                  </td>
                  <td className="t-cost txn-amount">
                    {t.actual_amount == null ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className={t.is_income ? "amt-in" : "amt-out"}>
                        {t.is_income ? "+" : "−"}
                        {money(Math.abs(Number(t.actual_amount)))}
                      </span>
                    )}
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

function TransactionForm({ row, budgetItems, tournaments, players, facilities, pending, onSubmit, onCancel, onCreateBudgetLine, justCreatedLineId }) {
  const isNew = !row;
  const [budgetItemId, setBudgetItemId] = useState(row?.budget_item_id ?? "");
  const [amount, setAmount] = useState(row?.actual_amount ?? "");
  const [tournamentId, setTournamentId] = useState(row?.tournament_id ?? "");
  const [isIncome, setIsIncome] = useState(Boolean(row?.is_income));
  const [pickingLine, setPickingLine] = useState(false);

  const chosenLine = budgetItems.find((b) => b.id === budgetItemId) ?? null;

  // An expense can never be filed against an income line, or the category
  // rollups would never reconcile.
  const eligibleLines = budgetItems.filter((b) => Boolean(b.is_income) === isIncome);

  // Create-and-link: a line created from inside this form is selected as soon
  // as it exists. The form never unmounts, so no field is lost.
  useEffect(() => {
    if (justCreatedLineId) setBudgetItemId(justCreatedLineId);
  }, [justCreatedLineId]);

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

            {/* Required. Without a budget line a transaction counts in the
                Finance summary but appears in no category total, so the two
                views disagree with nothing to explain it. */}
            <div className="field">
              <label>Budget line</label>
              <input type="hidden" name="budget_item_id" value={budgetItemId} />

              {chosenLine ? (
                <div className="picked">
                  <span>
                    <strong>{chosenLine.name}</strong>
                    <span className="muted"> · {chosenLine.category}</span>
                  </span>
                  <span className="picked-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setPickingLine(true)}>
                      Change
                    </button>
                  </span>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setPickingLine(true)}>
                  Choose a budget line
                </button>
              )}
              <p className="field-note">
                Category and type come from the budget line, which is what keeps Budget and the
                Finance summary in step.
              </p>
            </div>

            <div className="field">
              <label htmlFor="t-type">Type</label>
              <select
                id="t-type"
                value={isIncome ? "true" : "false"}
                onChange={(e) => {
                  setIsIncome(e.target.value === "true");
                  // A line of the other type can no longer apply.
                  setBudgetItemId("");
                }}
              >
                <option value="false">Expense</option>
                <option value="true">Income</option>
              </select>
            </div>

            {pickingLine && (
              <SearchPicker
                title={`Choose a budget line`}
                hint={`Showing ${isIncome ? "income" : "expense"} lines. If the one you need doesn't exist, add it — it'll be selected straight away.`}
                placeholder="Search budget lines…"
                items={eligibleLines.map((b) => ({
                  ...b,
                  searchText: `${b.name} ${b.category}`,
                }))}
                renderItem={(b) => (
                  <>
                    <span className="picker-item-name">{b.name}</span>
                    <span className="picker-item-meta">{b.category}</span>
                  </>
                )}
                emptyHint="Start typing to search your budget lines."
                createLabel="+ Add budget line"
                onSelect={(b) => {
                  setBudgetItemId(b.id);
                  setPickingLine(false);
                }}
                onCreate={(typed) => {
                  setPickingLine(false);
                  onCreateBudgetLine?.({ name: typed, isIncome });
                }}
                onCancel={() => setPickingLine(false)}
              />
            )}

            <div className="field-row">
              <div className="field">
                <label htmlFor="t-amount">Amount</label>
                <input id="t-amount" name="actual_amount" type="number" min="0" step="0.01" inputMode="decimal"
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

const PAYMENT_VIEWS = [
  { key: "all", label: "All" },
  { key: "owes", label: "Owes balance" },
  { key: "none", label: "Not started" },
  { key: "paid", label: "Paid" },
];

/**
 * Answers "who still owes?" first.
 *
 * Progress replaces three numeric columns a coach had to compare. Exact
 * amounts and payment history remain in the drawer.
 */
export function PaymentsTab({ payments, canWrite, onAdd, onOpen, onBulk, pending, filtered = false, filterLabel = null, onClearFilter }) {
  const [view, setView] = useState("all");
  const [bulkAmount, setBulkAmount] = useState("");

  const visible = payments.filter((p) => {
    if (view === "owes") return p.balance > 0;
    if (view === "none") return p.totalPaid === 0 && p.totalDue > 0;
    if (view === "paid") return p.balance <= 0 && p.totalDue > 0;
    return true;
  });

  const countFor = (key) =>
    payments.filter((p) => {
      if (key === "owes") return p.balance > 0;
      if (key === "none") return p.totalPaid === 0 && p.totalDue > 0;
      if (key === "paid") return p.balance <= 0 && p.totalDue > 0;
      return true;
    }).length;

  return (
    <>
      <div className="tab-head">
        <div className="page-sub">Amounts owed by each player for this season.</div>
        {canWrite && <button className="btn btn-primary" onClick={onAdd}>Set player dues</button>}
      </div>

      {payments.length > 0 && (
        <div className="segmented pay-views" role="group" aria-label="Filter players">
          {PAYMENT_VIEWS.map((v) => (
            <button
              key={v.key}
              className={`segment${view === v.key ? " on" : ""}`}
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
            >
              {v.label} <span className="seg-count">{countFor(v.key)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="card card-flush">
        {payments.length === 0 && filtered ? (
          /*
             Filtered to nothing. The first-run prompt below must not appear
             here: it tells a coach who already has dues recorded that they
             have none, and invites them to set dues for everyone. That is
             what "Player dues not set" used to land on, because those players
             have no player_payments row to list.
          */
          <div className="empty">
            <h3>No player payments match this filter</h3>
            <p>
              {filterLabel
                ? `These players are ${filterLabel}, so they have no payment record to show yet.`
                : "No payment records match the selected filter."}
            </p>
            {onClearFilter && (
              <button className="btn" onClick={onClearFilter}>
                Show all players
              </button>
            )}
          </div>
        ) : payments.length === 0 ? (
          <div className="empty">
            <h3>No player payments yet</h3>
            <p>
              Most teams charge the same amount to everyone. Set it once here, then adjust
              individual players later if you need to.
            </p>
            {canWrite && (
              <>
                <div className="bulk-dues">
                  <div className="input-money">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number" min="0" step="0.01" inputMode="decimal"
                      placeholder="0" aria-label="Amount each player owes"
                      value={bulkAmount}
                      onChange={(e) => setBulkAmount(e.target.value)}
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    disabled={pending || !bulkAmount}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("initial_cost", bulkAmount);
                      onBulk(fd);
                    }}
                  >
                    {pending ? "Setting…" : "Set for all active players"}
                  </button>
                </div>
                <button className="btn btn-ghost" onClick={onAdd}>Set one player instead</button>
              </>
            )}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <h3>No players here</h3>
            <p>Nobody matches this view right now.</p>
          </div>
        ) : (
          <table className="table pay-table">
            <thead>
              <tr>
                <th className="pay-player">Player</th>
                <th className="pay-progress">Payment progress</th>
                <th className="pay-balance">Balance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const settled = p.totalDue > 0 && p.balance <= 0;
                const nothing = p.totalPaid === 0;

                return (
                  <tr key={p.id} className="row-click" onClick={() => onOpen(p)}>
                    {/* Stacking lives on an inner wrapper, never on the cell
                        itself. A table cell set to display:flex stops being a
                        table cell and the row's column structure collapses. */}
                    <td className="pay-player">
                      <div className="pay-cell">
                        <span className="cell-name">
                          {p.player?.full_name ?? <span className="muted">Unlinked</span>}
                        </span>
                        <span className="pay-sub">
                          {settled
                            ? "Paid in full"
                            : nothing
                              ? `Nothing paid of ${money(p.totalDue)}`
                              : `${money(p.totalPaid)} of ${money(p.totalDue)}`}
                        </span>
                      </div>
                    </td>

                    <td className="pay-progress">
                      <div className="pay-cell">
                        {settled ? (
                          <span className="pay-settled">Paid in full ✓</span>
                        ) : nothing ? (
                          <span className="muted">Nothing paid</span>
                        ) : (
                          <>
                            <span className="pay-amounts">
                              {money(p.totalPaid)} <span className="muted">of {money(p.totalDue)}</span>
                            </span>
                            <Meter value={p.totalPaid} total={p.totalDue} hidePct />
                          </>
                        )}
                      </div>
                    </td>

                    {/* Display formatting only — p.balance is untouched.
                        A settled player owes zero, which is a real figure and
                        should read as one. The em dash is reserved for a
                        balance that genuinely does not exist. */}
                    <td className="pay-balance">
                      {p.balance > 0 ? (
                        <span className="pay-owed">{money(p.balance)}</span>
                      ) : p.balance < 0 ? (
                        <span className="muted">{money(Math.abs(p.balance))} credit</span>
                      ) : (
                        <span className="muted">$0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                    <input id="r-amount" name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required />
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
  const [scope, setScope] = useState("all");

  const taken = new Set(existing.map((p) => p.player_id));
  // Season fees are owed by players. Coaches and other staff are excluded.
  const available = players.filter(
    (p) => !taken.has(p.id) && (p.person_type ?? "player") === "player"
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={(fd) => onSubmit(fd, isNew ? scope : "one")}>
          {row && <input type="hidden" name="id" value={row.id} />}
          {row && <input type="hidden" name="player_id" value={row.player_id ?? ""} />}
          <div className="modal-head">
            <h2>{isNew ? "Set player dues" : `Edit ${row.player?.full_name}`}</h2>
            {isNew && (
              <div className="page-sub">
                Each player gets their own obligation, so balances and payment history stay
                separate.
              </div>
            )}
          </div>
          <div className="modal-body">
            {/* Bulk assignment used to live only on the empty state, so once
                one player had dues a coach could never reach it again. */}
            {isNew && (
              <div className="field">
                <label>Who owes this?</label>
                <div className="segmented" role="group" aria-label="Who owes this">
                  <button
                    type="button"
                    className={`segment${scope === "all" ? " on" : ""}`}
                    aria-pressed={scope === "all"}
                    onClick={() => setScope("all")}
                  >
                    All players
                  </button>
                  <button
                    type="button"
                    className={`segment${scope === "one" ? " on" : ""}`}
                    aria-pressed={scope === "one"}
                    onClick={() => setScope("one")}
                  >
                    One player
                  </button>
                </div>
              </div>
            )}

            {isNew && scope === "all" && (
              <p className="field-note dues-scope-note">
                {available.length === 0 ? (
                  <>Every active player already has dues set. Nothing would change.</>
                ) : (
                  <>
                    Creates a separate obligation for each of the{" "}
                    <strong>{available.length}</strong> active{" "}
                    {available.length === 1 ? "player" : "players"} without dues. Players who
                    already have an amount set are left exactly as they are.
                  </>
                )}
              </p>
            )}

            {isNew && scope === "one" && (
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
              <div className="input-money">
                <span aria-hidden="true">$</span>
                <input id="p-cost" name="initial_cost" type="number" min="0" step="0.01" inputMode="decimal" required
                       inputMode="decimal" placeholder="0"
                       defaultValue={row?.totalDue ?? ""} />
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending
                ? "Saving…"
                : !isNew
                  ? "Save changes"
                  : scope === "all"
                    ? `Set dues for ${available.length} ${available.length === 1 ? "player" : "players"}`
                    : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
