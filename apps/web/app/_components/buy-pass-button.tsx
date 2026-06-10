"use client";

import { useState } from "react";

// Starts Stripe Checkout for the Job Hunt Pass and redirects to the hosted page.
export function BuyPassButton({ label = "Get the Job Hunt Pass" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return; // leaving the page
      }
      setError(data.error ?? "Checkout is unavailable right now.");
    } catch {
      setError("Couldn't start checkout. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="btn-primary focus-ring rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "Starting checkout…" : label}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
