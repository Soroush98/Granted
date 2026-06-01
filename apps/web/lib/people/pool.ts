import "server-only";
import { supabaseService } from "@/lib/db/supabase-server";
import type { PublicEngineer } from "@/lib/engineers/types";

const POOL_LIMIT = 50;

/** People from the Canadian GitHub pool (gh_people) who self-report this company
 * as their employer, most-followed first. This is what lets a funded company
 * surface referral candidates even when it has no public GitHub org. Best-effort
 * — returns [] if the gh_people table isn't there yet. */
export async function poolForCompany(companyId: string): Promise<PublicEngineer[]> {
  try {
    const supabase = supabaseService();
    const { data, error } = await supabase
      .from("gh_people")
      .select("*")
      .eq("mapped_company_id", companyId)
      .order("followers", { ascending: false })
      .limit(POOL_LIMIT);
    if (error || !data) return [];
    return data.map(rowToPublicEngineer);
  } catch {
    return [];
  }
}

/** Merge two engineer lists, de-duping by login (case-insensitive). `primary`
 * wins on conflict and keeps its order; `extra` is appended. */
export function mergeByLogin(
  primary: PublicEngineer[],
  extra: PublicEngineer[],
): PublicEngineer[] {
  const seen = new Set(primary.map((e) => e.login.toLowerCase()));
  const out = [...primary];
  for (const e of extra) {
    const k = e.login.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

function rowToPublicEngineer(r: Record<string, unknown>): PublicEngineer {
  return {
    id: String(r.github_id),
    github_id: r.github_id as number,
    login: r.login as string,
    name: (r.name as string) ?? null,
    avatar_url: (r.avatar_url as string) ?? null,
    html_url: (r.html_url as string) ?? null,
    bio: (r.bio as string) ?? null,
    company: (r.company as string) ?? null,
    location: (r.location as string) ?? null,
    blog: (r.blog as string) ?? null,
    followers: (r.followers as number) ?? 0,
    public_repos: (r.public_repos as number) ?? 0,
    top_languages: Array.isArray(r.top_languages) ? (r.top_languages as string[]) : [],
    hireable: (r.hireable as boolean) ?? null,
  };
}
