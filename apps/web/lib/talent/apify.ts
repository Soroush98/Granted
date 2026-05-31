import "server-only";
import { env } from "@/lib/env";
import type { ProfileProvider } from "./provider";
import type { RawProfile } from "./types";
import { rawFromApifyItem } from "./normalize";

/**
 * Apify-backed provider using HarvestAPI's `linkedin-profile-search` actor.
 *
 * One step: a search filtered by company + job title returns full profiles
 * directly (HarvestAPI is "no cookies" and returns skills/experience/about in
 * "Full" mode), so there's no separate URL-search → profile-scrape dance.
 *
 * Pricing (pay-per-result): Full mode ≈ $0.1 per search page + $0.004 per
 * profile → ~$0.18 for a 20-person cohort. Cohorts are cached in talent_cohorts
 * (see cohort.ts) so this only runs on a cache miss.
 *
 * One-time setup: the HarvestAPI actor needs permission approval on your Apify
 * account. If unapproved, the run returns `full-permission-actor-not-approved`
 * with an approval URL — open it once in the Apify console.
 */
export class ApifyProvider implements ProfileProvider {
  readonly name = "apify";

  async fetchCohort(company: string, role: string, limit: number): Promise<RawProfile[]> {
    if (!env.APIFY_TOKEN) {
      throw new Error(
        "TALENT_PROVIDER=apify but APIFY_TOKEN is unset. Set it in apps/web/.env.local.",
      );
    }

    const maxItems = Math.max(5, limit); // HarvestAPI requires maxItems >= 5
    const mode = env.APIFY_PROFILE_MODE;

    // Progressive broadening. The strict company+title AND is precise but returns
    // nothing at small orgs where few people hold the exact title (e.g. Amii has
    // researchers, not "Data Engineer"s). Fall back to a fuzzy role within the
    // company, then to a free-text search. Stop at the first non-empty result.
    const strategies: Array<Record<string, unknown>> = [
      { currentCompanies: [company], currentJobTitles: [role] },
      { currentCompanies: [company], searchQuery: role },
      { searchQuery: `${role} ${company}` },
    ];

    for (const filter of strategies) {
      const items = await this.runActor(env.APIFY_SEARCH_ACTOR, {
        ...filter,
        maxItems,
        profileScraperMode: mode,
      });
      const profiles = items
        .map((it) => rawFromApifyItem(it))
        .filter((p): p is RawProfile => p !== null);
      if (profiles.length > 0) return profiles.slice(0, limit);
    }

    throw new Error(`No profiles found for "${role}" at "${company}".`);
  }

  /** Run an actor and return its dataset items via run-sync-get-dataset-items
   * (start → wait → items in one HTTP call, no manual polling). Retries
   * transient network / 5xx / 429 with exponential backoff. */
  private async runActor(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const url =
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}` +
      `/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}&timeout=290`;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          // Actor runs are long; don't let a default fetch timeout abort early.
          signal: AbortSignal.timeout(295_000),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new Error(`retryable Apify ${res.status}`);
        }
        if (!res.ok) {
          // 4xx (bad input, unapproved permissions, etc.) — surface verbatim so
          // the operator sees e.g. the approval URL. Don't retry these.
          throw new Error(`Apify actor ${actorId} failed: ${res.status} ${await res.text()}`);
        }
        const json = (await res.json()) as unknown;
        return Array.isArray(json) ? (json as Array<Record<string, unknown>>) : [];
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.message.includes("failed:")) throw e;
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      }
    }
    throw new Error(`Apify actor ${actorId} failed after retries: ${String(lastErr)}`);
  }
}
