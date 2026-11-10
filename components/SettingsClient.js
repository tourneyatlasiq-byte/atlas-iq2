"use client";

import { SignOutButton } from "./SignOutButton";
import { useState, useTransition, useEffect } from "react";
import { PageHelp } from "./PageHelp";
import { useMutation } from "./useMutation";
import { ConfirmAction, ConfirmDialog, useConfirm } from "./ConfirmAction";
import { PRIVACY_EMAIL } from "../lib/legal";
import { isInviteExpired, inviteLink, inviteRowStatus, INVITE_STATUS_TEXT, SENT_MEANS, deliveryFailureText, withRenderedContext, STALE_CONTEXT_MESSAGE } from "../lib/invite-rules";
import { OrganizationIdentity } from "./TeamBranding";
import { startNextSeason, makeSeasonCurrent, viewSeason } from "../lib/actions/seasons";
import {
  renameOrganization,
  renameTeam,
  renameSeason,
  createInvite,
  renewInvite,
  revokeInvite,
  resendInvite,
} from "../lib/actions/settings";

/**
 * Settings — four cards, each opening a drawer.
 *
 * Readable by everyone: a coach can see how Atlas is set up, which answers
 * "what season am I in?" without implying they can change it. Edit controls
 * appear only for owners and admins, and RLS enforces that regardless.
 */

/** Mirrors seasonPhase() in lib/context.js. */
function seasonPhaseOf(s, currentSeason) {
  if (s.is_current) return "current";
  if (!currentSeason) return "current";
  const key = (x) => x.start_date ?? x.created_at?.slice(0, 10) ?? "";
  return key(s) > key(currentSeason) ? "future" : "past";
}

