"use client";

import { useState, useTransition, useEffect } from "react";
import { SUPPORT_EMAIL, PRIVACY_EMAIL } from "../lib/legal";
import { ContactsDirectory } from "./ContactsDirectory";
import { TeamBranding } from "./TeamBranding";
import { startNextSeason, makeSeasonCurrent, viewSeason } from "../lib/actions/seasons";
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
  counts, isAdmin, isOwner = false, currentUserId, autoOpen = null, contacts = [],
}) {
  // Opened directly from the help panel.
  const [editing, setEditing] = useState(autoOpen);
  const [error, setError] = useState(null);
  const [newInvite, setNewInvite] = useState(null);
  const [newSeason, setNewSeason] = useState(null);
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
          <div className="page-sub">How Season Tempo is set up for your organization.</div>
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
                      onClick={() => {
                        if (!confirm(
                          `Make ${s.name} the current season?\n\nEveryone on ${team?.name ?? "this team"} will start working in ${s.name}. ${season?.name ?? "The current season"} stays intact and you can still view it.`
                        )) return;
                        const fd = new FormData();
                        fd.set("season_id", s.id);
                        run(makeSeasonCurrent, fd);
                      }}
                    >
                      Make current
                    </button>
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

      <TeamBranding organization={organization} isOwner={isOwner} />

      <ContactsDirectory contacts={contacts} canWrite={isAdmin} />

      <div className="settings-legal">
        <span className="section-eyebrow">Legal</span>
        <p>
          <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>
          <span className="tiq-dot" aria-hidden="true">·</span>
          <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a>
        </p>
        <p className="field-note">
          Questions or help: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <br />
          To delete your account and your organization&rsquo;s information, email{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from the address on your account.
        </p>
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
