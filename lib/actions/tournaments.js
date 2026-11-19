"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "../supabase/server";
import { requireSeasonContext, canWrite } from "../context";
import { isValidDecision, isValidPaidStatus } from "../tournament-status";

/**
 * Tournament writes. Same pattern proven in the Team slice: resolve context,
 * write under the caller's RLS context, revalidate so a hard refresh shows
 * the saved state.
 *
 * total_cost is a generated column (entry_fee + gate_fee) and is never written.
 */

function text(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

function int(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

function tri(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  return s === "true";
}

function money(v) {
  const s = (v ?? "").toString().trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function guard() {
  const ctx = await requireSeasonContext();
  if (!canWrite(ctx.profile)) throw new Error("Your role doesn't allow changes to tournaments.");
  return ctx;
}

/**
 * ST-007: total_cost is `entry_fee + gate_fee`, GENERATED ALWAYS AS STORED —
 * plain SQL addition, so NULL in either input makes the stored total NULL
 * rather than the other fee's value. A coach who prices an entry fee and
 * leaves gate fee blank (the common case — most tournaments have no gate
 * fee) was silently zeroing out that tournament everywhere Finance reads
 * total_cost, with nothing on screen to say so.
 *
 * The generated column's expression can't be altered in place in Postgres
 * (it would need to be dropped and re-added), so the fix is made null-safe
 * here instead, at the single place both fees are written: once either fee
 * is actually being priced, the other is treated as 0, not left blank. A
 * tournament where NEITHER fee has been entered yet is left with both null —
 * "not priced yet" stays a real, distinct state from "$0" and total_cost
 * correctly stays null for it.
 */
function feesFrom(formData) {
  const entry_fee = money(formData.get("entry_fee"));
  const gate_fee = money(formData.get("gate_fee"));
  if (entry_fee == null && gate_fee == null) return { entry_fee: null, gate_fee: null };
  return { entry_fee: entry_fee ?? 0, gate_fee: gate_fee ?? 0 };
}

function fieldsFrom(formData) {
  return {
    name: text(formData.get("name")),
    tournament_provider_id: text(formData.get("tournament_provider_id")),
    facility_id: text(formData.get("facility_id")),
    start_date: text(formData.get("start_date")),
    end_date: text(formData.get("end_date")),
    location: text(formData.get("location")),
    ...feesFrom(formData),
    travel_type: text(formData.get("travel_type")),
    decision: text(formData.get("decision")) ?? "Considering",
    paid_status: text(formData.get("paid_status")) ?? "Not Registered",
    placement: text(formData.get("placement")),
    event_url: text(formData.get("event_url")),
    notes: text(formData.get("notes")),
    age_division: text(formData.get("age_division")),
    tournament_type: text(formData.get("tournament_type")),
    guaranteed_games: int(formData.get("guaranteed_games")),
    registration_deadline: text(formData.get("registration_deadline")),
    would_play_again: tri(formData.get("would_play_again")),
    overall_rating: int(formData.get("overall_rating")),
    history_notes: text(formData.get("history_notes")),
  };
}

/** Capture an option quickly. Only name and start date are required. */
export async function addTournament(formData) {
  try {
    const ctx = await guard();
    const supabase = createClient();

    const fields = fieldsFrom(formData);
    if (!fields.name) return { ok: false, error: "Enter a tournament name." };
    if (!fields.start_date) return { ok: false, error: "Enter a start date." };

    const { data: created, error } = await supabase
      .from("tournaments")
      .insert({
        ...fields,
        organization_id: ctx.organization.id,
        season_id: ctx.season.id,
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, id: created?.id ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function updateTournament(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const fields = fieldsFrom(formData);
    if (!fields.name) return { ok: false, error: "Enter a tournament name." };
    if (!fields.start_date) return { ok: false, error: "Enter a start date." };

    const { error } = await supabase.from("tournaments").update(fields).eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Fast inline status change — the action a coach takes most often, so it
 * doesn't cost a modal. Used for both decision and payment status.
 *
 * Returns the previous value so the screen can offer Undo. An optional
 * `expected` field makes the change a compare-and-set: it only applies while
 * the field still holds that value. Undo uses it (expected = the value Undo is
 * reversing), so Undo can never overwrite a change made after the original.
 */
export async function setTournamentStatus(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = formData.get("id");
    const field = formData.get("field");
    const value = text(formData.get("value"));
    const hasExpected = formData.has("expected");
    const expected = text(formData.get("expected"));

    if (!id) return { ok: false, error: "Missing record reference." };
    if (field !== "decision" && field !== "paid_status") {
      return { ok: false, error: "That field can't be changed this way." };
    }
    const valid = field === "decision" ? isValidDecision(value) : isValidPaidStatus(value);
    if (!valid) return { ok: false, error: "That isn't a valid status." };

    const { data: before, error: readError } = await supabase
      .from("tournaments")
      .select(field)
      .eq("id", id)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };
    if (!before) return { ok: false, error: "That tournament could not be found." };
    const previous = before[field] ?? null;

    let query = supabase.from("tournaments").update({ [field]: value }).eq("id", id);
    if (hasExpected) {
      query = expected === null ? query.is(field, null) : query.eq(field, expected);
    }
    const { data: changed, error } = await query.select("id");
    if (error) return { ok: false, error: error.message };

    if (!changed || changed.length === 0) {
      return {
        ok: false,
        code: "changed",
        current: previous,
        error: "This changed after you made the update, so it was left as it is.",
      };
    }

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, previous };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Mark a tournament paid in full, optionally recording the payment in Finance,
 * as ONE database transaction (public.mark_tournament_paid_in_full).
 *
 * The caller sends what the dialog showed (status, paid so far, number of
 * unpaid entries). If the live figures differ the database saves nothing and
 * returns the new ones, so a stale dialog can never record the wrong amount.
 * `request_key` (a uuid made once per dialog) makes a double tap or retry
 * return the first result instead of recording twice.
 */
function expectedToPay(raw) {
  if (raw == null || raw === "") return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function markTournamentPaidInFull(formData) {
  try {
    await guard();
    const supabase = createClient();

    const id = text(formData.get("id"));
    const requestKey = text(formData.get("request_key"));
    if (!id) return { ok: false, error: "Missing record reference." };
    if (!requestKey) return { ok: false, error: "Missing request key." };

    const num = (v) => {
      const s = (v ?? "").toString().trim();
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    const { data, error } = await supabase.rpc("mark_tournament_paid_in_full", {
      p_tournament_id: id,
      p_request_key: requestKey,
      p_expected_status: text(formData.get("expected_status")),
      p_expected_paid: num(formData.get("expected_paid")) ?? 0,
      p_expected_to_pay_count: int(formData.get("expected_to_pay_count")) ?? 0,
      // What the dialog showed: the cost, and each unpaid entry with its amount, date and budget line.
      p_expected_cost: num(formData.get("expected_cost")) ?? 0,
      p_expected_to_pay: expectedToPay(formData.get("expected_to_pay")),
      p_record_payment: formData.get("record_payment") === "true",
      p_to_pay_id: text(formData.get("to_pay_id")),
      p_amount: num(formData.get("amount")),
      p_date: text(formData.get("date")),
      p_budget_item_id: text(formData.get("budget_item_id")),
    });
    if (error) return { ok: false, error: error.message };
    if (!data || data.ok !== true) {
      return { ok: false, code: data?.code, state: data?.state, error: data?.message || "Could not save." };
    }

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Undo a "mark paid in full". The database refuses unless the tournament and
 * its payments are exactly as that save left them, so Undo never overwrites a
 * later edit, payment or status change.
 */
export async function undoMarkTournamentPaidInFull(formData) {
  try {
    await guard();
    const supabase = createClient();

    const operationId = text(formData.get("operation_id"));
    if (!operationId) return { ok: false, error: "Missing record reference." };

    const { data, error } = await supabase.rpc("undo_mark_tournament_paid_in_full", {
      p_operation_id: operationId,
    });
    if (error) return { ok: false, error: error.message };
    if (!data || data.ok !== true) {
      return { ok: false, code: data?.code, error: data?.message || "Could not undo." };
    }

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Reserved for genuine mistakes. Declined is the archive state. */
export async function deleteTournament(formData) {
  try {
    await guard();
    const supabase = createClient();


    const id = formData.get("id");
    if (!id) return { ok: false, error: "Missing record reference." };

    const { count } = await supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", id);

    if (count && count > 0) {
      return {
        ok: false,
        error: `This tournament has ${count} game${count === 1 ? "" : "s"} recorded and can't be deleted until those games are removed. You can mark it Declined instead.`,
      };
    }

    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


/** Links a tournament to the budget line its costs count against. */
export async function setTournamentBudgetLine(formData) {
  try {
    await guard();
    const supabase = createClient();

    const tournamentId = text(formData.get("tournament_id"));
    if (!tournamentId) return { ok: false, error: "Missing tournament reference." };

    const { error } = await supabase
      .from("tournaments")
      .update({ budget_item_id: text(formData.get("budget_item_id")) })
      .eq("id", tournamentId);

    if (error) {
      const m = (error.message ?? "").toLowerCase();
      if (m.includes("expense budget line")) {
        return { ok: false, error: "Tournament costs belong to an expense budget line." };
      }
      if (m.includes("different season")) {
        return { ok: false, error: "That budget line belongs to a different season." };
      }
      return { ok: false, error: error.message };
    }

    revalidatePath("/tournaments");
    revalidatePath("/finance");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