/** "2026-27" -> "2027-28". Falls back to a blank field rather than guessing. */
function suggestNextSeasonName(current) {
  const m = (current ?? "").match(/^(\d{4})\s*-\s*(\d{2,4})$/);
  if (!m) return "";
  const start = Number(m[1]) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  coach: "Coach",
  parent: "Parent",
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function SettingsClient({
  organization, team, season, seasons, currentSeason, roster, people, invites, teams,
  counts, isAdmin, isOwner = false, currentUserId, autoOpen = null, emailEnabled = false,
}) {
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen);
  const [error, setError] = useState(null);
  const confirm = useConfirm();
  const { run: runMutation, pending } = useMutation();
  const [newInvite, setNewInvite] = useState(null);
  // Feedback for a Resend/Retry, shown on the row it came from rather than at
  // the top of the page, where it could be off screen.
  const [rowNote, setRowNote] = useState(null);
  // Phase 2D: set when the server says this page was drawn for a different
  // account than the one signed in now. Nothing else on the page can be
  // trusted until it is reloaded.
  const [stale, setStale] = useState(false);
  // Withdrawn invitations leave the list at once, before the refresh lands.
  const [hiddenInvites, setHiddenInvites] = useState(() => new Set());
  // Every invitation action carries the account and organization this page
  // was drawn for; the server refuses if either has changed.
  const ctxFd = (fd) => withRenderedContext(fd, currentUserId, organization?.id);
  // The revoke question is a dialog, not an inline panel, so the list keeps
  // its geometry. Its own error shows inside the dialog.
  const [revokeError, setRevokeError] = useState(null);
  const [newSeason, setNewSeason] = useState(null);

  useEffect(() => {
    if (!editing) return;
    function onKey(e) {
      if (e.key === "Escape") { setEditing(null); setNewInvite(null); }
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  // Settings acts on the PAGE, not inside a drawer, so a page-level error is
  // the right surface here. What was missing is synchronisation: making a
  // season current or cancelling an invitation changed the list behind the
  // action and nothing told the page to re-read it.
  function run(action, fd, onDone) {
    setError(null);
    runMutation(action, fd, {
      onSuccess: (result) => { confirm.cancel(); onDone?.(result); },
      onError: (message, result) => {
        if (result?.stale) {
          setStale(true);
          confirm.cancel();
          setEditing(null);
          setNewInvite(null);
          return;
        }
        setError(message);
      },
    });
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at && !i.revoked_at && !hiddenInvites.has(i.id));
  const revoking = pendingInvites.find((i) => confirm.asking === `invite:${i.id}`) ?? null;

  function revokeNow(invite) {
    const fd = ctxFd(new FormData());
    fd.set("id", invite.id);
    setRevokeError(null);
    runMutation(revokeInvite, fd, {
      onSuccess: () => {
        setHiddenInvites((prev) => new Set(prev).add(invite.id));
        confirm.cancel();
      },
      onError: (message, result) => {
        if (result?.stale) {
          // Nothing on this page can be trusted: close the dialog and show
          // the page-level reload message instead.
          setStale(true);
          confirm.cancel();
          return;
        }
        setRevokeError(message);
      },
    });
  }

  return (
    <div className="settings-page">
      {stale ? (
        <div className="alert alert-error settings-stale" role="alert">
          <span>{STALE_CONTEXT_MESSAGE}</span>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      ) : (
        error && <div className="alert alert-error">{error}</div>
      )}

      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-sub">How Season Tempo is set up for your organization.</div>
        </div>
        <PageHelp />
      </div>

      <div className="settings-grid">
        {/* Settings order (2026-11, reviewed with Chris): Organization | Team |
            Season, then People & Access, then Your Account | Danger Zone. The
            markup is in that order, so phones read it top to bottom and Delete
            organization is always last. */}
        {/* Organization */}
        <div className="card settings-card">
          <div className="settings-card-head">
            <span className="section-eyebrow">Organization</span>
            {isAdmin && (
              <button className="btn btn-ghost" onClick={() => setEditing("organization")}>Edit</button>
            )}
          </div>

          <OrganizationIdentity organization={organization} isOwner={isOwner} peopleCount={people.length} />
        </div>

        {/* Team */}
        <div className="card settings-card">
          <div className="settings-card-head">
            <span className="section-eyebrow">Team</span>
            {isAdmin && (
              <button className="btn btn-ghost" onClick={() => setEditing("team")}>Edit</button>
            )}
          </div>
          <p className="settings-value">{team?.name ?? "No team"}</p>
          <p className="settings-meta">
            {counts.roster} on the roster
          </p>
        </div>

        {/* Season */}
        <div className="card settings-card">
          <div className="settings-card-head">
            <span className="section-eyebrow">Season</span>
            {isAdmin && (
              <button className="btn btn-ghost" onClick={() => setEditing("season")}>Edit</button>
            )}
          </div>
          <ul className="season-list">
            {seasons.map((s) => {
              const phase = s.is_current ? "current" : seasonPhaseOf(s, currentSeason);
              return (
                <li key={s.id}>
                  <span className="season-list-name">{s.name}</span>
                  <span className={`season-option-tag tag-${phase}`}>
                    {phase === "current" ? "Current" : phase === "future" ? "Planning" : "Past"}
                  </span>
                  {isAdmin && !s.is_current && (
                    <button
                      className="btn btn-ghost"
                      disabled={pending}
                      onClick={() => confirm.ask(`season:${s.id}`)}
                    >
                      Make current
                    </button>
                  )}
                  {isAdmin && confirm.isAsking(`season:${s.id}`) && (
                    <ConfirmAction
                      message={`Make ${s.name} the current season? Everyone on ${team?.name ?? "this team"} will start working in ${s.name}. ${season?.name ?? "The current season"} stays intact and you can still view it.`}
                      confirmLabel="Make current"
                      pendingLabel="Switching…"
                      cancelLabel="Keep current season"
                      pending={pending}
                      error={error}
                      onCancel={() => confirm.cancel()}
                      onConfirm={() => {
                        const fd = new FormData();
                        fd.set("season_id", s.id);
                        run(makeSeasonCurrent, fd);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          <p className="settings-meta">
            {counts.roster} players · {counts.tournaments} tournaments this season
          </p>

          {isAdmin && (
            <button
              className="btn btn-secondary"
              style={{ marginTop: 12 }}
              onClick={() => setEditing("season-new")}
            >
              Start next season
            </button>
          )}
        </div>


        {/* People & Access */}
        <div className="card settings-card settings-card-wide">
          <div className="settings-card-head">
            <span className="section-eyebrow">People &amp; Access</span>
            {isAdmin && !stale && (
              <button className="btn btn-primary" onClick={() => setEditing("invite")}>
                Invite someone
              </button>
            )}
          </div>

          {/* One column structure for every row (Phase 2D cleanup):
              Person | Access | Role | Actions. Invitation details sit under
              the address, so a row never shifts columns because it says more. */}
          <div className="people-head" aria-hidden="true">
            <span className="section-eyebrow">Person</span>
            <span className="section-eyebrow">Access</span>
            <span className="section-eyebrow">Role</span>
            <span className="section-eyebrow people-head-actions">Actions</span>
          </div>
          <ul className="people-list">
            {people.map((p) => (
              <li key={p.id} className="person-row">
                <span className="person-cell">
                  <span className="person-primary">
                    {p.full_name ?? "Unnamed"}
                    {p.id === currentUserId && <span className="muted"> (you)</span>}
                  </span>
                </span>
                <span className="person-team">
                  {p.teamNames.length > 0 ? p.teamNames.join(", ") : <span className="muted">All teams</span>}
                </span>
                <span className="person-role">
                  <span className={`pill ${p.role === "owner" || p.role === "admin" ? "pill-paid" : "pill-registered"}`}>
                    {ROLE_LABELS[p.role] ?? p.role}
                  </span>
                </span>
                <span className="person-actions" />
              </li>
            ))}

            {pendingInvites.map((i) => {
              const expired = isInviteExpired(i);
              const status = inviteRowStatus(i);
              return (
              <li key={i.id} className="person-row person-pending">
                <span className="person-cell">
                  <span className="person-primary" title={i.email}>{i.email}</span>
                  <span
                    className="person-secondary invite-status"
                    data-status={status}
                    title={status === "sent" ? SENT_MEANS : undefined}
                  >
                    {INVITE_STATUS_TEXT[status]}
                    {status === "sent" && i.last_sent_at ? ` ${fmtDate(i.last_sent_at)}` : ""}
                    {status === "expired"
                      ? ` ${fmtDate(i.expires_at)}`
                      : ` · expires ${fmtDate(i.expires_at)}`}
                  </span>
                </span>
                <span className="person-team">
                  {i.team?.name ?? <span className="muted">No team yet</span>}
                </span>
                <span className="person-role">
                  <span className={`pill ${expired ? "pill-unregistered" : "pill-waitlisted"}`}>
                    {ROLE_LABELS[i.role] ?? i.role} · {expired ? "expired" : "invited"}
                  </span>
                </span>
                <span className="person-actions">
                  {isAdmin && !stale && emailEnabled && (status === "sent" || status === "failed" || (expired && i.delivery_status !== "manual")) && (
                    <button
                      className={`btn ${status === "failed" ? "btn-primary" : "btn-secondary"}`}
                      disabled={pending}
                      onClick={() => {
                        const fd = ctxFd(new FormData());
                        fd.set("id", i.id);
                        setRowNote(null);
                        setError(null);
                        runMutation(resendInvite, fd, {
                          onSuccess: (res) =>
                            setRowNote({
                              id: i.id,
                              tone: res.delivery === "sent" ? "ok" : "error",
                              text: res.delivery === "sent" ? `Invitation emailed again to ${i.email}.` : deliveryFailureText(res.code),
                            }),
                          // Refusals (rate limits, already sending) belong on the row too.
                          onError: (message, result) =>
                            result?.stale ? setStale(true) : setRowNote({ id: i.id, tone: "error", text: message }),
                        });
                      }}
                    >
                      {status === "failed" ? "Retry" : "Resend"}
                    </button>
                  )}
                  {isAdmin && !stale && expired && i.delivery_status === "manual" && (
                    <button
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => {
                        const fd = ctxFd(new FormData());
                        fd.set("id", i.id);
                        run(renewInvite, fd);
                      }}
                    >
                      Renew
                    </button>
                  )}
                  {isAdmin && status === "sending" && (
                    <button className="btn btn-secondary" disabled>Sending…</button>
                  )}
                  {isAdmin && !stale && !expired && <CopyInviteLink inviteId={i.id} />}
                  {isAdmin && !stale && (
                    <button
                      className="btn btn-danger-ghost"
                      disabled={pending}
                      onClick={() => {
                        setRevokeError(null);
                        confirm.ask(`invite:${i.id}`);
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </span>
                {rowNote?.id === i.id && (
                  <p className={`invite-row-note${rowNote.tone === "error" ? " invite-row-note-error" : ""}`} role="status">
                    {rowNote.text}
                  </p>
                )}
              </li>
              );
            })}
          </ul>

          {!isAdmin && (
            <p className="field-note">Only an owner or admin can invite people or change roles.</p>
          )}
        </div>

        {/* A second, always-reachable way to end the session (2026-11). */}
        <div className="card settings-card settings-card-half settings-account">
          <div className="settings-card-head">
            <span className="section-eyebrow">Your account</span>
          </div>
          <p className="field-note">Sign out of Season Tempo on this device.</p>
          <SignOutButton className="btn btn-secondary" />
        </div>

        {isOwner && (
          <div className="card settings-card settings-card-half settings-danger-card">
            <div className="settings-card-head">
              <span className="section-eyebrow settings-danger-title">Danger zone</span>
            </div>
            <p className="settings-danger-name">Delete organization</p>
            <p className="settings-meta">
              Permanently delete this organization and its information. Email{" "}
              <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from the address on your
              account.
            </p>
          </div>
        )}
      </div>

      {editing === "organization" && (
        <NameForm
          title="Organization name"
          note="The club your teams play under."
          value={organization.name}
          pending={pending}
          onSubmit={(fd) => run(renameOrganization, fd, () => setEditing(null))}
          onCancel={() => setEditing(null)}
        />
      )}

      {editing === "team" && (
        <NameForm
          title="Team name"
          note="Include the age group if you use one — Armor Elite 16U."
          value={team?.name ?? ""}
          pending={pending}
          onSubmit={(fd) => run(renameTeam, fd, () => setEditing(null))}
          onCancel={() => setEditing(null)}
        />
      )}

      {editing === "season" && (
        <NameForm
          title="Season name"
          note="Most teams use a format like 2026-27."
          value={season?.name ?? ""}
          pending={pending}
          onSubmit={(fd) => run(renameSeason, fd, () => setEditing(null))}
          onCancel={() => setEditing(null)}
        />
      )}

      {editing === "season-new" && (
        <StartNextSeasonForm
          roster={roster}
          suggestedName={suggestNextSeasonName(currentSeason?.name ?? season?.name)}
          currentName={currentSeason?.name ?? season?.name}
          created={newSeason}
          pending={pending}
          onSubmit={(fd) => run(startNextSeason, fd, (res) => setNewSeason(res.result))}
          onCancel={() => { setEditing(null); setNewSeason(null); }}
        />
      )}

      {editing === "invite" && (
        <InviteForm
          teams={teams}
          pending={pending}
          invite={newInvite}
          emailEnabled={emailEnabled}
          onSubmit={(fd) => {
            const email = String(fd.get("email") ?? "").trim().toLowerCase();
            run(createInvite, ctxFd(fd), (res) => setNewInvite({ ...res, email }));
          }}
          onRetry={(inviteId) => {
            const fd = ctxFd(new FormData());
            fd.set("id", inviteId);
            setError(null);
            runMutation(resendInvite, fd, {
              onSuccess: (res) => setNewInvite((prev) => ({ ...prev, ...res })),
              // Shown inside the dialog, not behind it.
              onError: (message, result) => {
                if (result?.stale) {
                  setStale(true);
                  setEditing(null);
                  setNewInvite(null);
                  return;
                }
                setNewInvite((prev) => ({ ...prev, delivery: "refused", message }));
              },
            });
          }}
          onCancel={() => { setEditing(null); setNewInvite(null); }}
        />
      )}

      {isAdmin && revoking && (
        <ConfirmDialog
          title="Revoke invitation?"
          message={
            <>
              The invitation to <strong>{revoking.email}</strong> stops working immediately. You can
              invite them again later.
            </>
          }
          confirmLabel="Revoke invitation"
          pendingLabel="Revoking…"
          pending={pending}
          error={revokeError}
          onCancel={() => { setRevokeError(null); confirm.cancel(); }}
          onConfirm={() => revokeNow(revoking)}
        />
      )}
    </div>
  );
}

function NameForm({ title, note, value, pending, onSubmit, onCancel }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <div className="modal-head"><h2>{title}</h2></div>
          <div className="modal-body">
            <div className="field">
              <label htmlFor="s-name">{title}</label>
              <input id="s-name" name="name" defaultValue={value} required autoFocus />
              <p className="field-note">{note}</p>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Invite creation.
 *
 * Owner and admin are absent from the role list on purpose — an invitation can
 * never confer administrative rights, and the database enforces that too.
 */
/**
 * Copy an unused invitation's link from the People list, so the link is never
 * lost once the "Invitation ready" dialog has been closed.
 */
function CopyInviteLink({ inviteId }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={() => {
        navigator.clipboard?.writeText(inviteLink(window.location.origin, inviteId));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function InviteForm({ teams, pending, invite, onSubmit, onCancel, onRetry, emailEnabled = false }) {
  const [copied, setCopied] = useState(false);

  const link =
    invite && typeof window !== "undefined"
      ? inviteLink(window.location.origin, invite.inviteId)
      : null;

  // Phase 2B: the invitation was created and an email was attempted.
  if (invite && link && invite.emailed) {
    const sent = invite.delivery === "sent";
    const expires = invite.expiresAt ? fmtDate(invite.expiresAt) : null;
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{sent ? "Invitation sent" : "Invitation created — email not sent"}</h2>
            <div className="page-sub">
              {sent
                ? <>We emailed an invitation to <strong>{invite.email}</strong>{expires ? <>. It expires {expires}</> : null}.</>
                : <>The invitation to <strong>{invite.email}</strong> exists and its link works.</>}
            </div>
          </div>
          <div className="modal-body">
            {sent ? (
              <p className="field-note invite-sent-note">{SENT_MEANS}</p>
            ) : (
              <div className="alert alert-error" role="alert">
                {invite.delivery === "failed" ? deliveryFailureText(invite.code) : invite.message}
              </div>
            )}
            {!sent && invite.delivery === "failed" && (
              <button className="btn btn-primary btn-block" disabled={pending} onClick={() => onRetry(invite.inviteId)}>
                {pending ? "Sending…" : "Retry"}
              </button>
            )}
            <button
              className={`btn ${sent ? "btn-secondary" : "btn-secondary"} btn-block invite-copy-fallback`}
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
          <div className="modal-foot">
            <span />
            <button className="btn btn-secondary" onClick={onCancel}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  if (invite && link) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{invite.renewed ? "Invitation renewed" : "Invitation ready"}</h2>
            <div className="page-sub">Send this link to the person you're inviting.</div>
          </div>
          <div className="modal-body">
            <div className="invite-link">{link}</div>

            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>

            <div className="alert alert-info" style={{ marginTop: 16 }}>
              <strong>They must sign in with the same email address.</strong>
              <p style={{ margin: "6px 0 0" }}>
                The invitation only works for the address you entered. It expires in 14 days.
              </p>
            </div>
          </div>
          <div className="modal-foot">
            <span />
            <button className="btn btn-secondary" onClick={onCancel}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <div className="modal-head">
            <h2>Invite someone</h2>
            <div className="page-sub">
              {emailEnabled ? "We'll email them an invitation." : "You'll get a link to send them."}
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="i-email">Email address</label>
              <input id="i-email" name="email" type="email" required autoFocus placeholder="coach@example.com" />
              <p className="field-note">They must sign in with this exact address.</p>
            </div>

            <div className="field">
              <label htmlFor="i-role">Role</label>
              <select id="i-role" name="role" required defaultValue="coach">
                <option value="coach">Coach — full access to team and season</option>
                <option value="manager">Manager — full access to team and season</option>
              </select>
              <p className="field-note">
                Only an owner can grant owner or admin access, and not through an invitation.
              </p>
            </div>

            <div className="field">
              <label htmlFor="i-team">Team</label>
              <select id="i-team" name="team_id" defaultValue={teams[0]?.id ?? ""}>
                <option value="">No team yet</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="field-note">
                Without a team they can sign in but won't see any roster or schedule.
              </p>
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {emailEnabled
                ? pending ? "Sending…" : "Send invitation"
                : pending ? "Creating…" : "Create invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Start next season.
 *
 * Everyone active starts selected; inactive players start unselected, since
 * they have already left. Nothing is copied except the people chosen here and,
 * optionally, the shape of the budget.
 */
function StartNextSeasonForm({ roster, suggestedName, currentName, created, pending, onSubmit, onCancel }) {
  const active = roster.filter((r) => r.is_active);
  const inactive = roster.filter((r) => !r.is_active);
  const [selected, setSelected] = useState(() => new Set(active.map((r) => r.player_id)));

  if (created) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>{created.name} created</h2>
          </div>
          <div className="modal-body">
            <p className="section-body">
              {created.players_copied} {created.players_copied === 1 ? "person" : "people"} carried over
              {created.budget_lines_copied > 0 &&
                `, ${created.budget_lines_copied} budget lines copied with amounts at zero`}.
            </p>
            <div className="alert alert-info">
              Your current season is still <strong>{currentName}</strong>. You can start planning{" "}
              {created.name} now and make it current when you're ready.
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn btn-secondary" onClick={onCancel}>
              Keep working in {currentName}
            </button>
            <ViewNewSeason seasonId={created.season_id} name={created.name} onDone={onCancel} />
          </div>
        </div>
      </div>
    );
  }

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <form action={onSubmit}>
          <div className="modal-head">
            <h2>Start next season</h2>
            <div className="page-sub">
              {currentName} stays exactly as it is. Nothing is moved.
            </div>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="ns-name">Season name</label>
              <input id="ns-name" name="season_name" required defaultValue={suggestedName}
                     placeholder="2027-28" autoFocus />
            </div>

            <div className="form-divider">
              Who's coming back? <span className="muted">{selected.size} selected</span>
            </div>

            <div className="rollover-list">
              {active.map((r) => (
                <label key={r.player_id} className="rollover-row">
                  <input
                    type="checkbox"
                    name="player_ids"
                    value={r.player_id}
                    checked={selected.has(r.player_id)}
                    onChange={() => toggle(r.player_id)}
                  />
                  <span className="rollover-name">{r.full_name}</span>
                  <span className="muted">
                    {r.person_type === "player"
                      ? r.jersey_number != null ? `#${r.jersey_number}` : ""
                      : r.person_type}
                  </span>
                </label>
              ))}

              {inactive.map((r) => (
                <label key={r.player_id} className="rollover-row rollover-inactive">
                  <input
                    type="checkbox"
                    name="player_ids"
                    value={r.player_id}
                    checked={selected.has(r.player_id)}
                    onChange={() => toggle(r.player_id)}
                  />
                  <span className="rollover-name">{r.full_name}</span>
                  <span className="muted">inactive</span>
                </label>
              ))}
            </div>

            <label className="dupe-ack" style={{ marginTop: 16 }}>
              <input type="checkbox" name="copy_budget" />
              Start with last season's budget categories
            </label>
            <p className="field-note">
              Copies the line items only. Amounts start at zero so you set this year's numbers.
            </p>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create season"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Switches the viewing context to the new season. Never touches is_current. */
function ViewNewSeason({ seasonId, name, onDone }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn btn-primary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await viewSeason(seasonId);
          onDone?.();
        })
      }
    >
      {pending ? "Opening…" : `View ${name}`}
    </button>
  );
}
