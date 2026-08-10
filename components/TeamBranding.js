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
    <div className="card settings-card settings-card-wide">
      <div className="settings-card-head">
        <span className="section-eyebrow">Organization branding</span>
      </div>

      <div className="branding-row">
        <TeamMark name={organization?.name} logoUrl={shown} size={72} tone="navy" />

        <div className="branding-detail">
          <p className="branding-name">{organization?.name}</p>
          {preview && <p className="field-note">Preview — not saved yet.</p>}

          {isOwner ? (
            <>
              <input
                ref={inputRef}
                id="logo-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={pick}
                className="visually-hidden"
              />

              <div className="branding-actions">
                {!file && (
                  <button
                    className={organization?.logo_url ? "btn btn-secondary" : "btn btn-primary"}
                    disabled={pending}
                    onClick={() => inputRef.current?.click()}
                  >
                    {organization?.logo_url ? "Replace logo" : "Upload logo"}
                  </button>
                )}

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
                      if (!confirm("Remove the organization logo?\n\nYour initials will be shown instead.")) return;
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

              <p className="field-note">PNG, JPG or WEBP · 2 MB max · square works best</p>
            </>
          ) : (
            <p className="field-note">Only an owner can change the organization logo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
