"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabase-browser";

// Email/password sign-up + log-in form. Used by the /login and /signup pages
// and (with onSuccess) by the inline AuthModal. Sign-up requires email
// verification — we tell the user to check their inbox rather than logging in.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = supabaseBrowser();
    try {
      if (mode === "signup") {
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
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border border-black/15 bg-white px-3 py-2 outline-none focus:border-black/40"
        />
      </label>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="btn-primary focus-ring mt-1 rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
      </button>

      {mode === "login" && (
        <Link href="/forgot-password" className="text-xs text-[var(--color-muted)] underline">
          Forgot your password?
        </Link>
      )}
    </form>
  );
}
