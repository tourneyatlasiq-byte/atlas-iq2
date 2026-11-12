import { canWrite, isOrgAdmin } from "../../../lib/context";

/**
 * What Help may offer this person (2026-11). Read from the same context every
 * page uses; presentation only — the server still decides every action.
 */
export function helpAccess(ctx) {
  return {
    isAdmin: isOrgAdmin(ctx?.profile),
    canWrite: canWrite(ctx?.profile),
    qab: Boolean(ctx?.features?.qab),
    phase: ctx?.seasonPhase ?? null,
  };
}
