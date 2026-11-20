"use client";

import { useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";
import { LogoMark } from "../../components/SeasonTempoLogo";
import "./login.css";
import { SUPPORT_EMAIL } from "../../lib/legal";
import {
  safeNext,
  isInvitePath,
  signInErrorMessage,
  normalizeOtp,
  OTP_ERROR,
} from "../../lib/auth-redirect";

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
    note: "Free during early access. We'll give you advance notice before that changes.",
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

// A shape check only (something@something.tld); Supabase decides whether the address can sign in.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm() {
  const searchParams = useSearchParams();
  // Only a same-site path is ever carried through the link (see auth-redirect).
  const next = safeNext(searchParams.get("next"), null);
  const isNew = searchParams.get("new") === "1";
  // Set by /auth/callback when a link failed. A reason key, never raw text.
  const linkError = signInErrorMessage(searchParams.get("error"));

  // An invited person is almost never a returning user, so "Welcome back"
  // would be wrong. `next` and `new` are separate parameters and can coexist.
  const mode = isInvitePath(next) ? "invite" : isNew ? "new" : "returning";
  const copy = COPY[mode];

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  // Only a malformed address marks the email field. A failed or expired link is a page-level message.
  const [emailError, setEmailError] = useState(null);
  const [code, setCode] = useState("");
  const [codeStatus, setCodeStatus] = useState("idle");
  const [codeError, setCodeError] = useState(null);
  // Resend lives on the "Check your email" screen and has its own state, so
  // the screen never disappears while a new email is being requested. The ref
  // blocks a second request on a fast double click before React re-renders.
  const [resendStatus, setResendStatus] = useState("idle");
  const [resendError, setResendError] = useState(null);
  const resendLock = useRef(false);

  /**
   * The sign-in code in the same email (2026-11). Unlike the link, a code is
   * not tied to the browser that asked for it, so it works when the email is
   * opened on another device or in a mail app's own browser. Requires the
   * Supabase email templates to include {{ .Token }}.
   */
  async function verifyCode(e) {
    e.preventDefault();
    const token = normalizeOtp(code);
    if (!token) {
      setCodeError("Enter the code from the email.");
      return;
    }
    setCodeStatus("verifying");
    setCodeError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

    if (error) {
      setCodeError(OTP_ERROR);
      setCodeStatus("idle");
      return;
    }
    // A full navigation, so the server sees the new session cookie.
    window.location.assign(next ?? "/dashboard");
  }

  /** The one place a sign-in email is requested. Same call for first send and resend. */
  function requestSignInEmail() {
    const supabase = createClient();
    return supabase.auth.signInWithOtp({
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
  }

  async function sendLink(e) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_SHAPE.test(email.trim())) {
      setEmailError("Enter a valid email address, like coach@example.com.");
      return;
    }
    setEmailError(null);
    setStatus("sending");

    const { error } = await requestSignInEmail();

    if (error) {
      setError(error.message);
      setStatus("idle");
    } else {
      setResendError(null);
      setResendStatus("idle");
      setStatus("sent");
    }
  }

  async function resend() {
    if (resendLock.current) return;
    resendLock.current = true;
    setResendStatus("sending");
    setResendError(null);

    const { error } = await requestSignInEmail();

    resendLock.current = false;
    if (error) {
      // Stay on this screen. Whatever the person already typed is kept.
      setResendError(error.message);
      setResendStatus("idle");
      return;
    }
    // A new email carries a new code, so the old entry can no longer be right.
    setCode("");
    setCodeError(null);
    setCodeStatus("idle");
    setResendStatus("resent");
  }

  return (
    <div className="login-wrap lg">
      <div className="login-box">
        <div className="login-brand">
          <span className="lg-brand">
            <LogoMark size={40} tone="mono" />
            <span className="lg-word">Season Tempo</span>
          </span>
        </div>

        <h1 className="login-title">{copy.title}</h1>
        <p className="login-tag">{copy.lede}</p>

        <div className="card">
          {status === "sent" ? (
            <div role="status" aria-live="polite">
              {/* A new sending domain means links can be slow or spam-filed.
                  Saying so up front costs nothing and prevents the coach
                  concluding the product is broken. */}
              <h2 className="login-sent-title">Check your email</h2>
              <p className="login-sent-body">
                We sent a sign-in link and a code to <strong>{email}</strong>. It usually
                arrives within a minute. If you don&rsquo;t see it, check your spam or junk
                folder.
              </p>

              <form className="login-code" onSubmit={verifyCode} noValidate>
                {codeError && (
                  <div className="alert alert-error" role="alert">
                    {codeError}
                  </div>
                )}
                <div className="field">
                  <label htmlFor="code">Enter the code instead</label>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-invalid={codeError ? "true" : undefined}
                    pattern="[0-9]*"
                    maxLength={12}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <p className="field-note">
                    Handy if you&rsquo;re reading the email on another device.
                  </p>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  disabled={codeStatus === "verifying"}
                >
                  {codeStatus === "verifying" ? "Signing in…" : "Sign in with code"}
                </button>
              </form>

              {resendError && (
                <div className="alert alert-error" role="alert" id="resend-error">
                  {resendError}
                </div>
              )}
              {resendStatus === "resent" && (
                <p className="login-resent">
                  A new link and code are on the way. The earlier ones no longer work.
                </p>
              )}

              <div className="login-sent-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={resendStatus === "sending"}
                  aria-busy={resendStatus === "sending" ? "true" : undefined}
                  aria-describedby={resendError ? "resend-error" : undefined}
                  onClick={resend}
                >
                  {resendStatus === "sending" ? "Sending…" : "Resend link"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setStatus("idle");
                    setCode("");
                    setCodeError(null);
                    setResendError(null);
                    setResendStatus("idle");
                  }}
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={sendLink} noValidate>
              {error ? (
                <div className="alert alert-error" role="alert">{error}</div>
              ) : (
                linkError && <div className="alert alert-error" role="alert">{linkError}</div>
              )}

              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  aria-invalid={emailError ? "true" : undefined}
                  aria-describedby={emailError ? "email-error" : undefined}
                  placeholder="coach@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                />
                {emailError && (
                  <p id="email-error" className="field-error" role="alert">{emailError}</p>
                )}
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

        <p className="login-legal">
          By continuing you agree to our{" "}
          <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
          <br />
          Trouble signing in? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>

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
