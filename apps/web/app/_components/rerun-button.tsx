"use client";

import { useRouter } from "next/navigation";
import { PREFILL_KEY } from "./spike-finder";

// Re-run a past search from /notes. Finder searches hand the full background
// over via sessionStorage (too long for a URL); /search re-runs ride the URL
// (that page reads `q` as a GET param and runs immediately).
export function RerunButton({ path, query }: { path: string; query: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (path === "/search") {
          router.push(`/search?q=${encodeURIComponent(query.slice(0, 1500))}`);
        } else {
          sessionStorage.setItem(PREFILL_KEY, query);
          router.push(path);
        }
      }}
      className="shrink-0 rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
    >
      Re-run →
    </button>
  );
}
