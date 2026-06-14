"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabase-browser";

// Email/password + Google sign-up / log-in form. Used by the /login and /signup
// pages and (with onSuccess) by the inline AuthModal. Sign-up requires email
// verification — we tell the user to check their inbox rather than logging in.

// Password requirements for sign-up. Mirror these in the Supabase dashboard
// (Authentication → Policies) so the server agrees with this client check.
const PASSWORD_RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "Upper- and lower-case letters", test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: "At least one number", test: (p) => /\d/.test(p) },
];

export function AuthForm({
  mode,
  onSuccess,
}: {
  mode: "login" | "signup";
  /** Called after a successful LOGIN (signup just shows "check your email"). */
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const isSignup = mode === "signup";
  const rulesPassed = PASSWORD_RULES.map((r) => r.test(password));
  const passwordValid = rulesPassed.every(Boolean);
  const passwordsMatch = password === confirm;

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    // On success the browser is redirected to Google, so nothing below runs.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (isSignup) {
      if (!passwordValid) return setError("Please meet all the password requirements below.");
      if (!passwordsMatch) return setError("Passwords don't match.");
    }

    setBusy(true);
    const supabase = supabaseBrowser();
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) return setError(error.message);
        // Confirmations on → no session yet; prompt to verify.
        if (!data.session) return setSent(true);
        onSuccess ? onSuccess() : router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return setError(error.message);
        onSuccess ? onSuccess() : router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1">
          We sent a confirmation link to <span className="font-medium">{email}</span>. Click it to
          verify your account, then come back and search.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        className="focus-ring flex items-center justify-center gap-2 rounded-full border border-black/15 bg-white px-5 py-2 text-sm font-semibold text-[var(--color-ink)] transition-colors hover:bg-black/[0.03] disabled:opacity-60"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
        <span className="h-px flex-1 bg-black/10" />
        or with email
        <span className="h-px flex-1 bg-black/10" />
      </div>

      <form onSubmit={onSubmit} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 outline-none focus:border-black/40"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 outline-none focus:border-black/40"
          />
        </label>

        {isSignup && (
          <>
            <ul className="grid gap-0.5 text-xs">
              {PASSWORD_RULES.map((r, i) => {
                const ok = password.length > 0 && rulesPassed[i];
                return (
                  <li
                    key={r.label}
                    className={ok ? "text-emerald-700" : "text-[var(--color-muted)]"}
                  >
                    {ok ? "✓" : "○"} {r.label}
                  </li>
                );
              })}
            </ul>

            <label className="grid gap-1 text-sm">
              <span className="font-medium">Confirm password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="rounded-xl border border-black/15 bg-white px-3 py-2 outline-none focus:border-black/40"
              />
              {confirm.length > 0 && !passwordsMatch && (
                <span className="text-xs text-red-700">Passwords don&rsquo;t match.</span>
              )}
            </label>
          </>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || (isSignup && (!passwordValid || !passwordsMatch))}
          className="btn-primary focus-ring mt-1 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? "…" : isSignup ? "Create account" : "Log in"}
        </button>

        {mode === "login" && (
          <Link href="/forgot-password" className="text-xs text-[var(--color-muted)] underline">
            Forgot your password?
          </Link>
        )}
      </form>
    </div>
  );
}

// Google "G" mark.
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
