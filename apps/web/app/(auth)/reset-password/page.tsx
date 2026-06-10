"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabase-browser";

// Reached after the recovery link → /auth/callback established a session. Sets
// a new password via updateUser, then sends the user home.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true);
    setTimeout(() => router.push("/"), 1200);
  }

  return (
    <section className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--color-muted)]">Choose a new password for your account.</p>
      {done ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Password updated — taking you home…
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-black/40"
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary focus-ring rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {busy ? "…" : "Update password"}
          </button>
        </form>
      )}
    </section>
  );
}
