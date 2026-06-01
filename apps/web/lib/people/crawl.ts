import "server-only";
import { supabaseService } from "@/lib/db/supabase-server";
import { GitHubClient } from "@/lib/engineers/github";
import type { Engineer } from "@/lib/engineers/types";

export type ShardPageResult = {
  city: string;
  language: string;
  page: number;
  total: number;
  fetched: number;
  upserted: number;
};

/** Crawl one (city, language, page) shard of Canadian GitHub users: list up to
 * 100 logins (most-followed first), hydrate them, and upsert into gh_people.
 * Idempotent — re-running a page just re-upserts the same people. */
export async function crawlShardPage(
  city: string,
  language: string,
  page: number,
): Promise<ShardPageResult> {
  const gh = new GitHubClient();
  const q = `location:"${city}" language:${language} type:user`;
  const { logins, total } = await gh.searchUserLogins(q, page);
  if (logins.length === 0) {
    return { city, language, page, total, fetched: 0, upserted: 0 };
  }

  const people = await gh.hydratePeople(logins);
  const supabase = supabaseService();
  const rows = people.map((p) => toPersonRow(p, `${city}|${language}`));
  if (rows.length > 0) {
    await supabase.from("gh_people").upsert(rows, { onConflict: "github_id" });
  }
  return { city, language, page, total, fetched: logins.length, upserted: rows.length };
}

function toPersonRow(p: Engineer, shard: string) {
  return {
    github_id: p.github_id,
    login: p.login,
    name: p.name,
    avatar_url: p.avatar_url,
    html_url: p.html_url,
    bio: p.bio,
    company: p.company,
    company_norm: normCompany(p.company),
    location: p.location,
    blog: p.blog,
    followers: p.followers,
    public_repos: p.public_repos,
    top_languages: p.top_languages,
    hireable: p.hireable,
    source_shard: shard,
  };
}

/** Light normalization of a GitHub `company` field for grouping/mapping: strip
 * a leading "@", lower-case, collapse whitespace. Distinct values get
 * fuzzy-matched to the companies table by mapPeopleToCompanies(). */
export function normCompany(company: string | null): string | null {
  if (!company) return null;
  const s = company.replace(/^@/, "").toLowerCase().replace(/\s+/g, " ").trim();
  return s || null;
}

export type MapResult = { distinctTried: number; mapped: number; peopleUpdated: number };

/** Map unmapped people to companies by their `company` field, using the
 * trigram-backed search_companies_by_name RPC (the same fuzzy matcher /search
 * uses). Works on the most common company strings first; one RPC per distinct
 * string, then a bulk update of every person who wrote it. */
export async function mapPeopleToCompanies(batch: number): Promise<MapResult> {
  const supabase = supabaseService();
  // Most-frequent unmapped company strings first (cheap RPC amortized widely).
  const { data: rows } = await supabase
    .from("gh_people")
    .select("company")
    .is("mapped_company_id", null)
    .not("company", "is", null)
    .limit(5000);

  const freq = new Map<string, number>();
  for (const r of rows ?? []) {
    const c = (r.company as string | null)?.trim();
    if (c) freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  const distinct = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, batch);

  let mapped = 0;
  let peopleUpdated = 0;
  for (const [company] of distinct) {
    const { data: hits } = await supabase.rpc("search_companies_by_name", {
      q: company.replace(/^@/, ""),
      max_results: 1,
      min_similarity: 0.5,
    });
    const hit = hits?.[0];
    if (!hit) continue;
    mapped += 1;
    const { count } = await supabase
      .from("gh_people")
      .update({ mapped_company_id: hit.company_id }, { count: "exact" })
      .eq("company", company)
      .is("mapped_company_id", null);
    peopleUpdated += count ?? 0;
  }
  return { distinctTried: distinct.length, mapped, peopleUpdated };
}
