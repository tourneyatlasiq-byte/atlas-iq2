"use client";

import { lockScroll as lockPageScroll } from "../lib/scrollLock";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ContextHelp } from "./ContextHelp";
import { DrawerShell } from "./DrawerShell";
import { MoreActionsMenu } from "./MoreActionsMenu";

import { Fragment, useState, useTransition, useEffect, useMemo, useRef } from "react";
import { ConfirmAction, ConfirmDialog, useConfirm } from "./ConfirmAction";
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
  TXN_STATUSES, DEFAULT_TXN_STATUS, transactionEffect, money, quantity, cents, sumMoney, allocateMoney, canSaveDuesForm,
  tournamentPaidTotal, duesCollectedPercent, outstandingTotal, reconcileDues,
  actionPlayerIds, scopeReconciledDues, duesHeaderState, presetDuesTarget,
  categoryOptions, CATEGORY_OTHER, CATEGORY_OTHER_LABEL, incomeProgress,
} from "../lib/finance-rules";
import { MODULE_DESCRIPTIONS } from "../lib/onboarding";
import { GuidedTransaction } from "./GuidedTransaction";
import { RecordPaymentSheet } from "./RecordPaymentSheet";
import { useDeviceToday } from "./useDeviceToday";
import { summarizeDues } from "../lib/dues-schedule";
import {
  DuesStatusChip, ScheduleSection, TeamScheduleSheet, ApplyScheduleSheet, ChangeScheduleSheet, standingForRecord,
} from "./DuesSchedule";
import { CountUp } from "./CountUp";
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


/**
 * The Remove confirmation names the payment being removed.
 *
 * Looked up from the entry list already on screen by the id the confirmation
 * holds, so the coach sees the amount and date of the row they pressed, not a
 * generic question that could be about any of them. Falls back to the generic
 * wording only if the entry cannot be found (a stale drawer), never to a guess.
 */
