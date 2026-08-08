"use client";

import { useState, useTransition } from "react";
import { createOrganization } from "../lib/actions/setup";

/**
 * First-run setup.
 *
 * Three fields, because everything else can be added later from inside Atlas.
 * Role is not asked: the person creating an organization is its owner by
 * definition, and accepting a role from the browser is exactly what the
 * Phase 1 fix removed.
 */
export function WelcomeForm({ defaultSeason }) {
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function submit(formData) {
    setError(null);
    startTransition(async () => {
      // A successful call redirects, so nothing after this runs on success.
      const result = await createOrganization(formData);
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form action={submit} className="welcome-form">
      {error && <div className="alert alert-error">{error}</div>}

      <div className="field">
        <label htmlFor="organization_name">Club or organization name</label>
        <input
          id="organization_name"
          name="organization_name"
          required
          autoFocus
          autoComplete="organization"
          placeholder="Armor Elite"
        />
        <p className="field-note">The club your team plays under.</p>
      </div>

      <div className="field">
        <label htmlFor="team_name">Team name</label>
        <input
          id="team_name"
          name="team_name"
          required
          placeholder="Armor Elite 16U"
        />
        <p className="field-note">Include the age group if you use one — Mower 2028/29, Armor Elite 16U.</p>
      </div>

      <div className="field">
        <label htmlFor="season_name">Season</label>
        <input id="season_name" name="season_name" required defaultValue={defaultSeason} />
        <p className="field-note">Change this if your season runs differently.</p>
      </div>

      <button type="submit" className="btn btn-primary welcome-submit" disabled={pending}>
        {pending ? "Setting up…" : "Create My Team"}
      </button>

      <p className="field-note welcome-foot">
        You can add players, tournaments and everything else once you're in.
      </p>
    </form>
  );
}
