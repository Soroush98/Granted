import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

// Browser-side Supabase client for the auth forms (sign up / log in / reset).
// Reads the public env vars directly (this module ships to the client, so it
// must NOT import the server-only lib/env). NEXT_PUBLIC_* are inlined at build.
export function supabaseBrowser() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
