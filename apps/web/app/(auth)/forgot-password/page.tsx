"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/db/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Land on the callback, which exchanges the recovery code, then sends the
      // user to /reset-password with an active session to set a new password.
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">
        Enter your email and we&rsquo;ll send you a link to set a new password.
      </p>
      {sent ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          If an account exists for <span className="font-medium">{email}</span>, a reset link is on
          its way. Check your inbox.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary focus-ring rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="mt-4 text-sm text-[var(--color-muted)]">
        <Link href="/login" className="underline">Back to log in</Link>
      </p>
    </section>
  );
}
