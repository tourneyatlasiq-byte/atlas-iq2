"use client";

import { useState, useRef, useTransition } from "react";
import { TeamMark } from "./TeamMark";
import { uploadTeamLogo, removeTeamLogo } from "../lib/actions/branding";

/**
 * Team Branding in Settings.
 *
 * Owner-only. Coaches and managers run the season; the club's identity is the
 * owner's to set. The storage policy enforces the same rule, so this control
 * being hidden is convenience rather than the security boundary.
 */
export function TeamBranding({ organization, isOwner }) {
  const [preview, setPreview] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef(null);

  const shown = preview ?? organization?.logo_url ?? null;

  function pick(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setError(null);
    setFile(chosen);
    // Local preview so the owner sees the result before committing.
    setPreview(URL.createObjectURL(chosen));
  }

  function reset() {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="settings-branding">
      <div className="section-head">
        <div>
          <span className="section-eyebrow">Team branding</span>
          <p className="field-note">
            Your logo appears beside your organization name throughout Season Tempo.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="branding-row">
        <TeamMark name={organization?.name} logoUrl={shown} size={72} tone="navy" />

        <div className="branding-detail">
          <p className="branding-name">{organization?.name}</p>
          <p className="field-note">
            {shown
              ? preview
                ? "Preview — not saved yet."
                : "Current logo."
              : "No logo yet. Your initials are shown until you add one."}
          </p>

          {isOwner ? (
            <>
              <input
                ref={inputRef}
                id="logo-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={pick}
                className="branding-input"
              />

              <div className="branding-actions">
                {file && (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        const fd = new FormData();
                        fd.set("logo", file);
                        startTransition(async () => {
                          const result = await uploadTeamLogo(fd);
                          if (result?.ok) reset();
                          else setError(result?.error ?? "Something went wrong.");
                        });
                      }}
                    >
                      {pending ? "Saving…" : "Save logo"}
                    </button>
                    <button className="btn btn-secondary" disabled={pending} onClick={reset}>
                      Cancel
                    </button>
                  </>
                )}

                {!file && organization?.logo_url && (
                  <button
                    className="btn btn-ghost"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm("Remove the team logo?\n\nYour initials will be shown instead.")) return;
                      setError(null);
                      startTransition(async () => {
                        const result = await removeTeamLogo();
                        if (result?.ok) reset();
                        else setError(result?.error ?? "Something went wrong.");
                      });
                    }}
                  >
                    Remove logo
                  </button>
                )}
              </div>

              <p className="field-note">PNG, JPG, WEBP or SVG, up to 2 MB. A square image works best.</p>
            </>
          ) : (
            <p className="field-note">Only an owner can change the team logo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
