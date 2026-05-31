import "server-only";
import { env } from "@/lib/env";
import type { RawProfile } from "./types";
import { ApifyProvider } from "./apify";
import { MockProvider } from "./mock";

/** Provider-agnostic seam for sourcing a cohort of profiles. Implementations
 * own whatever multi-step dance their backend needs (search → scrape → poll);
 * callers just await `fetchCohort` and get normalized RawProfiles back.
 *
 * Swappable so the rest of the app never imports Apify directly — pick a new
 * vendor (Bright Data, LinkdAPI) by adding an implementation + an env case. */
export interface ProfileProvider {
  readonly name: string;
  /** Fetch up to `limit` recent profiles for people in `role` at `company`.
   * May be slow (real scrapers take 30–120s). Throws on hard failure. */
  fetchCohort(company: string, role: string, limit: number): Promise<RawProfile[]>;
}

let cached: ProfileProvider | null = null;

export function getProvider(): ProfileProvider {
  if (cached) return cached;
  cached = env.TALENT_PROVIDER === "apify" ? new ApifyProvider() : new MockProvider();
  return cached;
}
