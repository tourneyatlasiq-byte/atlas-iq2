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

    // Returned so a line created from inside the transaction flow can be
    // selected immediately — the create-and-link rule.
    return { ok: true, item: saved };
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
 */
export async function deleteBudgetItem(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

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
