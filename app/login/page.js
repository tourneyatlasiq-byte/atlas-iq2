"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { LogoLockup } from "../../components/Logo";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

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
      options: {
        // Carry the intended destination through the magic link. Without this
        // an invited person lands on /dashboard, then /welcome, and creates
        // their own organization instead of joining the one that invited them.
        emailRedirectTo:
          `${window.location.origin}/auth/callback` +
          (next ? `?next=${encodeURIComponent(next)}` : ""),
      },
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

/**
 * useSearchParams opts the page out of static rendering, which Next requires a
 * Suspense boundary for. Without it the production build fails on this page.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