export function removeEntryMessage(payment, entryId) {
  const entry = (payment?.log ?? []).find((l) => String(l.id) === String(entryId));
  const tail = "The amount is deducted from what has been paid; the total due is unchanged.";
  if (!entry) return `Remove this payment entry? ${tail}`;
  const who = payment?.player?.full_name ?? payment?.displayName ?? null;
  const when = entry.paid_date ? fmtDate(entry.paid_date) : null;
  const label = when ?? entry.month_label ?? null;
  return `Remove the ${money(entry.amount)} payment${label ? ` from ${label}` : ""}${who ? ` for ${who}` : ""}? ${tail}`;
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
  : s === "To Pay" ? "pill-deposit"
  : "pill-unregistered";


// What Finance receives before the payment-schedule tables exist: no schedule screens at all.
const NO_SCHEDULES = { available: false, template: null, byPayment: {} };

export function FinanceClient({
  budget, transactions, payments, summary, funds, dues, committedTournaments,
  tournaments, players, facilities, budgetItems, canWrite,
  // Review surface only: lets /review render each tab. Defaults to the normal
  // starting tab, so nothing changes in the application itself.
  initialTab = "budget",
  seasonPhase = "current",
  autoOpen = false,
  initialTournament = null,
  rosterPlayers = [],
  autoAddDues = false,
  // True when the link named a section (or a record inside one). Phones then
  // open that section; otherwise they open the Finance overview.
  sectionRequested = false,
  // Payment schedules (see supabase/migrations/20261123223848_player_dues_schedules.sql).
  // `available` is false until that migration is applied; Finance then looks exactly as it did.
  duesSchedules = NO_SCHEDULES,
}) {
  const [tab, setTab] = useState(initialTab);
  // This device's date, or null until the browser reports it. Past due is never claimed before then.
  const deviceToday = useDeviceToday();
  const [teamScheduleOpen, setTeamScheduleOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState(null);

  /*
   * Phones (≤720px) show Finance as an overview plus one section at a time
   * (approved 2026-11-18). Desktop keeps the tabs. One `tab` state serves
   * both; CSS decides which layout is visible, so there is no client-side
   * screen detection during render and no layout flash.
   *
   * The open section is written to the address (?tab=) so the phone's Back
   * gesture returns to the overview, and a direct link opens its section.
   * All four section bodies stay mounted, so a search or filter survives
   * moving between sections, and each view remembers its scroll position.
   */
  const [mobileView, setMobileView] = useState(sectionRequested ? "section" : "overview");
  const tabRef = useRef(tab);
  const viewRef = useRef(mobileView);
  tabRef.current = tab;
  viewRef.current = mobileView;
  const scrollMemo = useRef({});
  // True only when this page itself opened the section, so "‹ Finance" can
  // step back through history; a visitor from a direct link has nothing to
  // step back to inside Finance.
  const pushedSection = useRef(false);
  // History entries a drawer added on top of the section (it opens with a
  // push and closes with a replace), so "‹ Finance" steps back past them.
  const drawerEntries = useRef(0);
  const fromPop = useRef(false);
  const searchParams = useSearchParams();
  const openParam = searchParams?.get("open") ?? null;
  const prevOpen = useRef(openParam);
  useEffect(() => {
    if (!fromPop.current && openParam && !prevOpen.current && pushedSection.current) drawerEntries.current += 1;
    fromPop.current = false;
    prevOpen.current = openParam;
  }, [openParam]);
  const isPhone = () =>
    typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 720px)").matches);
  const viewKey = () => (viewRef.current === "overview" ? "overview" : tabRef.current);
  const rememberScroll = () => { scrollMemo.current[viewKey()] = window.scrollY; };
  const restoreScroll = (key) =>
    requestAnimationFrame(() => window.scrollTo(0, scrollMemo.current[key] ?? 0));

  function openSection(key) {
    rememberScroll();
    setTab(key);
    setMobileView("section");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.pushState(null, "", url);
    pushedSection.current = true;
    drawerEntries.current = 0;
    restoreScroll(key);
  }

  function backToOverview() {
    if (pushedSection.current) {
      // popstate below shows the overview
      window.history.go(-(1 + Math.max(0, drawerEntries.current)));
      drawerEntries.current = 0;
      return;
    }
    rememberScroll();
    setMobileView("overview");
    const url = new URL(window.location.href);
    url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
    restoreScroll("overview");
  }

  useEffect(() => {
    const KEYS = { budget: "budget", transactions: "transactions", funds: "funds", payments: "payments" };
    function onPop() {
      fromPop.current = true;
      const here = new URL(window.location.href).searchParams;
      const hasOpen = Boolean(here.get("open"));
      if (hasOpen !== Boolean(prevOpen.current) && pushedSection.current) {
        drawerEntries.current = Math.max(0, drawerEntries.current + (hasOpen ? 1 : -1));
      }
      if (!isPhone()) return;
      const key = KEYS[here.get("tab")];
      const next = key ? `section:${key}` : "overview";
      if (next === (viewRef.current === "overview" ? "overview" : `section:${tabRef.current}`)) return;
      rememberScroll();
      if (key) {
        setTab(key);
        setMobileView("section");
        restoreScroll(key);
      } else {
        pushedSection.current = false;
        drawerEntries.current = 0;
        setMobileView("overview");
        restoreScroll("overview");
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Desktop switches the tab; a phone opens that section. */
  function showTab(key) {
    if (isPhone()) openSection(key);
    else setTab(key);
  }

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
  // One question at a time, keyed so two rows cannot both be asking.
  const confirmDelete = useConfirm();

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
  // Reallocating dues that already exist. Distinct from editPay, which either
  // creates or edits ONE player.
  const [editingTeamDues, setEditingTeamDues] = useState(false);
  // Shown once, after a Player Dues budget line is created.
  const [duesBudgetNotice, setDuesBudgetNotice] = useState(null);
  // Carried from the budget line into the dues form as a starting figure. The
  // coach still reviews and submits; it is a prefill, not a charge.
  const [duesPrefill, setDuesPrefill] = useState(null);
  // Set from a "Dues not set" row so the form opens on that player. Uses the
  // existing creation path — nothing is created automatically.
  const [duesForPlayer, setDuesForPlayer] = useState(null);
  const [openCats, setOpenCats] = useState({});
  // The payment being recorded in the prefilled sheet (Group 1).
  const [paying, setPaying] = useState(null);

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
    const unlock = lockPageScroll();
    document.addEventListener("keydown", onKey);
    return () => {
      unlock();
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
  const needsCount = otherActions.length;

  /**
   * Switch tab and bring the result into view.
   *
   * rAF defers the scroll until after React has committed the new tab, so we
   * scroll to the rendered destination rather than the previous layout.
   * Honours prefers-reduced-motion.
   */
  function goToTab(key) {
    if (isPhone()) { openSection(key); return; }
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
   * The players the selected Needs Attention action is about.
   *
   * ST-010: this used to narrow the PAYMENTS, and the list then reconciled
   * the roster against that narrowed set — so a player whose record fell
   * outside the filter was shown as "Dues not set" (Allie Cox, paid in full,
   * under "players owing"). The list now always receives every record and
   * uses these ids only to choose which reconciled rows to display.
   */
  const filterPlayerIds = useMemo(() => actionPlayerIds(activeAction), [activeAction]);

  const SECTIONS = [
    { key: "budget", label: "Budget" },
    { key: "transactions", label: "Transactions" },
    { key: "funds", label: "Money In" },
    { key: "payments", label: "Player Dues" },
  ];
  const sectionLabel = SECTIONS.find((x) => x.key === tab)?.label ?? "Budget";

  /** The one figure each overview row carries. Display only; every figure is read from the existing summaries. */
  function sectionFigure(key) {
    if (key === "budget") {
      if (!(summary.budgetedExpenses > 0)) return "No budget planned yet";
      return summary.availableBudget < 0
        ? `${summaryMoney(-summary.availableBudget)} over budget`
        : `${summaryMoney(summary.availableBudget)} available of ${summaryMoney(summary.budgetedExpenses)}`;
    }
    if (key === "transactions") {
      const n = transactions.length;
      if (n === 0) return "Nothing recorded yet";
      const toPay = sumMoney(
        transactions
          .filter((t) => !t.is_income && t.status === "To Pay" && t.actual_amount != null)
          .map((t) => t.actual_amount)
      );
      return `${n} recorded${toPay > 0 ? ` · ${money(toPay)} to pay` : ""}`;
    }
    if (key === "funds") return `${summaryMoney(funds.total)} received this season`;
    if (!(dues.expected > 0)) return "Dues not set yet";
    return `${duesCollectedPercent(dues) ?? 0}% collected · ${
      dues.outstanding > 0 ? `${money(dues.outstanding)} to collect` : "all collected"
    }`;
  }

  return (
    <div className={`fin-root fin-m-${mobileView} fin-tab-${tab}`}>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {/* A PLAN, NOT A CHARGE. Says plainly that nobody has been billed, and
          offers the action that matches the situation: set dues if none exist,
          view them if they do. Nothing is synchronised afterwards — the budget
          is an estimate that moves, dues are a commitment to a family. */}
      {duesBudgetNotice && (
        <div className="notice dues-budget-notice" role="status">
          <div>
            <strong>Player Dues budget added</strong>
            <p>
              {duesBudgetNotice.amount != null && (
                <><strong>{money(duesBudgetNotice.amount)}</strong> has been added to your
                budget as expected player dues revenue. </>
              )}
              Players have not been charged yet.
            </p>
          </div>
          <div className="dues-budget-actions">
            {payments.some((p) => p.totalDue != null) ? (
              <button className="btn btn-secondary"
                      onClick={() => { setDuesBudgetNotice(null); showTab("payments"); }}>
                View player dues
              </button>
            ) : (
              <button className="btn btn-primary"
                      onClick={() => {
                        // Carries the budget figure forward as a starting
                        // point. The coach still reviews who owes and submits;
                        // nothing is charged by dismissing this.
                        setDuesPrefill(duesBudgetNotice.amount ?? null);
                        setDuesBudgetNotice(null);
                        showTab("payments");
                        setEditPay("new");
                      }}>
                Set player dues
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setDuesBudgetNotice(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Phones, inside a section: the way back to the Finance overview. */}
      <button type="button" className="fin-m-back" onClick={backToOverview}>
        <span aria-hidden="true">‹</span> Finance
      </button>

      <div className="page-head">
        <div>
          <h1>
            <span className="fin-h-main">Finance</span>
            <span className="fin-h-section">{sectionLabel}</span>
          </h1>
          <div className="page-sub">{MODULE_DESCRIPTIONS.finance}</div>
        </div>
        <div className="fin-head-actions">
          {/* Contextual entry point. The report is a separate document with
              its own layout — this navigates to it rather than printing this
              page. No Reports area exists yet, by design. */}
          <Link className="btn btn-secondary" href="/reports/season-budget?from=finance">
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
      {/*
        Three answers, in the order a coach asks them (Group 1, 2026-11-19):
        how much budget is left to plan with, how much is owed, what to do next.

        "Available budget", not "Available": it is planned spending capacity,
        Planned minus Committed, never cash on hand. The total, the one
        segmented bar (Budget = Paid + To Pay + Available), a one line note of
        tournament cost not tied to a budget line (already inside Available)
        and the dues scope note are all kept.
      */}
      <div className="st-fband fin-band">
        <section className="card st-fcard fin-budget-panel" aria-labelledby="st-fa-h">
          <p className="st-eyebrow" id="st-fa-h">Available budget</p>
          {summary.budgetedExpenses > 0 ? (<>
            <p className={`st-fcard-big${summary.availableBudget < 0 ? " is-over" : ""}`}>
              <CountUp value={summary.availableBudget} format="split" />
            </p>
            <p className="st-fcard-of">
              {summary.availableBudget < 0 ? "over" : "left to plan with"}, of a <strong>{summaryMoney(summary.budgetedExpenses)}</strong> season budget · {summary.percentCommitted ?? 0}% committed
            </p>
            <BudgetSplit summary={summary} />
            {(budget.unassignedTotal ?? 0) > 0 && (
              <p className="fin-unassigned-line">
                <span className="fin-unassigned-mark" aria-hidden="true" />
                <span>
                  Includes <strong>{summaryMoney(budget.unassignedTotal)}</strong> of committed tournament
                  cost not tied to a budget line.
                </span>
              </p>
            )}
            <p className="st-fcard-note">Planned spending capacity, not cash on hand.</p>
            <button className="fin-lead-link fin-view-link" onClick={() => goToTab("budget")}>View full budget →</button>
          </>) : (<>
            <h3 className="st-fcard-h">No budget planned yet</h3>
            <p className="st-fcard-of">Add a line for each kind of cost. Available budget updates as you commit tournaments and record spending.</p>
            <button className="fin-lead-link fin-view-link" onClick={() => goToTab("budget")}>Set up the budget →</button>
          </>)}
        </section>

        <section className="card st-fcard fin-dues-panel" aria-labelledby="st-fd-h">
          <p className="st-eyebrow" id="st-fd-h">Outstanding dues</p>
          {dues.expected > 0 ? (<>
            <p className="st-fcard-big"><CountUp value={dues.outstanding} format="split" /></p>
            <p className="st-fcard-of"><strong><CountUp value={dues.collected} /></strong> of {money(dues.expected)} collected · <CountUp value={duesCollectedPercent(dues) ?? 0} format="pct" /></p>
            <Meter value={dues.collected} total={dues.expected} hidePct />
            <p className="fin-dues-scope">Covers every dues record for this season, including players who have since left the roster.</p>
            <button className="fin-lead-link fin-view-link" onClick={() => selectAction("outstanding")}>View all player balances →</button>
          </>) : (<>
            <h3 className="st-fcard-h">Dues not set yet</h3>
            <p className="st-fcard-of">Set what each player owes. Payments, partial payments and balances track from there.</p>
            {canWrite && <button className="fin-lead-link fin-view-link" onClick={() => { goToTab("payments"); setEditPay("new"); }}>Set dues →</button>}
          </>)}
          {duesAction && (
            <p className="fin-dues-gap">
              <span className="fin-dues-gap-mark" aria-hidden="true" />
              <span className="fin-dues-gap-text">
                <strong>
                  {duesAction.affected.length === 1 ? "1 player has no dues set" : `${duesAction.affected.length} players have no dues set`}
                </strong>{": "}
                {duesAction.affected.map((a) => a.player?.full_name).filter(Boolean).join(", ")}, not counted above.
                {canWrite && (
                  <button className="fin-lead-link fin-dues-gap-cta" onClick={() => { goToTab("payments"); setEditPay("new"); }}>Set dues →</button>
                )}
              </span>
            </p>
          )}
        </section>

        <NextAction
          payments={payments}
          canWrite={canWrite}
          seasonPhase={seasonPhase}
          hasBudget={summary.budgetedExpenses > 0}
          onRecord={(p) => setPaying(p)}
          onAddTxn={() => { showTab("transactions"); setEditTxn("new"); }}
          onBudget={() => goToTab("budget")}
        />
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
            {/* Starts collapsed (approved 2026-11-18): one line until the
                coach chooses to look. Show/Hide says what the tap does. */}
            <button
              type="button"
              className="fin-attention-toggle"
              onClick={() => setNeedsOpen(!needsOpen)}
              aria-expanded={needsOpen}
              aria-controls="fin-attention-body"
            >
              {needsOpen ? "Hide" : "Show"}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d={needsOpen ? "M7 14l5-5 5 5" : "M7 10l5 5 5-5"} />
              </svg>
            </button>
          </div>

          <p className="fin-attention-summary">
            {otherActions.map((a) => financeActionText(a, dues)).join(" · ")}
          </p>

          {needsOpen && (
            <div className="fin-attention-body" id="fin-attention-body">
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

      {/* Phones: the four sections, then the parent report. */}
      <nav className="fin-m-sections" aria-label="Finance sections">
        {SECTIONS.map((x) => (
          <button key={x.key} type="button" className="fin-m-row" onClick={() => openSection(x.key)}>
            <span className="fin-m-row-name">{x.label}</span>
            <span className="fin-m-row-fig">{sectionFigure(x.key)}</span>
            <span className="fin-m-chev" aria-hidden="true">›</span>
          </button>
        ))}
      </nav>
      <Link className="fin-m-row fin-m-report" href="/reports/season-budget?from=finance">
        <span className="fin-m-row-name">Parent budget report</span>
        <span className="fin-m-row-fig">A summary to share with families</span>
        <span className="fin-m-chev" aria-hidden="true">›</span>
      </Link>
      {tab === "transactions" && <p className="fin-m-secfig">{sectionFigure("transactions")}</p>}

      {activeAction && (
        <FilterChip
          label={`Showing ${activeAction.affected.length} ${FINANCE_FILTER_LABELS[activeAction.id] ?? "affected"}`}
          onClear={() => setActionId(null)}
        />
      )}

      <div className="tabs" role="tablist" ref={tabsRef}>
        {SECTIONS.map((t) => (
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

      {/* H3: one "How this works" for Finance, matched to the tab (2026-11).
          Player Dues gets its three questions; every other tab gets the
          existing "How the pieces fit" explanation. */}
      <div className="fin-context">
      {tab === "payments" ? (
        <ContextHelp
          key="dues"
          align="end"
          context="dues"
          questions={[{ id: "dues-how" }, { id: "dues-payment" }, { id: "dues-exempt" }]}
          learnMore="money#dues"
        />
      ) : (
        <ContextHelp key="pieces" align="end" title="How Finance fits together" pieces="money" learnMore="money" />
      )}
      </div>

      <div className="fin-tabbody" hidden={tab !== "budget"}>
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
          onDelete={(row) => confirmDelete.ask(`budget:${row.id}`)}
          confirmingDelete={confirmDelete.asking}
          onCancelDelete={() => confirmDelete.cancel()}
          onConfirmDelete={(row) => {
            const fd = new FormData();
            fd.set("id", row.id);
            run(deleteBudgetItem, fd, () => confirmDelete.cancel());
          }}
          deleteError={error}
          pending={pending}
          transactions={transactions}
          tournaments={tournaments}
          /* Straight to the transaction that is in the way, with its budget
             line editable there. The confirmation closes first so the coach is
             not left with a stale modal behind the drawer. */
          onReviewTransaction={(t) => {
            confirmDelete.cancel();
            showTab("transactions");
            setDetailTxn(t);
          }}
        />
      </div>

      <div className="fin-tabbody" hidden={tab !== "funds"}>
        <FundsInTab
          funds={funds}
          dues={dues}
          budget={budget}
          canWrite={canWrite}
          pending={pending}
          openCats={openCats}
          setOpenCats={setOpenCats}
          onEdit={(row) => setEditBudget(row)}
          onDelete={(row) => confirmDelete.ask(`budget:${row.id}`)}
          confirmingDelete={confirmDelete.asking}
          onCancelDelete={() => confirmDelete.cancel()}
          onConfirmDelete={(row) => {
            const fd = new FormData();
            fd.set("id", row.id);
            run(deleteBudgetItem, fd, () => confirmDelete.cancel());
          }}
          deleteError={error}
          transactions={transactions}
          tournaments={tournaments}
          onReviewTransaction={(t) => {
            confirmDelete.cancel();
            showTab("transactions");
            setDetailTxn(t);
          }}
        />
      </div>

      <div className="fin-tabbody" hidden={tab !== "transactions"}>
        <TransactionsTab
          transactions={transactions}
          canWrite={canWrite}
          onAdd={() => setEditTxn("new")}
          onOpen={(t) => setDetailTxn(t)}
        />
      </div>

      <div className="fin-tabbody" hidden={tab !== "payments"}>
        <PaymentsTab
          payments={payments}
          filterPlayerIds={filterPlayerIds}
          activePlayers={players}
          canWrite={canWrite}
          onAdd={() => { setDuesForPlayer(null); setEditPay("new"); }}
          onAddFor={(playerId) => { setDuesForPlayer(playerId); setEditPay("new"); }}
          onOpen={(p) => openDetail(p)}
          onBulk={(fd) => run(setDuesForAll, fd, { success: "Dues set for the players who needed them" })}
          onEditTeamDues={() => setEditingTeamDues(true)}
          schedules={duesSchedules}
          today={deviceToday}
          onTeamSchedule={() => setTeamScheduleOpen(true)}
          pending={pending}
          filtered={Boolean(activeAction)}
          filterLabel={activeAction ? FINANCE_FILTER_LABELS[activeAction.id] ?? null : null}
          onClearFilter={() => setActionId(null)}
        />
      </div>

      {editBudget && (
        <BudgetForm
          row={editBudget === "new" ? null : editBudget}
          pending={pending}
          onSubmit={(fd) =>
            run(saveBudgetItem, fd, (result) => {
              setEditBudget(null);
              // A budget line is a plan. Nobody has been charged, and saying so
              // here is what stops the budget figure and the obligations from
              // being read as the same thing.
              if (result?.duesBudget) setDuesBudgetNotice(result.duesBudget);
            })
          }
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
          onDelete={() => confirmDelete.ask(`txn:${detailTxn.id}`)}
          confirmingDelete={confirmDelete.isAsking(`txn:${detailTxn.id}`)}
          onCancelDelete={() => confirmDelete.cancel()}
          onConfirmDelete={() => {
            const fd = new FormData();
            fd.set("id", detailTxn.id);
            // The transaction is gone, so closing the drawer is the result.
            run(deleteTransaction, fd, () => { confirmDelete.cancel(); setDetailTxn(null); });
          }}
          drawerError={error}
        />
      )}

      {editTxn === "new" && (
        <GuidedTransaction
          budgetItems={budgetItems}
          tournaments={tournaments}
          players={players}
          facilities={facilities}
          transactions={transactions}
          onClose={() => setEditTxn(null)}
        />
      )}

      {editTxn && editTxn !== "new" && (
        <TransactionForm
          row={editTxn === "new" ? null : editTxn}
          budgetItems={budgetItems}
          tournaments={tournaments}
          players={players}
          facilities={facilities}
          pending={pending}
          onSubmit={(fd, assignTournamentId) =>
            run(saveTransaction, fd, async () => {
              /* Saved first, assigned second, and only when the coach ticked
                 the box. The transaction is never blocked by the assignment:
                 if it fails, the money is still recorded and the tournament
                 simply stays in Needs Attention. Existing tournaments are
                 never touched unless chosen on this transaction. */
              if (assignTournamentId) {
                const line = fd.get("budget_item_id");
                if (line) {
                  const af = new FormData();
                  af.set("tournament_id", assignTournamentId);
                  af.set("budget_item_id", line);
                  await setTournamentBudgetLine(af);
                }
              }
              setEditTxn(null);
              setDetailTxn(null);
            })
          }
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
          onRecordOpen={() => setPaying(detailPay)}
          onDeleteEntry={(entryId) => confirmDelete.ask(`entry:${entryId}`)}
          confirmingEntry={confirmDelete.asking}
          onCancelEntry={() => confirmDelete.cancel()}
          onConfirmEntry={(entryId) => {
            const fd = new FormData();
            fd.set("id", entryId);
            // The payment record itself remains; only this entry goes. The
            // drawer stays open and the refreshed totals are the feedback.
            run(deletePaymentEntry, fd, () => confirmDelete.cancel());
          }}
          drawerError={error}
          onEdit={() => setEditPay(detailPay)}
          schedules={duesSchedules}
          today={deviceToday}
          onSchedule={() => setScheduleFor(detailPay)}
        />
      )}

      {teamScheduleOpen && duesSchedules.available && (
        <TeamScheduleSheet
          template={duesSchedules.template}
          onClose={() => setTeamScheduleOpen(false)}
          onSavedChoosePlayers={() => setApplyOpen(true)}
        />
      )}
      {applyOpen && duesSchedules.available && duesSchedules.template && (
        <ApplyScheduleSheet
          template={duesSchedules.template}
          payments={payments}
          byPayment={duesSchedules.byPayment}
          today={deviceToday}
          onClose={() => setApplyOpen(false)}
        />
      )}
      {scheduleFor && duesSchedules.available && (
        <ChangeScheduleSheet
          key={scheduleFor.id}
          p={scheduleFor}
          template={duesSchedules.template}
          today={deviceToday}
          onClose={() => setScheduleFor(null)}
        />
      )}

      {/* The SAME form as initial setup, so the mode toggle, the labels and
          the preview are identical and cannot drift from one another. Only the
          action differs: this one updates existing obligations instead of
          creating new ones. */}
      {editingTeamDues && (
        <PaymentForm
          row={null}
          teamEdit
          players={players}
          existing={payments}
          pending={pending}
          formError={error}
          onSubmit={(fd) =>
            run(editDuesForAll, fd, {
              onDone: () => setEditingTeamDues(false),
              success: "Team dues updated",
            })
          }
          onCancel={() => setEditingTeamDues(false)}
        />
      )}

      {paying && <RecordPaymentSheet p={paying} onClose={() => setPaying(null)} />}

      {editPay && (
        <PaymentForm
          row={editPay === "new" ? null : editPay}
          players={players}
          presetPlayerId={duesForPlayer}
          onOpenExisting={(record) => {
            setEditPay(null);
            setDuesForPlayer(null);
            openDetail(record);
          }}
          prefillTotal={duesPrefill}
          existing={payments}
          pending={pending}
          formError={error}
          onSubmit={(fd, scope) =>
            run(scope === "all" ? setDuesForAll : savePlayerPayment, fd, () => {
              setEditPay(null);
              setDuesForPlayer(null);
              closeDetail();
            })
          }
          onCancel={() => { setEditPay(null); setDuesForPlayer(null); }}
        />
      )}
    </div>
  );
}

/* ---------------- Money In ---------------- */

/**
 * Money coming in, kept separate from expenses.
 *
 * Player dues derive from Player Payments and are read-only here — recording
 * them as transactions as well would double-count every payment.
 */
export function FundsInTab({
  funds, dues, budget = null, canWrite = false, pending = false,
  openCats = {}, setOpenCats = () => {},
  onEdit, onDelete, confirmingDelete = null, onCancelDelete, onConfirmDelete, deleteError = null,
  transactions = [], tournaments = [], onReviewTransaction,
}) {
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
          const progress = incomeProgress(r.goal, r.received);
          const remaining = progress.remaining;
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
                    {progress.state === "over" ? (
                      <span className="fi-met fi-over">
                        Over {r.goalWord} by {money(progress.over)}
                      </span>
                    ) : remaining > 0 ? (
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

      {/* Income goals are budget lines flagged as income, so they are edited
          and deleted with the same form, the same server action and the same
          protections as an expense line. Nothing here is a second copy of that
          logic: this is the existing table, in income mode. */}
      {budget?.income?.length > 0 && (
        <BudgetSection
          title="Income goals"
          income
          lineLabel="income goal"
          groups={budget.income}
          openCats={openCats}
          setOpenCats={setOpenCats}
          canWrite={canWrite}
          onEdit={onEdit}
          onDelete={onDelete}
          pending={pending}
          confirmingDelete={confirmingDelete}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          deleteError={deleteError}
          transactions={transactions}
          onReviewTransaction={onReviewTransaction}
          tournaments={tournaments}
        />
      )}
    </>
  );
}

/* ---------------- Budget ---------------- */

/**
 * The confirmation props are threaded through deliberately.
 *
 * FinanceClient passed confirmingDelete, onCancelDelete, onConfirmDelete and
 * deleteError to this component, and the parameter list did not destructure
 * them, so they were dropped here and never reached BudgetSection. Its own
 * `confirmingDelete = null` default then meant the comparison against
 * `budget:<id>` was never true and the confirmation never mounted at all.
 *
 * Clicking Delete DID fire and DID set state; there was simply nothing
 * rendering it. Nothing was hidden, off-screen or behind a z-index — this is
 * why the scroll-into-view change had no effect.
 */
export function BudgetTab({ budget, summary, committedTournaments, tournamentPaid = 0, openCats, setOpenCats, canWrite, onAdd, onEdit, onDelete, pending,
                            confirmingDelete = null, onCancelDelete, onConfirmDelete, deleteError = null,
                            transactions = [], onReviewTransaction, tournaments = [] }) {

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
            seasonPool={{ amount: budget.seasonUnassigned ?? 0, count: budget.seasonUnassignedCount ?? 0 }}
            setOpenCats={setOpenCats} canWrite={canWrite} onEdit={onEdit}
            onDelete={onDelete} pending={pending}
            confirmingDelete={confirmingDelete}
            onCancelDelete={onCancelDelete}
            onConfirmDelete={onConfirmDelete}
            deleteError={deleteError}
            transactions={transactions}
            onReviewTransaction={onReviewTransaction}
            tournaments={tournaments}
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
 * SUMMARY ONLY (headline tiles, the strip above a tab). Figures inside a table
 * use money(): always two decimals, so a column reads $44,000.00 / $2,190.00
 * and the decimal points line up (table standard, 2026-11).
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

function BudgetSection({ title, groups, openCats, setOpenCats, canWrite, onEdit, onDelete, pending, income, action,
                        confirmingDelete = null, onCancelDelete, onConfirmDelete, deleteError = null,
                        transactions = [], onReviewTransaction, tournaments = [],
                        lineLabel = "budget line", seasonPool = null }) {
  if (groups.length === 0) return null;

  /**
   * INCOME MODE.
   *
   * The same table, the same Edit and Delete, the same protections. Only the
   * words and the figures shown change: an income line is a goal with money
   * received against it, not a cost with money paid out. The expense wording
   * and arithmetic below are untouched when `income` is false.
   *
   * Category open-state is keyed separately so an income category and an
   * expense category that share a name do not open together.
   */
  const catKey = (g) => (income ? `income:${g.category}` : g.category);
  const progressText = (p) =>
    p.state === "over" ? `Over goal by ${money(p.over)}`
    : p.state === "met" ? "Goal met"
    : p.state === "no-goal" ? "No goal set"
    : p.received > 0 ? "In progress" : "Not started";

  // The parent holds an id; the dialog needs the row it names. Looked up
  // across every category so a collapsed one still resolves.
  const confirmRow = confirmingDelete
    ? groups.flatMap((g) => g.rows).find((r) => `budget:${r.id}` === confirmingDelete) ?? null
    : null;

  /**
   * What is actually in the way.
   *
   * Known before the coach clicks Delete, from data already on the page, so
   * the modal can offer the right thing straight away rather than presenting a
   * Delete button and then refusing. The server still checks: this decides
   * what to show, not what is allowed.
   */
  const blockers = confirmRow
    ? transactions.filter((t) => t.budget_item_id === confirmRow.id)
    : [];

  /**
   * ST-007: a tournament can be allocated to a budget line without a single
   * transaction existing yet — that's the normal state for a Committed event
   * nobody has paid toward. `blockers` above never saw those, so this line
   * deleted clean, the FK quietly cleared the tournament's budget_item_id
   * (ON DELETE SET NULL), and the tournament's committed cost vanished from
   * Finance with nothing on screen to explain it. Checked separately from
   * transaction blockers, and — like them — never auto-resolved: which
   * budget line a tournament's cost counts against is a decision that stays
   * with the coach.
   */
  const tournamentBlockers = confirmRow
    ? tournaments.filter((t) => t.budget_item_id === confirmRow.id)
    : [];

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
          <span className="budget-num">{income ? "Goal" : "Budget"}</span>
          <span className="budget-num">{income ? "Received" : "Paid"}</span>
          <span className="budget-num">{income ? "Remaining" : "To pay"}</span>
          <span className="budget-num budget-num-avail">{income ? "Status" : "Available"}</span>
          <span />
        </div>

        {groups.map((g) => {
          const open = openCats[catKey(g)] ?? false;
          const gp = income ? incomeProgress(g.budgeted, g.paidTotal) : null;

          return (
            <div key={g.category} className={`budget-group${open ? " is-open" : ""}`}>
              <button
                className="budget-row budget-cat"
                onClick={() => setOpenCats({ ...openCats, [catKey(g)]: !open })}
                aria-expanded={open}
              >
                <span className={`group-caret${open ? "" : " collapsed"}`} aria-hidden="true">▾</span>

                <span className="budget-name">
                  <span className="budget-cat-name">{g.category}</span>
                  {/* Same information the Status column carried, in plain
                      English beneath the category it describes. */}
                  <span className="budget-sub budget-cat-sub">
                    {income
                      ? gp.state === "no-goal"
                        ? "No goal set"
                        : `${Math.min(100, Math.round((gp.received / gp.goal) * 100))}% of goal received`
                      : g.percentCommitted == null
                      ? "No spending recorded"
                      : `${g.percentCommitted}% of budget committed`}
                  </span>
                </span>

                {/* data-label drives the mobile layout, where the column
                    header is hidden and four bare figures would otherwise be
                    unexplained. Desktop ignores it entirely. */}
                <span className="budget-num" data-label={income ? "Goal" : "Budget"}>{money(g.budgeted)}</span>
                <span className="budget-num" data-label={income ? "Received" : "Paid"}>{money(g.paidTotal)}</span>
                <span className="budget-num" data-label={income ? "Remaining" : "To pay"}>
                  {income ? money(gp.remaining) : money(g.toPay)}
                </span>
                {income ? (
                  <span
                    data-label="Status"
                    className={`budget-num budget-num-avail strong${gp.state === "over" ? " income-over" : ""}`}
                  >
                    {progressText(gp)}
                  </span>
                ) : (
                  <span
                    data-label="Available"
                    className={`budget-num budget-num-avail strong${g.available < 0 ? " over" : ""}`}
                  >
                    {g.available < 0
                      ? `Over ${money(Math.abs(g.available))}`
                      : money(g.available)}
                  </span>
                )}

                {/* Track 6 is shared with the line rows' actions. The category
                    row keeps the cell so the columns stay aligned; its Status
                    text now lives beneath the category name. */}
                <span />
              </button>

              {open &&
                g.rows.map((r) => (
                  <Fragment key={r.id}>
                  <div className="budget-row budget-line">
                    <span />

                    <span className="budget-name budget-name-indent">
                      <span className="budget-line-name">{r.name}</span>
                      {r.quantity != null && r.unitCost != null && (
                        <span className="budget-sub">
                          {quantity(r.quantity)} &times; {money(r.unitCost)}
                        </span>
                      )}
                    </span>

                    {(() => {
                      const rp = income ? incomeProgress(r.budgeted, r.actual) : null;
                      return income ? (
                        <>
                          <span className="budget-num" data-label="Goal">{money(r.budgeted)}</span>
                          <span className="budget-num" data-label="Received">{money(r.actual)}</span>
                          <span className="budget-num" data-label="Remaining">{money(rp.remaining)}</span>
                          <span
                            data-label="Status"
                            className={`budget-num budget-num-avail${rp.state === "over" ? " income-over" : ""}`}
                          >
                            {progressText(rp)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="budget-num" data-label="Budget">{money(r.budgeted)}</span>
                          <span className="budget-num" data-label="Paid">{money(r.actual)}</span>
                          <span className="budget-num" data-label="To pay">{money(r.toPay)}</span>
                          <span
                            data-label="Available"
                            className={`budget-num budget-num-avail${r.available < 0 ? " over" : ""}`}
                          >
                            {r.available < 0
                              ? `Over ${money(Math.abs(r.available))}`
                              : money(r.available)}
                          </span>
                        </>
                      );
                    })()}

                    <span className="budget-line-actions">
                      {canWrite && (
                        <>
                          <button className="btn btn-ghost" onClick={() => onEdit(r)} disabled={pending}>Edit</button>
                          <button className="btn btn-danger-ghost" onClick={() => onDelete(r)} disabled={pending}>Delete</button>
                        </>
                      )}
                    </span>
                  </div>
                  </Fragment>
                ))}

              {/* Committed tournaments with no budget line, held in this
                  tournament category. Already inside the category's committed
                  and Available figures, so the lines above and this row add up
                  to the category. Linking a line stays optional. */}
              {open && !income && g.unassignedAmount > 0 && (
                <div className="budget-row budget-line budget-pool">
                  <span />
                  <span className="budget-name budget-name-indent">
                    <span className="budget-line-name">Not assigned to a line</span>
                    <span className="budget-sub">
                      {g.unassignedCount} committed {g.unassignedCount === 1 ? "tournament" : "tournaments"} · counted here automatically
                    </span>
                  </span>
                  <span className="budget-num" data-label="Budget">&mdash;</span>
                  <span className="budget-num" data-label="Paid">{money(0)}</span>
                  <span className="budget-num" data-label="To pay">{money(g.unassignedAmount)}</span>
                  <span className="budget-num budget-num-avail" data-label="Available">&mdash;</span>
                  <span className="budget-line-actions" />
                </div>
              )}
            </div>
          );
        })}

        {/* No tournament category in this budget: the same committed cost shown
            at the season level, so the reduction in Available is explained
            rather than silent. */}
        {!income && seasonPool && seasonPool.amount > 0 && (
          <div className="budget-group is-open">
            <div className="budget-row budget-cat budget-pool-season">
              <span />
              <span className="budget-name">
                <span className="budget-cat-name">Tournament costs (no budget line)</span>
                <span className="budget-sub budget-cat-sub">
                  {seasonPool.count} committed {seasonPool.count === 1 ? "tournament" : "tournaments"} · already counted in Available
                </span>
              </span>
              <span className="budget-num" data-label="Budget">&mdash;</span>
              <span className="budget-num" data-label="Paid">{money(0)}</span>
              <span className="budget-num" data-label="To pay">{money(seasonPool.amount)}</span>
              <span className="budget-num budget-num-avail" data-label="Available">&mdash;</span>
              <span />
            </div>
          </div>
        )}
      </div>

      {/* OUTSIDE THE GROUPS ON PURPOSE.
          Rendered inside a category, this confirmation was unmounted the
          moment the coach collapsed it, and on the last row it landed against
          the page footer. A modal cannot be scrolled past or collapsed away,
          and it is the same question either way. */}
      {confirmRow && blockers.length === 0 && tournamentBlockers.length === 0 && (
        <ConfirmDialog
          title={`Delete ${lineLabel}`}
          message={`Delete the ${lineLabel} "${confirmRow.name}"? Transactions already recorded against it are not deleted.`}
          confirmLabel={`Delete ${lineLabel}`}
          pendingLabel="Deleting…"
          cancelLabel={`Keep ${lineLabel}`}
          pending={pending}
          error={deleteError}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(confirmRow)}
        />
      )}

      {/* ST-007: tournament allocations block the same as transactions do,
          shown once transaction blockers (if any) are cleared. There's no
          move_to here — reassigning which budget line a tournament counts
          against happens on the tournament itself, the same record that
          shows its cost and its committed/considering status, not from a
          picker inside this dialog. */}
      {confirmRow && blockers.length === 0 && tournamentBlockers.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancelDelete}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Can&rsquo;t delete this {lineLabel} yet</h2>
            </div>

            <div className="modal-body">
              <p className="section-body">
                <strong>{tournamentBlockers.length}</strong>{" "}
                {tournamentBlockers.length === 1 ? "tournament is" : "tournaments are"} allocated to{" "}
                &ldquo;{confirmRow.name}&rdquo;. Change{" "}
                {tournamentBlockers.length === 1 ? "its" : "their"} budget line before deleting this one.
              </p>

              <ul className="blocker-list">
                {tournamentBlockers.slice(0, 5).map((t) => (
                  <li key={t.id} className="blocker">
                    <RelatedLink
                      href={`/tournaments?open=${t.id}&section=costs`}
                      className="blocker-open"
                      title={`Open ${t.name} in Tournaments`}
                    >
                      <span className="blocker-main">
                        <span className="blocker-name">{t.name}</span>
                      </span>
                      <span className="blocker-amount">{money(t.total_cost)}</span>
                    </RelatedLink>
                  </li>
                ))}
              </ul>

              {tournamentBlockers.length > 5 && (
                <p className="field-note">
                  and {tournamentBlockers.length - 5} more.
                </p>
              )}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-secondary" onClick={onCancelDelete}>
                Keep {lineLabel}
              </button>
              {/* No Delete button here either — it could only fail. */}
              <RelatedLink
                href={`/tournaments?open=${tournamentBlockers[0].id}&section=costs`}
                className="btn btn-primary"
                title={`Open ${tournamentBlockers[0].name} in Tournaments`}
              >
                {tournamentBlockers.length === 1 ? "Review tournament" : "Review tournaments"}
              </RelatedLink>
            </div>
          </div>
        </div>
      )}

      {/* BLOCKED IS A DIFFERENT QUESTION.
          Telling a coach that a transaction is in the way, without saying
          which one or where to go, leaves them to close the box, open
          Transactions, and work out for themselves what to change. And
          offering Delete while deletion is impossible invites a click that can
          only fail.

          So when something blocks it, this stops being a confirmation and
          becomes the thing that resolves it: what is in the way, and a way
          straight to it. Nothing is moved automatically — reassigning is a
          decision about financial history and stays with the coach. */}
      {confirmRow && blockers.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancelDelete}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Can&rsquo;t delete this {lineLabel} yet</h2>
            </div>

            <div className="modal-body">
              <p className="section-body">
                <strong>{blockers.length}</strong>{" "}
                {blockers.length === 1 ? "transaction is" : "transactions are"} assigned to{" "}
                &ldquo;{confirmRow.name}&rdquo;. Reassign{" "}
                {blockers.length === 1 ? "it" : "them"} before deleting this {lineLabel}.
              </p>

              <ul className="blocker-list">
                {/* Capped so a line with forty transactions does not produce a
                    modal taller than the screen. */}
                {blockers.slice(0, 5).map((t) => (
                  <li key={t.id} className="blocker">
                    <button
                      type="button"
                      className="blocker-open"
                      onClick={() => onReviewTransaction?.(t)}
                    >
                      <span className="blocker-main">
                        <span className="blocker-name">{t.vendor || t.item || "Transaction"}</span>
                        <span className="blocker-date">{fmtDate(t.txn_date)}</span>
                      </span>
                      <span className="blocker-amount">{money(t.actual_amount)}</span>
                    </button>
                  </li>
                ))}
              </ul>

              {blockers.length > 5 && (
                <p className="field-note">
                  and {blockers.length - 5} more.
                </p>
              )}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-secondary" onClick={onCancelDelete}>
                Keep {lineLabel}
              </button>
              {/* No Delete button at all. It could only fail. */}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onReviewTransaction?.(blockers[0])}
              >
                {blockers.length === 1 ? "Review transaction" : "Review transactions"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetForm({ row, pending, onSubmit, onCancel, seedName = "", seedIsIncome = false }) {
  // Empty on a new line so the placeholder shows and `required` bites; on an
  // existing line, the line's own category — including an off-list one.
  const [catChoice, setCatChoice] = useState(row?.category ?? "");
  const [customCat, setCustomCat] = useState("");
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
              {/* A native select, not a datalist. A datalist renders as a plain
                  text box with no dropdown affordance, so on mobile a coach saw
                  a required "Category" field and no way to discover the
                  choices. A select gets the platform picker for free.

                  An off-list category the team already uses is included by
                  categoryOptions(), so editing that line shows its own value
                  selected and leaves it unchanged unless the coach picks
                  something else. */}
              <select
                id="b-cat"
                name={catChoice === CATEGORY_OTHER ? undefined : "category"}
                required
                value={catChoice}
                onChange={(e) => setCatChoice(e.target.value)}
              >
                <option value="" disabled>Choose a category…</option>
                {categoryOptions(row?.category).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value={CATEGORY_OTHER}>{CATEGORY_OTHER_LABEL}</option>
              </select>

              {catChoice === CATEGORY_OTHER && (
                <div className="field" style={{ marginTop: 10 }}>
                  <label htmlFor="b-cat-other">New category name</label>
                  <input
                    id="b-cat-other"
                    name="category"
                    required
                    autoFocus
                    placeholder="e.g. Travel"
                    value={customCat}
                    onChange={(e) => setCustomCat(e.target.value)}
                  />
                </div>
              )}
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
                <th className="th-num">Amount</th>
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
                    {/* Income has no status: it is recorded when it is received. */}
                    {!t.is_income && (
                      <span className={`txn-status ${statusClass(t.status)}`} title={t.status}>
                        {t.status}
                      </span>
                    )}
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

function TransactionDetail({ t, canWrite, pending, onClose, onEdit, onDelete,
                            confirmingDelete = false, onCancelDelete, onConfirmDelete, drawerError = null }) {
  return (
    <DrawerShell onClose={onClose} ariaLabel="Transaction details">
        <div className="drawer-head">
          <div className="drawer-head-text">
            <h2>{t.item}</h2>
            <div className="drawer-head-meta">
              <span className="drawer-head-dates">{fmtDate(t.txn_date)}</span>
              {t.vendor && <span>{t.vendor}</span>}
            </div>
            <div className="drawer-head-pills">
              {t.is_income
                ? <span className="pill pill-paid">Income</span>
                : <span className={`pill ${statusClass(t.status)}`}>{t.status}</span>}
            </div>
          </div>
          <div className="drawer-head-actions">
            {canWrite && (
              <MoreActionsMenu disabled={pending} items={[{ label: "Delete transaction", danger: true, onSelect: onDelete }]} />
            )}
            <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="drawer-body">
          <div className="cost-box">
            <div className="cost-row cost-total">
              <span>Amount</span><span>{money(t.actual_amount)}</span>
            </div>
          </div>
          <p className="section-note">{transactionEffect(t)}</p>

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
            {confirmingDelete ? (
              <ConfirmAction
                message={`Delete "${t.item}"? This removes the transaction from the ledger; anything it was linked to is unaffected.`}
                confirmLabel="Delete transaction"
                pendingLabel="Deleting…"
                cancelLabel="Keep transaction"
                pending={pending}
                error={drawerError}
                onCancel={onCancelDelete}
                onConfirm={onConfirmDelete}
              />
            ) : (
            <>
            {drawerError && <p className="drawer-foot-error" role="alert">{drawerError}</p>}
            <button className="btn btn-primary" onClick={onEdit} disabled={pending}>Edit details</button>
            </>
            )}
          </div>
        )}
    </DrawerShell>
  );
}

function TransactionForm({ row, budgetItems, tournaments, players, facilities, pending, onSubmit, onCancel, onCreateBudgetLine, justCreatedLineId }) {
  const isNew = !row;
  const [budgetItemId, setBudgetItemId] = useState(row?.budget_item_id ?? "");
  const [amount, setAmount] = useState(row?.actual_amount ?? "");
  const [tournamentId, setTournamentId] = useState(row?.tournament_id ?? "");
  // Opt-in, and only ever for the tournament chosen on this transaction.
  const [assignTournament, setAssignTournament] = useState(false);
  const [isIncome, setIsIncome] = useState(Boolean(row?.is_income));
  const [pickingLine, setPickingLine] = useState(false);

  /** The chosen tournament, when it has no budget category of its own. */
  const unassignedPick = tournamentId
    ? (tournaments ?? []).find((t) => t.id === tournamentId && !t.budget_item_id) ?? null
    : null;

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
        <form action={(fd) => onSubmit(fd, assignTournament && unassignedPick ? unassignedPick.id : null)}>
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
                /* ST-004: shown immediately when the picker opens, before any
                   typing — a coach shouldn't have to already know a budget
                   line's name to see what exists. `suggested` is the picker's
                   existing pre-search slot (used elsewhere for likely
                   matches); typing still narrows the list via `matches`,
                   computed separately from `items` above, so search behavior
                   is unchanged. */
                suggested={eligibleLines}
                suggestedLabel={isIncome ? "Income budget lines" : "Expense budget lines"}
                renderItem={(b) => (
                  <>
                    <span className="picker-item-name">{b.name}</span>
                    <span className="picker-item-meta">{b.category}</span>
                  </>
                )}
                emptyHint={`No ${isIncome ? "income" : "expense"} budget lines exist yet for this season.`}
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
              {/* Income has no status: it is recorded when it arrives and the
                  server always stores it as Paid. */}
              {!isIncome && (
                <div className="field">
                  <label htmlFor="t-status">Status</label>
                  <select id="t-status" name="status" defaultValue={row?.status ?? DEFAULT_TXN_STATUS}>
                    {TXN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
            </div>

            <p className="field-note">
              {isIncome
                ? "Record income when you receive it. It counts toward Money In. Income you're expecting belongs on an income budget line."
                : "Paid means the money has left the team. To Pay means it's owed but not paid yet: it counts against the budget and shows in To Pay."}
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

              {/* The transaction already requires a budget line, so by this
                  point the coach has answered the question this tournament is
                  missing. Offered as an explicit, confirmable choice — never
                  applied silently, and never to a historical tournament the
                  coach did not pick here. Assignment goes through the existing
                  setTournamentBudgetLine action, so enforce_tournament_budget_link
                  still validates same-organization, same-season and
                  expense-not-income. */}
              {unassignedPick && (
                <div className="txn-assign">
                  <p className="txn-assign-lead">
                    <strong>{unassignedPick.name}</strong> isn&rsquo;t tied to a budget line. Its{" "}
                    {money(unassignedPick.total_cost)} commitment already counts toward Available;
                    tying it to a line is optional.
                  </p>
                  {budgetItemId ? (
                    <label className="txn-assign-check">
                      <input
                        type="checkbox"
                        checked={assignTournament}
                        onChange={(e) => setAssignTournament(e.target.checked)}
                      />
                      <span>
                        Also assign this tournament to{" "}
                        <strong>{budgetItems.find((b) => b.id === budgetItemId)?.name ?? "this budget line"}</strong>
                      </span>
                    </label>
                  ) : (
                    <p className="txn-assign-hint">Pick a budget line above to assign it.</p>
                  )}
                </div>
              )}
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

/**
 * Views over the ACTIVE ROSTER, plus one for records that are not the current
 * roster's. Counts describe players, never the number of dues records.
 *
 * "Owes balance" and "Not started" deliberately overlap: a player who has paid
 * nothing owes the full amount and belongs in both. Two questions, not a
 * split — and the behaviour before this change, preserved.
 */
const PAYMENT_VIEWS = [
  { key: "all", label: "All" },
  { key: "owes", label: "Owes balance" },
  { key: "none", label: "Not started" },
  { key: "notset", label: "Dues not set" },
  { key: "paid", label: "Paid in full" },
  { key: "former", label: "Former / unlinked" },
];

/**
 * Answers "who still owes?" first.
 *
 * Progress replaces three numeric columns a coach had to compare. Exact
 * amounts and payment history remain in the drawer.
 */
export function PaymentsTab({
  payments,
  filterPlayerIds = null,
  activePlayers = [],
  canWrite,
  onAdd,
  onAddFor,
  onOpen,
  onBulk,
  onEditTeamDues,
  schedules = NO_SCHEDULES,
  today = null,
  onTeamSchedule,
  pending,
  filtered = false,
  filterLabel = null,
  onClearFilter,
}) {
  const [view, setView] = useState("all");
  const [bulkAmount, setBulkAmount] = useState("");

  // The roster is the spine; dues attach to it.
  //
  // ST-010: reconciled from EVERY dues record for the season, then narrowed
  // to the active filter's players. Narrowing happens after states are
  // decided, so a filter can hide a row but never change what it says.
  const full = reconcileDues(activePlayers, payments);
  const { roster, former, counts } = scopeReconciledDues(full, filterPlayerIds);

  // Past due, from the shared rules. Nothing date-based is claimed until the device date is known.
  const standingOf = (rec) => (schedules.available && rec ? standingForRecord(rec, schedules.byPayment[rec.id], today) : null);
  const dueSummary = summarizeDues(roster.map((r) => standingOf(r.record)).filter(Boolean));
  const isPastDue = (r) => standingOf(r.record)?.status === "past-due";

  const countFor = (key) =>
    key === "all" ? counts.all
    : key === "owes" ? counts.owes
    : key === "none" ? counts.notStarted
    : key === "notset" ? counts.notSet
    : key === "paid" ? counts.paid
    : key === "pastdue" ? (today ? roster.filter(isPastDue).length : "…")
    : counts.former + counts.unlinked;

  const visible =
    view === "former"
      ? former
      : roster.filter((r) => {
          if (view === "owes") return r.record && r.record.balance > 0;
          if (view === "pastdue") return today ? isPastDue(r) : false;
          if (view === "none") return r.state === "not-started";
          if (view === "notset") return r.state === "not-set";
          if (view === "paid") return r.state === "paid";
          return true;
        });

  // About the team, not the filter: "no dues set up yet" must not appear just
  // because a filter is showing only players without dues.
  const nothingSetUp =
    full.roster.length > 0 && full.counts.notSet === full.roster.length && full.former.length === 0;

  /**
   * Once dues exist the primary action is no longer setup.
   *
   * A coach who set the wrong amount opened "Set player dues" and was told
   * "0 players" — technically true, since the bulk flow only creates, and
   * useless as an answer. The header now states what IS set and offers the
   * action that matches the situation.
   *
   * Editing is offered only while nothing has been paid: reallocating a total
   * across players when some have already paid produces a number that is no
   * longer the total the coach entered.
   */
  //
  // ST-010: decided from the complete season (every record, the unfiltered
  // reconciliation), never from the rows a filter leaves on screen.
  const header = duesHeaderState(payments, full.counts);
  const { withDuesCount, duesTotal, anyPaid, playersWithoutDues, canBulkEdit } = header;

  return (
    <>
      <div className="tab-head">
        <div className="page-sub">
          {withDuesCount === 0 ? (
            <>Every active player on the roster, and what they owe for this season.</>
          ) : (
            <>
              <strong>{money(duesTotal)}</strong> total ·{" "}
              {withDuesCount} {withDuesCount === 1 ? "player" : "players"}
              {playersWithoutDues > 0 && (
                <> · {playersWithoutDues} without dues set</>
              )}
              {schedules.available && dueSummary.ready && dueSummary.pastDueCount > 0 && (
                <> · <span className="ds-head-owed">{dueSummary.pastDueCount} past due ({money(dueSummary.pastDueCents / 100)})</span></>
              )}
            </>
          )}
        </div>
        {canWrite && (
          <div className="tab-head-actions">
            {/* Setting dues for players who have none stays available whatever
                the payment state — a player added mid-season needs an amount,
                and giving them one changes nobody else's. */}
            {playersWithoutDues > 0 && (
              <button className="btn btn-secondary" onClick={onAdd}>
                Set dues for {playersWithoutDues} {playersWithoutDues === 1 ? "player" : "players"}
              </button>
            )}
            {schedules.available && withDuesCount > 0 && (
              <button className="btn btn-secondary" onClick={onTeamSchedule}>
                {schedules.template ? "Team schedule" : "Set up team schedule"}
              </button>
            )}
            {canBulkEdit && (
              <button className="btn btn-primary" onClick={onEditTeamDues}>
                Edit team dues
              </button>
            )}
            {withDuesCount === 0 && playersWithoutDues === 0 && (
              <button className="btn btn-primary" onClick={onAdd}>Set player dues</button>
            )}
          </div>
        )}
      </div>

      {/* Said once, where the missing action would have been. */}
      {canWrite && withDuesCount > 0 && anyPaid && (
        <p className="field-note dues-locked-note">
          Team dues can no longer be reallocated as a group — payments have been
          recorded. Open a player to adjust their amount individually; their
          payment history is not affected.
        </p>
      )}

      {(roster.length > 0 || former.length > 0) && (
        <div className="segmented pay-views" role="group" aria-label="Filter players">
          {(schedules.available
            ? [...PAYMENT_VIEWS.slice(0, 2), { key: "pastdue", label: "Past due" }, ...PAYMENT_VIEWS.slice(2)]
            : PAYMENT_VIEWS
          ).filter((v) => v.key !== "former" || former.length > 0).map((v) => (
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
        {filtered && visible.length === 0 ? (
          <div className="empty">
            <h3>No players match this filter</h3>
            <p>
              {filterLabel
                ? `No players are ${filterLabel} right now.`
                : "No players match the selected filter."}
            </p>
            {onClearFilter && (
              <button className="btn" onClick={onClearFilter}>Show all players</button>
            )}
          </div>
        ) : roster.length === 0 && former.length === 0 ? (
          <div className="empty">
            <h3>No players on the roster yet</h3>
            <p>Add players to the season roster before setting dues.</p>
          </div>
        ) : nothingSetUp ? (
          <div className="empty">
            <h3>No player dues yet</h3>
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
        ) : view === "former" ? (
          <FormerDuesTable rows={former} onOpen={onOpen} />
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
              {visible.map((r) => {
                /* A player with no obligation is a real roster member, not a
                   missing row. Their dues state is the story of the row. */
                if (r.state === "not-set") {
                  return (
                    <tr key={r.key} className="pay-row-unset">
                      <td className="pay-player">
                        <div className="pay-cell">
                          <span className="cell-name">{r.name}</span>
                          <span className="pay-sub pay-sub-unset">Dues not set</span>
                        </div>
                      </td>
                      <td className="pay-progress">
                        <div className="pay-cell">
                          {canWrite ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-set-dues"
                              onClick={() => onAddFor?.(r.playerId)}
                              disabled={pending}
                            >
                              Set dues
                            </button>
                          ) : (
                            <span className="muted">No amount set</span>
                          )}
                        </div>
                      </td>
                      {/* Genuinely not applicable — no obligation exists, which
                          is different from owing zero. */}
                      <td className="pay-balance"><span className="muted">—</span></td>
                    </tr>
                  );
                }

                const p = r.record;
                const settled = r.state === "paid";
                const nothing = p.totalPaid === 0;

                return (
                  <tr key={r.key} className="row-click" onClick={() => onOpen(p)}>
                    <td className="pay-player">
                      <div className="pay-cell">
                        <span className="cell-name">{r.name}</span>
                        <span className="pay-sub">
                          {settled
                            ? "Paid in full"
                            : nothing
                              ? `Nothing paid of ${money(p.totalDue)}`
                              : `${money(p.totalPaid)} of ${money(p.totalDue)}`}
                        </span>
                        {schedules.available && <DuesStatusChip standing={standingOf(p)} />}
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

                    <td className="pay-balance">
                      {p.balance > 0 ? (
                        <span className="pay-owed">{money(p.balance)}</span>
                      ) : p.balance < 0 ? (
                        <span className="muted">{money(Math.abs(p.balance))} credit</span>
                      ) : (
                        <span className="muted">{money(0)}</span>
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

/**
 * Dues records that are not the current roster's.
 *
 * Kept fully accessible — every balance and the whole payment history opens
 * exactly as before. A former player is named and labelled as a former player;
 * only a record with no player at all is called unlinked.
 */
function FormerDuesTable({ rows, onOpen }) {
  return (
    <>
      <p className="pay-former-note">
        These dues records aren&rsquo;t part of the current active roster. They still count in
        Finance totals and their payment history is unchanged.
      </p>
      <table className="table pay-table">
        <thead>
          <tr>
            <th className="pay-player">Record</th>
            <th className="pay-progress">Payment progress</th>
            <th className="pay-balance">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = r.record;
            const settled = p.totalDue > 0 && p.balance <= 0;
            return (
              <tr key={r.key} className="row-click" onClick={() => onOpen(p)}>
                <td className="pay-player">
                  <div className="pay-cell">
                    <span className="cell-name">
                      {r.name ?? <span className="muted">No player linked</span>}
                    </span>
                    <span className="pay-sub">
                      {r.kind === "former"
                        ? "No longer on the active roster"
                        : r.name
                          ? "Former player — no longer in this organization"
                          : "Not linked to a player"}
                    </span>
                  </div>
                </td>
                <td className="pay-progress">
                  <div className="pay-cell">
                    {settled ? (
                      <span className="pay-settled">Paid in full ✓</span>
                    ) : (
                      <span className="pay-amounts">
                        {money(p.totalPaid)} <span className="muted">of {money(p.totalDue)}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="pay-balance">
                  {p.balance > 0 ? (
                    <span className="pay-owed">{money(p.balance)}</span>
                  ) : (
                    <span className="muted">{money(0)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function PaymentDetail({ p, canWrite, pending, onClose, onRecord, onRecordOpen, onDeleteEntry, onEdit,
                        confirmingEntry = null, onCancelEntry, onConfirmEntry, drawerError = null,
                        schedules = NO_SCHEDULES, today = null, onSchedule }) {
  const standing = schedules.available ? standingForRecord(p, schedules.byPayment[p.id], today) : null;
  const scheduled = standing?.hasSchedule;
  return (
    <DrawerShell onClose={onClose} ariaLabel="Transaction details">
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
          {/* The schedule summary below carries Total dues, Payments credited and Remaining balance,
              so this older block shows only for players without a schedule summary. */}
          {!(standing && standing.hasSchedule) && (
          <div className="cost-box">
            <div className="cost-row"><span>Total due</span><span>{money(p.totalDue)}</span></div>
            <div className="cost-row"><span>Paid</span><span>{money(p.totalPaid)}</span></div>
            <div className="cost-row cost-total"><span>Balance</span><span>{money(p.balance)}</span></div>
          </div>
          )}

          {standing && (
            <ScheduleSection p={p} standing={standing} today={today} canWrite={canWrite} onSchedule={onSchedule} />
          )}

          <section className="detail-section" style={{ marginTop: 22 }}>
            <h3 className="detail-section-title">Payment history <span className="ds-actual">actual payments</span></h3>
            {p.log.length === 0 ? (
              <p className="section-body muted">No payments recorded yet.</p>
            ) : (
              <>
              {/* Asked here, beside the entry list, not in a native dialog. */}
              {confirmingEntry?.startsWith?.("entry:") && (
                <ConfirmAction
                  message={removeEntryMessage(p, confirmingEntry.slice("entry:".length))}
                  confirmLabel="Remove entry"
                  pendingLabel="Removing…"
                  cancelLabel="Keep entry"
                  pending={pending}
                  error={drawerError}
                  onCancel={onCancelEntry}
                  onConfirm={() => onConfirmEntry(confirmingEntry.slice("entry:".length))}
                />
              )}
              <table className="table pay-log">
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
              </>
            )}
          </section>
        </div>

        {canWrite && (
          <div className="drawer-foot">
            {drawerError && <p className="drawer-foot-error" role="alert">{drawerError}</p>}
            {standing ? (
              <button className="btn btn-secondary" onClick={onSchedule} disabled={pending}>
                {scheduled ? "Schedule and total" : "Set schedule"}
              </button>
            ) : null}
            {/* A scheduled player's total changes together with their schedule, in one sheet. */}
            {!scheduled && <button className="btn btn-secondary" onClick={onEdit} disabled={pending}>Edit total due</button>}
            {/* The one volt button: opens the prefilled sheet. The label carries no amount: the
                remaining season balance must not read as the payment that is due now. */}
            {p.balance > 0 && (
              <button type="button" className="btn btn-primary" onClick={onRecordOpen} disabled={pending}>
                Record payment
              </button>
            )}
          </div>
        )}
    </DrawerShell>
  );
}

function PaymentForm({ row, players, presetPlayerId = null, existing, pending, onSubmit, onCancel, onOpenExisting = null, teamEdit = false, prefillTotal = null, formError = null }) {
  const isNew = !row;
  /**
   * ST-010: opened for ONE KNOWN player (the "Set dues" button on their row).
   * The player is fixed — no All/One choice, no picker — and what is offered
   * follows their real dues state from the complete season records.
   */
  const target = isNew && !teamEdit ? presetDuesTarget(presetPlayerId, players, existing) : null;
  // Opened from a specific player's row: go straight to that player rather
  // than defaulting to the bulk action.
  const [scope, setScope] = useState(isNew && presetPlayerId ? "one" : "all");
  // A team edit is by definition every player who has dues. Editing one
  // player's existing obligation is by definition that one player.
  //
  // ST-005 follow-up: an edit used to inherit `scope`'s default of "all",
  // which made the Save button apply the bulk-assignment guard ("no players
  // without dues left") to a single-player edit. Once every player had dues,
  // Save was permanently disabled on Edit total due whatever was typed.
  // Submission already treated an edit as "one"; this makes the button agree.
  const effectiveScope = teamEdit ? "all" : isNew ? scope : "one";
  // Team total is the default because it is how a manager states dues: "the
  // season costs $48,000". Per player is the explicit alternative.
  const [duesMode, setDuesMode] = useState("total");
  // Drives the preview, so a coach sees the arithmetic before saving rather
  // than discovering it in the totals afterwards.
  const [amount, setAmount] = useState(row?.totalDue ?? prefillTotal ?? "");

  const taken = new Set(existing.map((p) => p.player_id));
  // Season fees are owed by players. Coaches and other staff are excluded.
  /**
   * Who the amount applies to.
   *
   * Setting dues acts on players who have NONE — giving one to a player who
   * joined mid-season must not disturb anybody else. Editing team dues acts on
   * everyone who HAS one, because that is what a team total is.
   *
   * ST-005: declared here, ahead of `payers`/`payerIds` below, which read it
   * immediately on the first render. It previously sat after those reads —
   * a `const` is hoisted but stays in the temporal dead zone until its own
   * declaration runs, so every open of this form (Add, Edit Total Due, Edit
   * team dues all render this same component) threw a ReferenceError before
   * anything reached the screen. No behavior changes here, only order.
   */
  const available = teamEdit
    ? players.filter((p) => taken.has(p.id) && (p.person_type ?? "player") === "player")
    : players.filter((p) => !taken.has(p.id) && (p.person_type ?? "player") === "player");

  /**
   * Who owes. Defaults to every eligible player, because that is the common
   * case — but a coach's own child may not be charged, and dividing the team
   * total by a headcount that includes them gives every family the wrong
   * number. Deselected players are recorded as owing no dues, not skipped.
   */
  const [payers, setPayers] = useState(null);
  const payerIds = payers ?? available.map((p) => p.id);
  const selected = available.filter((p) => payerIds.includes(p.id));
  const toggle = (id) =>
    setPayers((cur) => {
      const base = cur ?? available.map((p) => p.id);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });

  /**
   * Built from allocateMoney, the same function setDuesForAll calls. The
   * preview and the saved obligations therefore cannot diverge: if the split
   * is uneven the coach sees the range before committing to it.
   */
  const preview = useMemo(() => {
    const n = selected.length;
    const value = Number(amount);
    if (!n || !Number.isFinite(value) || value < 0 || amount === "") return null;

    const shares = duesMode === "total"
      ? allocateMoney(value, n)
      : Array.from({ length: n }, () => value);

    const totalCents = shares.reduce((sum, v) => sum + cents(v), 0);
    return {
      total: totalCents / 100,
      low: Math.min(...shares),
      high: Math.max(...shares),
      even: Math.min(...shares) === Math.max(...shares),
    };
  }, [amount, duesMode, selected.length]);

  // One rule for whether Save is available, shared with its regression tests.
  const canSave = canSaveDuesForm({
    pending,
    mode: !isNew ? "edit" : effectiveScope === "all" ? "bulk" : "one",
    amount,
    originalAmount: row?.totalDue ?? null,
    selectedCount: selected.length,
  });

  // A rejected save (for example, Total Due below what's already been paid)
  // is reported by the page's error state, which sits behind this modal.
  // Shown here instead, but only once this form has been submitted, so an
  // older unrelated error never appears in a freshly opened form.
  const [submitted, setSubmitted] = useState(false);

  // ST-010: the known player already has dues, or is not an active player this
  // season. Say so and offer the real next step, instead of an empty picker.
  // Hooks above still run on every render, so this return is safe.
  if (target && target.kind !== "set") {
    const name = target.player?.full_name ?? target.record?.player?.full_name ?? target.record?.displayName ?? "This player";
    const r = target.record;
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dues-target-title" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2 id="dues-target-title">{target.kind === "exists" ? `Dues already set for ${name}` : "Dues can't be set here"}</h2>
          </div>
          <div className="modal-body">
            {target.kind === "exists" ? (
              <p className="dues-target-state">
                {name} owes <strong>{money(r.totalDue ?? 0)}</strong> for this season
                {r.exempt
                  ? " and is exempt from dues."
                  : <> and has paid <strong>{money(r.totalPaid ?? 0)}</strong>.</>}{" "}
                Open their dues to view payments or change the amount.
              </p>
            ) : (
              <p>
                {name} isn&rsquo;t an active player on this season&rsquo;s roster, so dues
                can&rsquo;t be set for them here.
              </p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Close</button>
            {target.kind === "exists" && onOpenExisting && (
              <button type="button" className="btn btn-primary" onClick={() => onOpenExisting(r)}>
                View {name}&rsquo;s dues
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  const fixedPlayer = target?.kind === "set" ? target.player : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={(fd) => { setSubmitted(true); onSubmit(fd, isNew ? (fixedPlayer ? "one" : scope) : "one"); }}>
          {row && <input type="hidden" name="id" value={row.id} />}
          {row && <input type="hidden" name="player_id" value={row.player_id ?? ""} />}
          <div className="modal-head">
            <h2>
              {teamEdit ? "Edit team dues"
                : fixedPlayer ? `Set dues for ${fixedPlayer.full_name}`
                : isNew ? "Set player dues"
                : `Edit ${row.player?.full_name}`}
            </h2>
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
            {isNew && !fixedPlayer && (
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

            {/* SET DUES BY. Only for All players — the toggle is meaningless
                for one player, where the amount is simply that player's. */}
            {isNew && effectiveScope === "all" && (
              <div className="field">
                <label>Set dues by</label>
                <div className="segmented" role="group" aria-label="How the amount is applied">
                  <button
                    type="button"
                    className={`segment${duesMode === "total" ? " on" : ""}`}
                    aria-pressed={duesMode === "total"}
                    onClick={() => setDuesMode("total")}
                  >
                    Team total
                  </button>
                  <button
                    type="button"
                    className={`segment${duesMode === "per_player" ? " on" : ""}`}
                    aria-pressed={duesMode === "per_player"}
                    onClick={() => setDuesMode("per_player")}
                  >
                    Amount per player
                  </button>
                </div>
                <input type="hidden" name="dues_mode" value={duesMode} />
              </div>
            )}

            {/* WHO OWES. Checked by default; unchecking records the player as
                owing no dues rather than leaving them looking unfinished. */}
            {isNew && effectiveScope === "all" && available.length > 0 && (
              <div className="field">
                <label>Who owes dues</label>
                <div className="dues-payers">
                  {available.map((p) => (
                    <label key={p.id} className="dues-payer">
                      <input
                        type="checkbox"
                        checked={payerIds.includes(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                      <span>{p.full_name}</span>
                    </label>
                  ))}
                </div>
                <input type="hidden" name="player_ids" value={payerIds.join(",")} />
                {selected.length < available.length && (
                  <p className="field-note">
                    {available.length - selected.length}{" "}
                    {available.length - selected.length === 1 ? "player" : "players"} will be
                    recorded as owing no dues. You can change that later.
                  </p>
                )}
              </div>
            )}

            {isNew && effectiveScope === "all" && (
              <p className="field-note dues-scope-note">
                {available.length === 0 ? (
                  <>
                    {/* THREE STATES, NOT ONE. "Nothing would change" told a
                        coach who had just set the wrong amount that there was
                        nothing to do, which is the opposite of true. This says
                        what is actually blocking and where to go instead. */}
                    Every active player already has dues set, so there is nothing to add
                    here. To change an amount, open a player from the list below —
                    obligations with recorded payments cannot be changed in bulk.
                  </>
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

            {/* The known player: fixed, not re-selected. */}
            {fixedPlayer && <input type="hidden" name="player_id" value={fixedPlayer.id} />}

            {isNew && effectiveScope === "one" && !fixedPlayer && (
              <div className="field">
                <label htmlFor="p-player">Player</label>
                <select id="p-player" name="player_id" required defaultValue={presetPlayerId ?? ""}>
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
              <label htmlFor="p-cost">
                {!isNew || effectiveScope === "one"
                  ? "Player dues for the season"
                  : duesMode === "total"
                    ? "Total team dues"
                    : "Amount each player owes"}
              </label>
              <div className="input-money">
                <span aria-hidden="true">$</span>
                <input id="p-cost" name="initial_cost" type="number" min="0" step="0.01" required
                       inputMode="decimal" placeholder="0"
                       value={amount}
                       onChange={(e) => setAmount(e.target.value)} />
              </div>

              {teamEdit && (
                <p className="field-note dues-edit-note">
                  This replaces the amount owed by{" "}
                  <strong>{available.length}</strong>{" "}
                  {available.length === 1 ? "player" : "players"} who already have dues.
                  Payments already recorded are not affected.
                </p>
              )}

              {/* THE PREVIEW IS COMPUTED BY THE SAME FUNCTION THE SERVER USES.
                  A preview with its own arithmetic is a second source of truth
                  and will eventually disagree with what is saved. */}
              {isNew && effectiveScope === "all" && selected.length > 0 && preview && (
                <p className="field-note dues-preview">
                  <strong>{selected.length}</strong>{" "}
                  {selected.length === 1 ? "player" : "players"} ·{" "}
                  {duesMode === "total" ? (
                    <>
                      <strong>{money(preview.total)}</strong> total ·{" "}
                      {preview.even
                        ? <>{money(preview.low)} each</>
                        : <>{money(preview.low)}–{money(preview.high)} each</>}
                    </>
                  ) : (
                    <>
                      <strong>{money(preview.low)}</strong> each ·{" "}
                      {money(preview.total)} total
                    </>
                  )}
                </p>
              )}
            </div>
            {submitted && formError && !pending && (
              <p className="drawer-foot-error" role="alert">{formError}</p>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              {pending
                ? "Saving…"
                : !isNew
                  ? "Save changes"
                  : effectiveScope === "all"
                    ? `Set dues for ${selected.length} ${selected.length === 1 ? "player" : "players"}`
                    : fixedPlayer
                      ? "Set dues"
                      : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


/**
 * The single most useful next step, from data already on the page.
 *
 *   1 the largest outstanding dues balance, recorded in place
 *   2 otherwise, the next thing to set up or record
 *
 * A committed tournament without a budget line is no longer a task: it counts
 * toward Available on its own and linking a line is optional.
 */
function NextAction({ payments, canWrite, seasonPhase, hasBudget, onRecord, onAddTxn, onBudget }) {
  let lab = "Next", txt, sub, btn = null;
  const owing = (payments ?? []).filter((p) => !p.exempt && p.balance > 0).sort((a, b) => b.balance - a.balance);
  if (seasonPhase === "past") {
    lab = "Past season"; txt = "Nothing to act on"; sub = "Figures are kept as they were recorded.";
  } else if (owing.length > 0) {
    const p = owing[0];
    txt = `Collect ${money(p.balance)} from ${p.displayName}`;
    sub = p.totalPaid > 0 ? `Paid ${money(p.totalPaid)} of ${money(p.totalDue)} so far` : "Nothing paid yet";
    if (canWrite) btn = <button type="button" className="btn btn-primary" onClick={() => onRecord(p)}>Record payment</button>;
  } else if (!hasBudget) {
    lab = "Start here"; txt = "Set up your season budget"; sub = "Everything else in Finance builds on it.";
    btn = <button type="button" className="btn btn-primary" onClick={onBudget}>Open Budget</button>;
  } else {
    lab = "All caught up"; txt = "Nothing needs attention"; sub = "Record spending as it happens.";
    if (canWrite) btn = <button type="button" className="btn btn-primary" onClick={onAddTxn}>Add transaction</button>;
  }
  return (
    <section className="st-nextact" aria-label="Next action">
      <span className="st-eyebrow">{lab}</span>
      <p>{txt}</p>
      <span className="st-nextact-sub">{sub}</span>
      {btn && <div className="st-nextact-acts">{btn}</div>}
    </section>
  );
}
