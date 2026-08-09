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
export function WelcomeForm({ defaultSeason, seasonOptions = [] }) {
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
          placeholder="e.g., Armor Elite"
        />
        <p className="field-note">
          If your team isn't part of a club or organization, use your team name here.
        </p>
      </div>

      <div className="field">
        <label htmlFor="team_name">Team name</label>
        <input
          id="team_name"
          name="team_name"
          required
          placeholder="e.g., Armor Elite 16U"
        />
        <p className="field-note">Include the age group if you use one — Mower 2028/29, Armor Elite 16U.</p>
      </div>

      <div className="field">
        <label htmlFor="season_name">Season</label>
        {/* Options come from seasonOptions() in lib/onboarding, which derives
            from currentSeasonLabel(). No second rule for what "current" means. */}
        <select id="season_name" name="season_name" required defaultValue={defaultSeason}>
          {seasonOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <p className="field-note">
          We&rsquo;ve selected the current season. Change it if you&rsquo;re setting up a
          different one.
        </p>
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
