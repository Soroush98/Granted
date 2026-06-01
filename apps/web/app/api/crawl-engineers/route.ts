import { env } from "@/lib/env";
import { supabaseService } from "@/lib/db/supabase-server";
import { GitHubClient } from "@/lib/engineers/github";
import { getOrFetchDirectory } from "@/lib/engineers/directory";

export const maxDuration = 300;

/**
 * Admin batch crawler that warms engineer_directories across the top-funded
 * Canadian companies. Stateless and resumable: each call asks the DB for the
 * next slice of not-yet-crawled companies (next_engineer_crawl_batch) and
 * processes them through the normal cache-first pipeline, so 'ready' rows
 * (including empty 0-engineer results) drop out and repeated calls converge.
 *
 * Self-paces against the GitHub core rate limit: if the remaining budget can't
 * cover a batch it returns { paused, retryAfterSec } instead of processing, so
 * the caller can sleep and retry rather than hang mid-batch.
 *
 * Gated by REVALIDATE_SECRET. Drive it with a loop:
 *   while not done: GET /api/crawl-engineers?secret=…&max=300&batch=6
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== env.REVALIDATE_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const max = clamp(Number(url.searchParams.get("max")) || 300, 1, 5000);
  const batch = clamp(Number(url.searchParams.get("batch")) || 6, 1, 20);

  const supabase = supabaseService();
  const { data: companies, error } = await supabase.rpc("next_engineer_crawl_batch", {
    max_companies: max,
    batch_size: batch,
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!companies || companies.length === 0) {
    return Response.json({ done: true, processed: [] });
  }

  // Pace: bail out (let the caller sleep) if we can't cover this batch's core
  // budget. ~70 core calls per company (1 user + 1 repos × ~24, plus members).
  const gh = new GitHubClient();
  const rl = await gh.rateLimit();
  const needed = batch * 70;
  if (rl.remaining < needed) {
    const retryAfterSec = Math.max(5, Math.ceil((rl.resetMs - Date.now()) / 1000));
    return Response.json({
      paused: true,
      retryAfterSec,
      remaining: rl.remaining,
      needed,
    });
  }

  const processed: Array<Record<string, unknown>> = [];
  for (const c of companies) {
    try {
      const r = await getOrFetchDirectory({
        id: c.id,
        display_name: c.display_name,
        province: c.province,
        city: c.city,
        website: c.website,
      });
      processed.push({
        company: c.display_name,
        source: r.source,
        github_org: r.github_org,
        count: r.engineers.length,
      });
    } catch (e) {
      processed.push({
        company: c.display_name,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  }

  return Response.json({ done: false, batch: processed.length, processed });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
