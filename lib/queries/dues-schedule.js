import { createClient } from "../supabase/server";
import { cents } from "../finance-rules";

/**
 * The team schedule and every player's active installments for a season.
 *
 * Read separately from listPlayerPayments on purpose: if the dues-schedule
 * tables are not in the database yet, Finance still loads exactly as before and
 * the schedule screens simply do not appear (`available: false`).
 *
 * Amounts are integer cents. Replaced / exempt / cleared entries are history and
 * are not returned here; they stay in the table.
 */
export async function listDuesSchedules(seasonId) {
  const none = { available: false, template: null, byPayment: {} };
  try {
    const supabase = createClient();
    const t = await supabase
      .from("dues_schedule_templates")
      .select("id, name, items, revision, is_default")
      .eq("season_id", seasonId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (t.error) return none;
    const i = await supabase
      .from("dues_installments")
      .select("payment_id, seq, due_date, amount")
      .eq("season_id", seasonId)
      .is("superseded_at", null)
      .order("seq", { ascending: true })
      .limit(5000);
    if (i.error) return none;

    const row = t.data?.[0] ?? null;
    const template = row
      ? {
          id: row.id,
          name: row.name,
          revision: row.revision,
          items: (row.items ?? []).map((x) => ({ dueDate: x.due_date, amountCents: cents(x.amount) })),
        }
      : null;
    const byPayment = {};
    for (const r of i.data ?? []) {
      (byPayment[r.payment_id] ??= []).push({ position: r.seq, dueDate: r.due_date, amountCents: cents(r.amount) });
    }
    return { available: true, template, byPayment };
  } catch {
    return none;
  }
}
