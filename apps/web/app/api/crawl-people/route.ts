import { env } from "@/lib/env";
import { supabaseService } from "@/lib/db/supabase-server";
import { GitHubClient } from "@/lib/engineers/github";
import { crawlShardPage, mapPeopleToCompanies } from "@/lib/people/crawl";

export const maxDuration = 300;

/**
 * Admin person-pool crawler. Two modes, both gated by REVALIDATE_SECRET:
 *
 *   ?secret=…&city=Toronto&language=Python&page=1
 *     Crawl one (city, language, page) shard into gh_people. Resumable: a page
 *     already in gh_people_shards is skipped. Self-paces against the GitHub core
 *     rate limit (returns { paused, retryAfterSec } when budget is short).
 *
 *   ?secret=…&map=1&batch=200
 *     Map unmapped people to the companies table via fuzzy name match.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== env.REVALIDATE_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // --- mapping mode ---
  if (url.searchParams.get("map") === "1") {
    const batch = clamp(Number(url.searchParams.get("batch")) || 200, 1, 1000);
    const result = await mapPeopleToCompanies(batch);
    return Response.json({ mode: "map", ...result });
  }

  // --- shard crawl mode ---
  const city = (url.searchParams.get("city") ?? "").trim();
  const language = (url.searchParams.get("language") ?? "").trim();
  const page = clamp(Number(url.searchParams.get("page")) || 1, 1, 10);
  if (!city || !language) {
    return Response.json({ error: "city and language required" }, { status: 400 });
  }

  const supabase = supabaseService();
  const shard = `${city}|${language}|${page}`;

  // Resume: skip a page we've already finished.
  const { data: done } = await supabase
    .from("gh_people_shards")
    .select("shard, found, total_count")
    .eq("shard", shard)
    .maybeSingle();
  if (done) {
    return Response.json({ skipped: true, shard, found: done.found, total: done.total_count });
  }

  // Pace against the core budget (~70 calls per 100 hydrated people).
  const gh = new GitHubClient();
  const rl = await gh.rateLimit();
  if (rl.remaining < 220) {
    return Response.json({
      paused: true,
      retryAfterSec: Math.max(5, Math.ceil((rl.resetMs - Date.now()) / 1000)),
      remaining: rl.remaining,
    });
  }

  const result = await crawlShardPage(city, language, page);
  await supabase.from("gh_people_shards").upsert(
    {
      shard,
      city,
      language,
      page,
      total_count: result.total,
      found: result.fetched,
    },
    { onConflict: "shard" },
  );

  // hasMore: more pages exist within GitHub's 1000 cap and this page was full.
  const hasMore = result.fetched === 100 && page < 10 && page * 100 < result.total;
  return Response.json({ ...result, hasMore });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
