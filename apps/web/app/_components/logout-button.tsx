"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/db/supabase-browser";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.push("/");
        router.refresh();
      }}
      className="text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:underline"
    >
      Log out
    </button>
  );
}
