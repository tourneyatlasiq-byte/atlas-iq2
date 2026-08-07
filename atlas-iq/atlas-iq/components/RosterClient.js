"use client";

import { useState, useTransition } from "react";
import { addRosterMember, updateRosterMember, removeRosterMember } from "../lib/actions/roster";

const POSITIONS = ["", "P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL"];
const SIZES = ["", "YS", "YM", "YL", "AS", "AM", "AL", "AXL"];

function fmtDob(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

export function RosterClient({ rows, canWrite, seasonName }) {
  const [editing, setEditing] = useState(null); // row | "new" | null
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      const action = editing === "new" ? addRosterMember : updateRosterMember;
      const result = await action(formData);
      if (result?.ok) setEditing(null);
      else setError(result?.error ?? "Something went wrong. Try again.");
    });
  }

  function remove(row) {
    const name = row.player?.full_name ?? "this person";
    if (!confirm(`Remove ${name} from the ${seasonName} roster?\n\nTheir player record stays in the organization.`)) return;

    setError(null);
    const fd = new FormData();
    fd.set("assignment_id", row.id);
    startTransition(async () => {
      const result = await removeRosterMember(fd);
      if (!result?.ok) setError(result?.error ?? "Could not remove that person.");
    });
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="page-sub">
            {rows.length} {rows.length === 1 ? "person" : "people"} on the {seasonName} roster
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            Add person
          </button>
        )}
      </div>

      <div className="card card-flush">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>No one on the roster yet</h3>
            <p>Add your first player to start building the {seasonName} season.</p>
            {canWrite && (
              <button className="btn btn-primary" onClick={() => setEditing("new")}>
                Add person
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th>Position</th>
                <th>Grad</th>
                <th>Date of birth</th>
                <th>Parent contact</th>
                {canWrite && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.jersey_number != null ? (
                      <span className="jersey">{row.jersey_number}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.player?.full_name ?? "—"}</td>
                  <td>
                    <span className={`pill ${row.player?.person_type === "player" ? "pill-player" : "pill-staff"}`}>
                      {row.player?.person_type ?? "player"}
                    </span>
                  </td>
                  <td>{row.position ?? <span className="muted">—</span>}</td>
                  <td>{row.player?.grad_year ?? <span className="muted">—</span>}</td>
                  <td>{fmtDob(row.player?.date_of_birth)}</td>
                  <td className="muted">{row.player?.parent_email ?? "—"}</td>
                  {canWrite && (
                    <td className="td-actions">
                      <button className="btn btn-ghost" onClick={() => setEditing(row)} disabled={pending}>
                        Edit
                      </button>
                      <button className="btn btn-danger-ghost" onClick={() => remove(row)} disabled={pending}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <RosterForm
          row={editing === "new" ? null : editing}
          pending={pending}
          onSubmit={submit}
          onCancel={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function RosterForm({ row, pending, onSubmit, onCancel }) {
  const p = row?.player ?? {};
  const isNew = !row;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="roster-form-title">
      <div className="modal">
        <form action={onSubmit}>
          {row && <input type="hidden" name="assignment_id" value={row.id} />}
          {p.id && <input type="hidden" name="player_id" value={p.id} />}

          <div className="modal-head">
            <h2 id="roster-form-title">{isNew ? "Add person" : `Edit ${p.full_name}`}</h2>
          </div>

          <div className="modal-body">
            <div className="field">
              <label htmlFor="full_name">Name</label>
              <input id="full_name" name="full_name" required defaultValue={p.full_name ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="person_type">Type</label>
                <select id="person_type" name="person_type" defaultValue={p.person_type ?? "player"}>
                  <option value="player">Player</option>
                  <option value="coach">Coach</option>
                  <option value="manager">Manager</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="jersey_number">Jersey number</label>
                <input id="jersey_number" name="jersey_number" type="number" min="0" max="99"
                       defaultValue={row?.jersey_number ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="position">Position</label>
                <select id="position" name="position" defaultValue={row?.position ?? ""}>
                  {POSITIONS.map((o) => (
                    <option key={o} value={o}>{o === "" ? "—" : o}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="grad_year">Graduation year</label>
                <input id="grad_year" name="grad_year" type="number" min="2020" max="2040"
                       defaultValue={p.grad_year ?? ""} />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="jersey_size">Jersey size</label>
                <select id="jersey_size" name="jersey_size" defaultValue={row?.jersey_size ?? ""}>
                  {SIZES.map((o) => (
                    <option key={o} value={o}>{o === "" ? "—" : o}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pants_size">Pants size</label>
                <select id="pants_size" name="pants_size" defaultValue={row?.pants_size ?? ""}>
                  {SIZES.map((o) => (
                    <option key={o} value={o}>{o === "" ? "—" : o}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="date_of_birth">Date of birth</label>
              <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={p.date_of_birth ?? ""} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="parent_email">Parent email</label>
                <input id="parent_email" name="parent_email" type="email" defaultValue={p.parent_email ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="parent_phone">Parent phone</label>
                <input id="parent_phone" name="parent_phone" defaultValue={p.parent_phone ?? ""} />
              </div>
            </div>
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Saving…" : isNew ? "Add person" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
