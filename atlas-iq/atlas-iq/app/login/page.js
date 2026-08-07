"use client";

import { useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { LogoLockup } from "../../components/Logo";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  async function sendLink(e) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setError(error.message);
      setStatus("idle");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-brand">
          <LogoLockup size={44} tone="dark" />
        </div>

        <h1 className="login-title">The Operating System for Modern Travel Sports Organizations</h1>
        <p className="login-tag">Run your organization from one intelligent platform.</p>

        <div className="card">
          {status === "sent" ? (
            <div>
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                Check <strong>{email}</strong> for your sign-in link. It opens Atlas IQ directly — no password needed.
              </div>
              <button
                className="btn btn-ghost"
                style={{ marginTop: 12 }}
                onClick={() => setStatus("idle")}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={sendLink}>
              {error && <div className="alert alert-error">{error}</div>}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="coach@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 14 }}
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending…" : "Send me a login link"}
              </button>
              <div className="login-hint">No password needed — we'll email you a link to sign in.</div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
