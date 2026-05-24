"use client";

import { useEffect, useState } from "react";
import { loadStashedResume } from "@/lib/resume-stash";

type Stash = { name: string; url: string };

/** Reads the PDF the user picked on the home page from IndexedDB and embeds
 * it in an <iframe> via a blob: URL. Renders nothing if no resume was stashed
 * (e.g. text-only search, private browsing, or the user landed on /search
 * directly via a shared link). */
export function PdfPreview() {
  const [stash, setStash] = useState<Stash | null>(null);

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const entry = await loadStashedResume().catch(() => null);
      if (!entry) return;
      url = URL.createObjectURL(entry.blob);
      setStash({ name: entry.name, url });
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  if (!stash) return null;

  return (
    <details className="mb-6 rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer select-none font-medium">
        Preview uploaded PDF
        <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">({stash.name})</span>
      </summary>
      <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-black/5">
        <iframe
          src={stash.url}
          title={`Preview of ${stash.name}`}
          className="block h-[70vh] w-full"
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Stored only in your browser (IndexedDB) — never uploaded for preview.
      </p>
    </details>
  );
}
