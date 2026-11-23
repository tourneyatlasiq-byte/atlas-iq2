/**
 * Which players already have a payment schedule (active) or schedule history.
 * Used by the older dues actions so they can refuse politely instead of
 * surfacing a database error. If the schedule tables are not in the database
 * yet the answer is "none", and those actions behave exactly as before.
 */
export async function scheduleState(supabase, paymentIds) {
  const out = { active: new Set(), history: new Set() };
  if (!paymentIds?.length) return out;
  const { data, error } = await supabase
    .from("dues_installments")
    .select("payment_id, superseded_at")
    .in("payment_id", paymentIds)
    .limit(10000);
  if (error) return out;
  for (const r of data ?? []) {
    out.history.add(r.payment_id);
    if (!r.superseded_at) out.active.add(r.payment_id);
  }
  return out;
}
