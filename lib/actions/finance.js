"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { sumMoney, money as moneyText, allocateMoney, cents } from "../finance-rules";
import { isBlockedIncomeCategory } from "../finance-rules";

/**
 * Finance writes.
 *
 * budget_items.actual is never written — actual spend derives from linked
 * transactions. budget_transactions.budgeted_amount is never written either;
 * budget planning lives in budget_items.
 */

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function money(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  // Coaches paste straight from a spreadsheet: "$1,200.00" must not become
  // null. Strips currency symbols, thousands separators and spaces.
  const cleaned = s.replace(/[$£€,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Rounds to cents so 16 × 119.99 never stores a floating-point tail. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to Finance.");
  return ctx;
}

/* ---------------- Budget lines ---------------- */

function budgetFields(formData) {
  const byQuantity = formData.get("budget_method") === "quantity";
  const quantity = money(formData.get("quantity"));
  const unitCost = money(formData.get("unit_cost"));

  return {
    category: text(formData.get("category")),
    name: text(formData.get("name")),

    // budgeted is always the stored planned total. In quantity mode it is
    // calculated here; every downstream calculation reads this one number.
    budgeted: byQuantity
      ? round2((quantity ?? 0) * (unitCost ?? 0))
      : money(formData.get("budgeted")) ?? 0,

    // Nulled on the lump-sum path so a total-amount line never keeps
    // arithmetic that disagrees with its total.
    quantity: byQuantity ? quantity : null,
    unit_cost: byQuantity ? unitCost : null,

    is_income: formData.get("is_income") === "true",
    notes: text(formData.get("notes")),
  };
}

export async function saveBudgetItem(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const fields = budgetFields(formData);
    if (!fields.category) return { ok: false, error: "Pick a category." };
    if (!fields.name) return { ok: false, error: "Enter a name for this budget line." };

    if (fields.is_income && isBlockedIncomeCategory(fields.category)) {
      return {
        ok: false,
        error: "Player dues come from the Player Dues tab. Use a different category for this budget line.",
      };
    }

    const id = formData.get("id");
    const { data: saved, error } = id
      ? await supabase
          .from("budget_items")
          .update(fields)
          .eq("id", id)
          .select("id, category, name, budgeted, is_income")
          .single()
      : await supabase
          .from("budget_items")
          .insert({
            ...fields,
            organization_id: ctx.organization.id,
            season_id: ctx.season.id,
          })
          .select("id, category, name, budgeted, is_income")
          .single();

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");

    /**
     * A BUDGET LINE IS A PLAN, NOT A CHARGE.
     *
     * A coach who adds "$48,000 Player Dues" to the budget has said what they
     * expect to collect. No family has been charged anything — obligations
     * live in player_payments and are created separately. Saying so at the
     * moment of creation stops the two being confused, which is how $48,000 in
     * the budget and $672,000 in obligations sat side by side without either
     * looking wrong.
     *
     * Deliberately NOT auto-creating obligations and NOT syncing the two
     * afterwards: a budget figure is an estimate that moves, and dues are a
     * commitment to a family.
     */
    const isDuesLine = !id && !fields.is_income && /(^|\W)dues(\W|$)/i.test(fields.name ?? "");

    // Returned so a line created from inside the transaction flow can be
    // selected immediately — the create-and-link rule.
    return {
      ok: true,
      item: saved,
      duesBudget: isDuesLine ? { amount: saved?.budgeted ?? null } : null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Removes a budget line.
 *
 * The foreign key is ON DELETE SET NULL, so deleting a line with transactions
 * would silently orphan them — and an orphaned transaction still counts in the
 * Finance summary while disappearing from every category total, making the two
 * views disagree with nothing to explain it.
 *
 * A caller can pass move_to to reassign them first.
 *
 * ST-007: tournaments allocated to the line are checked the same way, ahead
 * of transactions — also ON DELETE SET NULL, also silent otherwise. Unlike
 * transactions there's no move_to for tournaments: which budget line a
 * tournament counts against is changed on the tournament record itself, so
 * this always refuses rather than offering to reassign.
 */
export async function deleteBudgetItem(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    /**
     * ST-007: a tournament allocated to this line has no row in
     * budget_transactions until something is actually paid toward it, so the
     * check below never saw it — the FK (ON DELETE SET NULL) then cleared
     * the tournament's budget_item_id silently and its committed cost
     * dropped out of Finance with no record anywhere that it happened.
     * Checked first, and never auto-resolved: unlike a transaction, a
     * tournament's budget line is changed on the tournament itself.
     */
    const { data: linkedTournaments } = await supabase
      .from("tournaments")
      .select("id, name")
      .eq("budget_item_id", id);

    const tournamentCount = (linkedTournaments ?? []).length;
    if (tournamentCount > 0) {
      return {
        ok: false,
        tournamentBlockers: linkedTournaments,
        error: `${tournamentCount} ${tournamentCount === 1 ? "tournament is" : "tournaments are"} allocated to this budget line. Change ${tournamentCount === 1 ? "its" : "their"} budget line from the Tournaments page before deleting it.`,
      };
    }

    const { data: linked } = await supabase
      .from("budget_transactions")
      .select("id, is_income")
      .eq("budget_item_id", id);

    const count = (linked ?? []).length;

    if (count > 0) {
      const moveTo = text(formData.get("move_to"));

      if (!moveTo) {
        return {
          ok: false,
          needsReassign: true,
          count,
          error: `${count} ${count === 1 ? "transaction is" : "transactions are"} filed against this budget line. Move them to another line first.`,
        };
      }

      // The destination must exist and match income/expense, or the moved
      // transactions would land somewhere they can never reconcile.
      const { data: target } = await supabase
        .from("budget_items")
        .select("id, is_income")
        .eq("id", moveTo)
        .maybeSingle();

      if (!target) return { ok: false, error: "Pick a budget line to move them to." };

      const mismatched = (linked ?? []).some((t) => Boolean(t.is_income) !== Boolean(target.is_income));
      if (mismatched) {
        return {
          ok: false,
          error: "Those transactions don't match that budget line. Expenses go to expense lines and income to income lines.",
        };
      }

      const { error: moveError } = await supabase
        .from("budget_transactions")
        .update({ budget_item_id: moveTo })
        .eq("budget_item_id", id);

      if (moveError) return { ok: false, error: moveError.message };
    }

    const { error } = await supabase.from("budget_items").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- Transactions ---------------- */

export async function saveTransaction(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const budgetItemId = text(formData.get("budget_item_id"));

    if (!budgetItemId) {
      return {
        ok: false,
        error: "Pick a budget line so this shows up in the right category.",
      };
    }

    // The linked budget item is authoritative for category and income flag,
    // which is what keeps the Budget view and the Finance summary in step.
    const { data: item } = await supabase
      .from("budget_items")
      .select("category, is_income, season_id")
      .eq("id", budgetItemId)
      .maybeSingle();

    if (!item) {
      return { ok: false, error: "That budget line no longer exists. Pick another." };
    }

    if (item.season_id !== ctx.season.id) {
      return { ok: false, error: "That budget line belongs to a different season." };
    }

    const category = item.category;
    const isIncome = item.is_income;

    // Player dues already derive from Player Payments. Recording them here as
    // well would double-count every payment.
    if (isIncome && isBlockedIncomeCategory(category)) {
      return {
        ok: false,
        error: "Player dues are recorded under Player Dues and appear in Money In automatically. Don't enter them as a transaction.",
      };
    }

    const fields = {
      budget_item_id: budgetItemId,
      category,
      is_income: isIncome,
      txn_date: text(formData.get("txn_date")),
      vendor: text(formData.get("vendor")),
      item: text(formData.get("item")),
      quantity: money(formData.get("quantity")),
      actual_amount: money(formData.get("actual_amount")),
      status: text(formData.get("status")) ?? "Planned",
      tournament_id: text(formData.get("tournament_id")),
      player_id: text(formData.get("player_id")),
      facility_id: text(formData.get("facility_id")),
      notes: text(formData.get("notes")),
    };

    if (!fields.item) return { ok: false, error: "Enter a description." };
    if (!fields.txn_date) return { ok: false, error: "Enter a date." };

    const id = formData.get("id");
    const { error } = id
      ? await supabase.from("budget_transactions").update(fields).eq("id", id)
      : await supabase.from("budget_transactions").insert({
          ...fields,
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
        });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteTransaction(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("budget_transactions").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- Player payments ---------------- */

export async function savePlayerPayment(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const playerId = text(formData.get("player_id"));
    const cost = money(formData.get("initial_cost"));
    if (!playerId) return { ok: false, error: "Pick a player." };
    if (cost == null) return { ok: false, error: "Enter the total due." };

    // Dues belong to players on this season's roster. Pickups who were never
    // rostered are excluded — they don't owe season fees.
    const { data: rostered } = await supabase
      .from("team_season_players")
      .select("player_id")
      .eq("season_id", ctx.season.id)
      .eq("player_id", playerId)
      .maybeSingle();

    if (!rostered) {
      return {
        ok: false,
        error: "That player isn't on this season's roster. Add them to the roster first.",
      };
    }

    /**
     * Exemption is set and cleared here, one player at a time, and is
     * reversible: clearing it and giving an amount puts the player back among
     * those who owe. The CHECK constraint requires 0 alongside exempt, so the
     * amount is forced rather than trusted.
     */
    const exempt = text(formData.get("exempt")) === "true";
    const amount = exempt ? 0 : cost;

    const id = formData.get("id");

    /**
     * ST-005: Total Due is the obligation, not the payment history — but it
     * can never legitimately fall below what's already been recorded against
     * it. Enforced here, not just in the UI, because this action is the only
     * path that writes initial_cost. Checked before either branch below, so
     * a rejected edit never touches the row. Exemption forces the amount to
     * 0 above, so it hits the same floor: a player can't be marked exempt
     * out from under money they've already paid.
     */
    if (id) {
      const { data: paidRows, error: paidError } = await supabase
        .from("payment_log")
        .select("amount")
        .eq("payment_id", id);

      if (paidError) return { ok: false, error: paidError.message };

      const alreadyPaid = sumMoney((paidRows ?? []).map((p) => p.amount ?? 0));
      if (amount < alreadyPaid) {
        return {
          ok: false,
          error: exempt
            ? `Can't mark this player exempt — ${moneyText(alreadyPaid)} is already recorded as paid. Adjust or remove those payments first if that's not correct.`
            : `Total due can't be less than the ${moneyText(alreadyPaid)} already paid. Enter ${moneyText(alreadyPaid)} or more, or correct the payment history first.`,
        };
      }
    }

    // player_name is legacy and deliberately left null.
    const { error } = id
      ? await supabase.from("player_payments")
          .update({ initial_cost: amount, exempt })
          .eq("id", id)
      : await supabase.from("player_payments").insert({
          player_id: playerId,
          initial_cost: amount,
          exempt,
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
        });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Records money received against an existing dues obligation.
 *
 * Deliberately refuses when no obligation exists. Creating a zero-dollar
 * obligation to make the payment fit would leave the player owing nothing
 * while having paid something — an inconsistency nobody would spot.
 */
export async function recordPayment(formData) {
  try {
    await guard();
    const supabase = createClient();

    const paymentId = text(formData.get("payment_id"));
    const amount = money(formData.get("amount"));
    if (!paymentId) {
      return { ok: false, error: "Set what this player owes before recording a payment." };
    }
    if (amount == null || amount <= 0) return { ok: false, error: "Enter an amount." };

    // The obligation must exist and belong to the season being viewed.
    const { data: obligation } = await supabase
      .from("player_payments")
      .select("id, season_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (!obligation) {
      return { ok: false, error: "Set what this player owes before recording a payment." };
    }

    const { error } = await supabase.from("payment_log").insert({
      payment_id: paymentId,
      amount,
      paid_date: text(formData.get("paid_date")),
      month_label: text(formData.get("month_label")),
    });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deletePaymentEntry(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { error } = await supabase.from("payment_log").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


/**
 * Sets one dues amount across the active roster.
 *
 * Skips anyone who already has a dues row rather than overwriting: a
 * negotiated or part-paid amount must not be silently replaced by a bulk
 * action. Individual edits still work exactly as before.
 *
 * Staff are excluded — team_season_players includes coaches, and charging an
 * assistant coach season dues would be a memorable bug.
 */
/**
 * Who a bulk dues change would actually affect.
 *
 * Drives the preview. Showing "15 x $4,000 = $60,000" when only 3 players are
 * receiving dues would overstate what is about to happen by four times.
 */
export async function duesPreview() {
  try {
    const ctx = await requireSeasonContext();
    const supabase = createClient();

    const [{ data: roster }, { data: existing }] = await Promise.all([
      supabase
        .from("team_season_players")
        .select("player_id, is_active, player:players ( id, full_name, person_type )")
        .eq("season_id", ctx.season.id),
      supabase
        .from("player_payments")
        .select("player_id, initial_cost")
        .eq("season_id", ctx.season.id),
    ]);

    const dues = new Map((existing ?? []).map((p) => [p.player_id, Number(p.initial_cost ?? 0)]));

    const eligible = (roster ?? [])
      .filter((r) => r.is_active && r.player?.person_type === "player" && r.player?.id)
      .map((r) => ({
        playerId: r.player_id,
        name: r.player.full_name,
        currentDues: dues.has(r.player_id) ? dues.get(r.player_id) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      ok: true,
      players: eligible,
      withDues: eligible.filter((p) => p.currentDues != null).length,
      withoutDues: eligible.filter((p) => p.currentDues == null).length,
      existingTotal: eligible.reduce((s, p) => s + (p.currentDues ?? 0), 0),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function setDuesForAll(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    /**
     * TWO MODES, AND THE FIELD SAYS WHICH.
     *
     * This action always wrote the entered amount to every player, while the
     * form labelled the field "Total due for the season". A coach entering
     * $48,000 for a 14-player team got 14 obligations of $48,000 and a season
     * total of $672,000 — fourteen times what they meant.
     *
     * The server no longer infers. 'total' divides in integer cents;
     * 'per_player' writes the amount to each. An unknown value is treated as a
     * team total, because that is what the field said when the damage was done
     * and it is the safer of the two: it under-charges rather than multiplying.
     */
    const mode = text(formData.get("dues_mode")) === "per_player" ? "per_player" : "total";
    const entered = money(formData.get("initial_cost"));
    if (entered == null || entered < 0) {
      return {
        ok: false,
        error: mode === "per_player"
          ? "Enter the amount each player owes."
          : "Enter the total the team owes for the season.",
      };
    }

    const { data: roster, error: rosterError } = await supabase
      .from("team_season_players")
      .select("player_id, is_active, player:players ( id, person_type )")
      .eq("season_id", ctx.season.id);

    if (rosterError) return { ok: false, error: rosterError.message };

    /**
     * WHO ACTUALLY OWES.
     *
     * A team total is not "everyone on the roster divided by headcount". A
     * coach's own child may not be charged, and dividing $48,000 across 14
     * when only 12 pay gives every family the wrong number.
     *
     * player_ids is the coach's selection. Active players NOT selected are
     * recorded as exempt rather than skipped, so they read as "No dues" rather
     * than as an oversight nobody got round to.
     */
    const chosen = (formData.get("player_ids") ?? "").toString().trim();
    const only = chosen ? new Set(chosen.split(",").filter(Boolean)) : null;

    const activePlayers = (roster ?? []).filter(
      (r) => r.is_active && r.player?.person_type === "player" && r.player?.id
    );

    const eligible = activePlayers.filter((r) => !only || only.has(r.player_id));
    // Selected out: charged nothing, on purpose.
    const excused = only ? activePlayers.filter((r) => !only.has(r.player_id)) : [];

    if (eligible.length === 0) {
      return { ok: false, error: "There are no active players on this roster yet." };
    }

    const { data: existing } = await supabase
      .from("player_payments")
      .select("player_id")
      .eq("season_id", ctx.season.id);

    const already = new Set((existing ?? []).map((r) => r.player_id));
    const toCreate = eligible.filter((r) => !already.has(r.player_id));

    if (toCreate.length === 0) {
      return { ok: false, error: "Every active player already has dues set." };
    }

    /**
     * Sorted by player_id before allocating, so the coach who pays the extra
     * penny is the same one on a retry. Database return order is not stable
     * and would shuffle the remainder between runs.
     */
    const ordered = [...toCreate].sort((a, b) =>
      String(a.player_id).localeCompare(String(b.player_id))
    );

    const shares = mode === "per_player"
      ? ordered.map(() => entered)
      : allocateMoney(entered, ordered.length);

    // The guarantee, checked rather than assumed: what the coach typed is what
    // the obligations add up to.
    if (mode === "total") {
      const allocated = shares.reduce((sum, v) => sum + cents(v), 0);
      if (allocated !== cents(entered)) {
        return {
          ok: false,
          error: "That total could not be split evenly. Nothing was saved.",
        };
      }
    }

    const { error } = await supabase.from("player_payments").insert([
      ...ordered.map((r, i) => ({
        organization_id: ctx.organization.id,
        season_id: ctx.season.id,
        player_id: r.player_id,
        initial_cost: shares[i],
        exempt: false,
      })),
      // A stated decision, not an absent record. initial_cost must be 0: the
      // CHECK constraint refuses an exempt row carrying an amount.
      ...excused
        .filter((r) => !already.has(r.player_id))
        .map((r) => ({
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
          player_id: r.player_id,
          initial_cost: 0,
          exempt: true,
        })),
    ]);

    if (error) return { ok: false, error: error.message };

    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return {
      ok: true,
      created: ordered.length,
      skipped: eligible.length - ordered.length,
      mode,
      total: mode === "total" ? entered : entered * ordered.length,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


/**
 * Removes a dues obligation.
 *
 * Refuses when payments have been recorded against it. The database enforces
 * this too, but a coach deserves the reason rather than a constraint error:
 * money a family actually handed over is history, not a detail of a container
 * record.
 */
/**
 * Reallocates dues across players who already have them.
 *
 * setDuesForAll only ever CREATES, which is right for initial setup and left a
 * coach who had just set the wrong amount with no way back: every player
 * already had an obligation, so nothing was eligible and the dialog said "Set
 * dues for 0 players". Correcting a 14-player team meant fourteen individual
 * edits.
 *
 * THE RULE: bulk editing is allowed only while NONE of the affected
 * obligations has a payment against it.
 *
 * Not a technical limit — a meaning one. Reallocating a team total across
 * players when some have already paid produces a number that is no longer the
 * total the coach entered: either the paid players keep their old amount and
 * the sum is wrong, or their amount moves underneath money already handed
 * over. Both are worse than refusing. Once collection has begun, individual
 * adjustment is the honest path, and it stays available.
 */
export async function editDuesForAll(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const mode = text(formData.get("dues_mode")) === "per_player" ? "per_player" : "total";
    const entered = money(formData.get("initial_cost"));
    if (entered == null || entered < 0) {
      return {
        ok: false,
        error: mode === "per_player"
          ? "Enter the amount each player owes."
          : "Enter the total the team owes for the season.",
      };
    }

    // Existing obligations for this season, with the payments recorded against
    // them. RLS scopes both.
    const { data: obligations, error: readErr } = await supabase
      .from("player_payments")
      .select("id, player_id, initial_cost, exempt, log:payment_log ( id ), player:players ( full_name )")
      .eq("season_id", ctx.season.id);

    if (readErr) return { ok: false, error: readErr.message };

    const rows = obligations ?? [];
    if (rows.length === 0) {
      return { ok: false, error: "No dues have been set for this season yet." };
    }

    // REFUSE WHOLE, NOT IN PART. A bulk action that updated the unpaid players
    // and skipped the rest would leave a team total that means nothing, and
    // the coach would have no way to see which half moved.
    const paid = rows.filter((r) => (r.log ?? []).length > 0);
    if (paid.length > 0) {
      const names = paid
        .map((r) => r.player?.full_name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return {
        ok: false,
        hasPayments: true,
        paidCount: paid.length,
        paidNames: names,
        error:
          `${paid.length} ${paid.length === 1 ? "player has" : "players have"} already paid toward their dues, ` +
          "so the team total can no longer be reallocated. Adjust those players individually instead.",
      };
    }

    /**
     * Exempt players take no share.
     *
     * They are deliberately not charged, so including them would divide the
     * team total by a larger number and undercharge everyone who does pay.
     * Their rows are left exactly as they are.
     */
    const payers = rows.filter((r) => !r.exempt);
    if (payers.length === 0) {
      return { ok: false, error: "Every player on this roster is marked as owing no dues." };
    }

    // Same stable ordering as initial setup, so a total split now matches a
    // total split then.
    const ordered = [...payers].sort((a, b) =>
      String(a.player_id).localeCompare(String(b.player_id))
    );

    const shares = mode === "per_player"
      ? ordered.map(() => entered)
      : allocateMoney(entered, ordered.length);

    if (mode === "total") {
      const allocated = shares.reduce((sum, v) => sum + cents(v), 0);
      if (allocated !== cents(entered)) {
        return { ok: false, error: "That total could not be split evenly. Nothing was saved." };
      }
    }

    // One statement per obligation. Supabase has no multi-row update by id, and
    // an upsert would risk inserting a row whose player is no longer rostered.
    for (let i = 0; i < ordered.length; i += 1) {
      const { error } = await supabase
        .from("player_payments")
        .update({ initial_cost: shares[i] })
        .eq("id", ordered[i].id)
        .eq("season_id", ctx.season.id);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return {
      ok: true,
      updated: ordered.length,
      mode,
      total: mode === "total" ? entered : entered * ordered.length,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deletePlayerPayment(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = text(formData.get("id"));
    if (!id) return { ok: false, error: "Missing record reference." };

    const { data: logged } = await supabase
      .from("payment_log")
      .select("amount")
      .eq("payment_id", id);

    const recorded = sumMoney((logged ?? []).map((l) => l.amount));

    if ((logged ?? []).length > 0) {
      return {
        ok: false,
        error: `This dues obligation has ${moneyText(recorded)} of recorded payments and can't be deleted. Adjust the obligation instead.`,
      };
    }

    const { error } = await supabase.from("player_payments").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
