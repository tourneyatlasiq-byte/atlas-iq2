"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
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
        error: "Player dues come from Player Payments. Use a different category for this budget line.",
      };
    }

    const id = formData.get("id");
    const { error } = id
      ? await supabase.from("budget_items").update(fields).eq("id", id)
      : await supabase.from("budget_items").insert({
          ...fields,
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
        });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function deleteBudgetItem(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { count } = await supabase
      .from("budget_transactions")
      .select("id", { count: "exact", head: true })
      .eq("budget_item_id", id);

    if (count && count > 0) {
      return {
        ok: false,
        error: `${count} transaction${count === 1 ? " is" : "s are"} linked to this budget line. Unlink or delete them first.`,
      };
    }

    const { error } = await supabase.from("budget_items").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
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
    let category = text(formData.get("category"));
    let isIncome = formData.get("is_income") === "true";

    // A linked budget item is authoritative for category and income flag.
    if (budgetItemId) {
      const { data: item } = await supabase
        .from("budget_items")
        .select("category, is_income")
        .eq("id", budgetItemId)
        .single();
      if (item) {
        category = item.category;
        isIncome = item.is_income;
      }
    }

    if (!category) return { ok: false, error: "Pick a budget line or a category." };

    // Player dues already derive from Player Payments. Recording them here as
    // well would double-count every payment.
    if (isIncome && isBlockedIncomeCategory(category)) {
      return {
        ok: false,
        error: "Player dues are recorded in Player Payments and appear in Funds In automatically. Don't enter them as a transaction.",
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

    const id = formData.get("id");
    // player_name is legacy and deliberately left null.
    const { error } = id
      ? await supabase.from("player_payments").update({ initial_cost: cost }).eq("id", id)
      : await supabase.from("player_payments").insert({
          player_id: playerId,
          initial_cost: cost,
          organization_id: ctx.organization.id,
          season_id: ctx.season.id,
        });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function recordPayment(formData) {
  try {
    await guard();
    const supabase = createClient();

    const paymentId = text(formData.get("payment_id"));
    const amount = money(formData.get("amount"));
    if (!paymentId) return { ok: false, error: "Missing record reference." };
    if (amount == null || amount <= 0) return { ok: false, error: "Enter an amount." };

    const { error } = await supabase.from("payment_log").insert({
      payment_id: paymentId,
      amount,
      paid_date: text(formData.get("paid_date")),
      month_label: text(formData.get("month_label")),
    });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/finance");
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
export async function setDuesForAll(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const cost = money(formData.get("initial_cost"));
    if (cost == null || cost < 0) {
      return { ok: false, error: "Enter the amount each player owes." };
    }

    const { data: roster, error: rosterError } = await supabase
      .from("team_season_players")
      .select("player_id, is_active, player:players ( id, person_type )")
      .eq("season_id", ctx.season.id);

    if (rosterError) return { ok: false, error: rosterError.message };

    const eligible = (roster ?? []).filter(
      (r) => r.is_active && r.player?.person_type === "player" && r.player?.id
    );

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

    const { error } = await supabase.from("player_payments").insert(
      toCreate.map((r) => ({
        organization_id: ctx.organization.id,
        season_id: ctx.season.id,
        player_id: r.player_id,
        initial_cost: cost,
      }))
    );

    if (error) return { ok: false, error: error.message };

    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, created: toCreate.length, skipped: eligible.length - toCreate.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
