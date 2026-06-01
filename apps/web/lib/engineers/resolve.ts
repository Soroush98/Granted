import "server-only";
import { GitHubClient } from "./github";
import { cleanCompanyName } from "./names";
import type { Engineer, EngineerSource, ResolvedCompany } from "./types";

export type ResolvedEngineers = {
  source: EngineerSource;
  github_org: string | null;
  engineers: Engineer[];
};

/**
 * Hybrid sourcing for a company's engineers:
 *   1. Try to resolve a GitHub org for the company. If found, list its public
 *      members — the accurate path (these people really are at the org).
 *   2. Otherwise fall back to a GitHub user search by the `company:` profile
 *      field — broader coverage for companies without a (resolvable) org.
 *
 * The org path can still come up empty (private membership, tiny org); when it
 * does we fall through to search so the lookup isn't a dead end.
 */
export async function resolveEngineers(
  company: ResolvedCompany,
  limit: number,
): Promise<ResolvedEngineers> {
  const gh = new GitHubClient();
  // Match on a cleaned core name ("IBM Canada Limited - IBM Canada Ltée" →
  // "IBM Canada") so legal suffixes / bilingual duplicates don't block org and
  // user-search matching.
  const name = cleanCompanyName(company.display_name);

  const org = await gh.resolveOrgMembers(name, company.website, limit);
  if (org && org.engineers.length > 0) {
    return { source: "org", github_org: org.login, engineers: org.engineers };
  }

  const engineers = await gh.searchEngineers(name, limit);
  return { source: "search", github_org: null, engineers };
}
