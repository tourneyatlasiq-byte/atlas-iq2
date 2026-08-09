"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { LogoLockup } from "../../components/SeasonTempoLogo";

/**
 * One magic-link flow, three framings.
 *
 * Supabase creates the account on first link, so a separate sign-up route
 * would be a second door to the same room. What was missing was the page ever
 * saying so — a coach arriving from "Try Atlas" saw a bare email field that
 * read like a returning-user sign-in.
 *
 *   ?new=1              someone starting out
 *   ?next=/invite/...   someone who was invited
 *   otherwise           someone coming back
 */
const COPY = {
  new: {
    title: "Start with Season Tempo",
    lede: "Enter your email and we'll send you a secure sign-in link. No password to remember.",
    note: "Free while we're in early access.",
    button: "Send my link",
    altText: "Already using Season Tempo?",
    altLabel: "Sign in",
    altHref: "/login",
  },
  invite: {
    title: "You've been invited",
    lede: "Enter the email address your invitation was sent to and we'll send you a secure sign-in link.",
    note: "The invitation only works for that address.",
    button: "Send my link",
    altText: null,
  },
  returning: {
    title: "Welcome back",
    lede: "Enter your email and we'll send you a secure sign-in link.",
    note: null,
    button: "Send sign-in link",
    altText: "New to Season Tempo?",
    altLabel: "Try Season Tempo",
    altHref: "/login?new=1",
  },
};

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const isNew = searchParams.get("new") === "1";

  // An invited person is almost never a returning user, so "Welcome back"
  // would be wrong. `next` and `new` are separate parameters and can coexist.
  const mode = next?.startsWith("/invite/") ? "invite" : isNew ? "new" : "returning";
  const copy = COPY[mode];

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
        // Carries the intended destination through the link. Without it an
        // invited person lands on /welcome and creates their own organization
        // instead of joining the one that invited them.
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
          <LogoLockup size={44} tone="navy" />
        </div>

        <h1 className="login-title">{copy.title}</h1>
        <p className="login-tag">{copy.lede}</p>

        <div className="card">
          {status === "sent" ? (
            <div>
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                Check <strong>{email}</strong> for your link. It opens Season Tempo directly — no
                password needed.
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
                  autoFocus
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
                {status === "sending" ? "Sending…" : copy.button}
              </button>

              {copy.note && <div className="login-note">{copy.note}</div>}

              <div className="login-hint">
                No password needed — we&rsquo;ll email you a link to sign in.
              </div>
            </form>
          )}
        </div>

        {copy.altText && (
          <p className="login-alt">
            {copy.altText}{" "}
            <Link href={copy.altHref}>{copy.altLabel}</Link>
          </p>
        )}
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
