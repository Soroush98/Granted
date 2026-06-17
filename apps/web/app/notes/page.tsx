import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { supabaseServer, supabaseService } from "@/lib/db/supabase-server";
import { RerunButton } from "@/app/_components/rerun-button";

export const metadata: Metadata = { title: "My field notes — Granted" };

// Where a logged search came from, and where a re-run should go.
function finderFor(orgFilter: string | null): { path: string; label: string } {
  if (orgFilter === "company") return { path: "/jobs", label: "find a job" };
  if (orgFilter === "university") return { path: "/supervisors", label: "find a supervisor" };
  if (orgFilter?.startsWith("pi:")) return { path: "/research-pi", label: "find a PI" };
  return { path: "/search", label: "search" };
}

export default function NotesPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-8 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          My <span className="text-gradient">searches</span>
        </h1>
        <p className="mx-auto mt-3 text-base leading-relaxed text-[var(--color-muted)]">
          Every search you&rsquo;ve run — re-run one, or branch it into a new angle.
        </p>
      </header>

      <Suspense fallback={<NotesSkeleton />}>
        <NotesList />
      </Suspense>
    </section>
  );
}

async function NotesList() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    return (
      <div className="paper p-6 text-center">
        <p className="font-semibold">Your notebook lives on your account.</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Sign in and every search you run is kept here — ready to re-run when new grants land.
        </p>
        <div className="mt-4 flex justify-center gap-3 text-sm">
          <Link href="/signup" className="btn-primary focus-ring px-5 py-2 font-semibold">
            Sign up free
          </Link>
          <Link href="/login" className="self-center underline">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  const { data: rows } = await supabaseService()
    .from("search_log")
    .select("id, query, org_filter, result_count, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!rows || rows.length === 0) {
    return (
      <div className="paper p-6 text-center">
        <p className="font-semibold">No entries yet.</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Run your first search and it&rsquo;ll be pinned here.
        </p>
        <Link href="/jobs" className="btn-primary focus-ring mt-4 inline-block px-5 py-2 text-sm font-semibold">
          Find companies →
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-3">
      {rows.map((r) => {
        const finder = finderFor(r.org_filter);
        return (
          <li key={r.id} className="paper p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.1em] text-[var(--color-muted)]">
                  {new Date(r.created_at).toLocaleDateString()} · {finder.label}
                  {typeof r.result_count === "number" && ` · ${r.result_count} matches`}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink)]">{r.query}</p>
              </div>
              <RerunButton path={finder.path} query={r.query} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function NotesSkeleton() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--color-border)]/50" />
      ))}
    </div>
  );
}
