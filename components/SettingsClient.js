"use client";

import { useState, useTransition, useEffect } from "react";
import {
  renameOrganization,
  renameTeam,
  renameSeason,
  createInvite,
  cancelInvite,
} from "../lib/actions/settings";

/**
 * Settings — four cards, each opening a drawer.
 *
 * Readable by everyone: a coach can see how Atlas is set up, which answers
 * "what season am I in?" without implying they can change it. Edit controls
 * appear only for owners and admins, and RLS enforces that regardless.
 */

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
  organization, team, season, people, invites, teams,
  counts, isAdmin, currentUserId,
}) {
  const [editing, setEditing] = useState(null); // organization | team | season | invite
  const [error, setError] = useState(null);
  const [newInvite, setNewInvite] = useState(null);
  const [pending, startTransition] = useTransition();

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

  function run(action, fd, onDone) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (result?.ok) onDone?.(result);
      else setError(result?.error ?? "Something went wrong.");
    });
  }

  const pendingInvites = invites.filter((i) => !i.accepted_at);

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="page-sub">How Atlas is set up for your organization.</div>
        </div>
      </div>

      <div className="settings-grid">
        {/* Organization */}
        <div className="card settings-card">
          <div className="settings-card-head">
            <span className="section-eyebrow">Organization</span>
            {isAdmin && (
              <button className="btn btn-ghost" onClick={() => setEditing("organization")}>Edit</button>
            )}
          </div>
          <p className="settings-value">{organization.name}</p>
          <p className="settings-meta">
            {people.length} {people.length === 1 ? "person" : "people"}
          </p>
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
          <p className="settings-value">
            {season?.name ?? "No season"}
            {season?.is_current && <span className="pill pill-paid settings-current">Current</span>}
          </p>
          <p className="settings-meta">
            {counts.roster} players · {counts.tournaments} tournaments
          </p>
        </div>

        {/* People & Access */}
        <div className="card settings-card settings-card-wide">
          <div className="settings-card-head">
            <span className="section-eyebrow">People &amp; Access</span>
            {isAdmin && (
              <button className="btn btn-primary" onClick={() => setEditing("invite")}>
                Invite someone
              </button>
            )}
          </div>

          <ul className="people-list">
            {people.map((p) => (
              <li key={p.id}>
                <span className="person-name">
                  {p.full_name ?? "Unnamed"}
                  {p.id === currentUserId && <span className="muted"> (you)</span>}
                </span>
                <span className="person-team">
                  {p.teamNames.length > 0 ? p.teamNames.join(", ") : <span className="muted">All teams</span>}
                </span>
                <span className={`pill ${p.role === "owner" || p.role === "admin" ? "pill-paid" : "pill-registered"}`}>
                  {ROLE_LABELS[p.role] ?? p.role}
                </span>
              </li>
            ))}

            {pendingInvites.map((i) => (
              <li key={i.id} className="person-pending">
                <span className="person-name">
                  {i.email}
                  <span className="muted"> · invited {fmtDate(i.created_at)}</span>
                </span>
                <span className="person-team">
                  {i.team?.name ?? <span className="muted">No team yet</span>}
                </span>
                <span className="pill pill-waitlisted">
                  {ROLE_LABELS[i.role] ?? i.role} · invited
                </span>
                {isAdmin && (
                  <button
                    className="btn btn-danger-ghost"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(`Cancel the invitation to ${i.email}?`)) return;
                      const fd = new FormData();
                      fd.set("id", i.id);
                      run(cancelInvite, fd);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!isAdmin && (
            <p className="field-note">Only an owner or admin can invite people or change roles.</p>
          )}
        </div>
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

      {editing === "invite" && (
        <InviteForm
          teams={teams}
          pending={pending}
          invite={newInvite}
          onSubmit={(fd) => run(createInvite, fd, (res) => setNewInvite(res))}
          onCancel={() => { setEditing(null); setNewInvite(null); }}
        />
      )}
    </>
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
function InviteForm({ teams, pending, invite, onSubmit, onCancel }) {
  const [copied, setCopied] = useState(false);

  const link =
    invite && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${invite.inviteId}`
      : null;

  if (invite && link) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h2>Invitation ready</h2>
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
            <div className="page-sub">You'll get a link to send them.</div>
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
                <option value="parent">Parent — limited access</option>
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
              {pending ? "Creating…" : "Create invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
