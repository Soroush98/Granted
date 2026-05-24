"use client";

import { useEffect, useId, useRef, useState } from "react";
import { stashResume, clearStashedResume } from "@/lib/resume-stash";

/** File input that ALSO stashes the chosen PDF in IndexedDB so /search can
 * show a preview later. The DOM input keeps name="resume" so the existing
 * server-action form picks it up unchanged. */
export function ResumeInput() {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  // Explicit reset on every mount and on bfcache restore. Without this,
  // browsers restore the previously-selected file when the user back-navigates
  // to the homepage — the input *looks* empty but FormData.get("resume") still
  // returns the old File, so the next "fresh" search silently includes the
  // previous PDF. Also clears the IndexedDB stash so the /search PDF preview
  // doesn't show stale content on the next visit.
  useEffect(() => {
    const reset = () => {
      if (inputRef.current && inputRef.current.value) {
        inputRef.current.value = "";
      }
      setPicked(null);
      // Best-effort; IDB may be unavailable (private mode).
      void clearStashedResume().catch(() => {});
    };
    reset();
    const onPageShow = (e: PageTransitionEvent) => {
      // persisted=true means the page came from bfcache, where DOM state
      // (including file selections) is restored verbatim.
      if (e.persisted) reset();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      await clearStashedResume().catch(() => {});
      setPicked(null);
      return;
    }
    if (file.type && file.type !== "application/pdf") {
      // The server action also rejects, but warn early.
      setPicked(`${file.name} (not a PDF — will be rejected)`);
      await clearStashedResume().catch(() => {});
      return;
    }
    try {
      await stashResume(file);
    } catch {
      // IndexedDB may be unavailable (private mode, etc.). Preview just won't show.
    }
    setPicked(file.name);
  }

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        name="resume"
        accept="application/pdf,.pdf"
        onChange={handleChange}
        className="block w-full rounded-2xl border border-black/10 bg-white p-3 text-sm shadow-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--color-ink)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:opacity-90"
      />
      {picked && (
        <p className="text-xs text-[var(--color-muted)]">Selected: {picked}</p>
      )}
    </>
  );
}
