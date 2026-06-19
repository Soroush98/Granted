import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

// Public-read client (uses anon key + RLS). Use for everything the user-facing app reads.
export function supabaseAnon() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

// Service-role client. Bypasses RLS — never expose to the browser.
// Use for writes from Server Actions or webhook routes.
export function supabaseService() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Cookie-aware client bound to the request's auth session. Use in Server
// Components / route handlers / actions to read the logged-in user
// (`supabase.auth.getUser()`). Session cookie refresh is handled by proxy.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set({ name, value, ...options }),
            );
          } catch {
            // Called from a Server Component (read-only cookies) — safe to
            // ignore; proxy writes the refreshed session cookie.
          }
        },
      },
    },
  );
}
