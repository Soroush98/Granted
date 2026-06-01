import "server-only";
import { supabaseService } from "@/lib/db/supabase-server";
import type { ResolvedCompany } from "./types";

/** Resolve a free-text company name to a Canadian company in the `companies`
 * table. This is what scopes the section to Canadian, funded-R&D orgs: only a
 * name that matches a row can be looked up. Returns null when nothing matches.
 *
 * Uses the trigram-backed `search_companies_by_name` RPC (same one /search
 * uses), then reads the full row for the website needed to verify a GitHub org. */
export async function resolveCompany(name: string): Promise<ResolvedCompany | null> {
  const supabase = supabaseService();
  const { data: hits } = await supabase.rpc("search_companies_by_name", {
    q: name,
    max_results: 1,
    min_similarity: 0.3,
  });
  const hit = hits?.[0];
  if (!hit) return null;

  const { data: row } = await supabase
    .from("companies")
    .select("id, display_name, province, city, website")
    .eq("id", hit.company_id)
    .maybeSingle();
  if (!row) return null;

  return {
    id: row.id,
    display_name: row.display_name,
    province: row.province,
    city: row.city,
    website: row.website,
  };
}
