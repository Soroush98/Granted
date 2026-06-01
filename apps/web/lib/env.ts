import "server-only";
import { z } from "zod";

const ServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_LLM_MODEL: z.string().default("qwen3:8b"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"), // legacy; embeddings now via Voyage

  VOYAGE_API_KEY: z.string().min(10),
  VOYAGE_EMBED_MODEL: z.string().default("voyage-3.5"),

  ANTHROPIC_API_KEY: z.string().min(20),
  ANTHROPIC_MODEL: z.string().default("claude-opus-4-7"),

  REVALIDATE_SECRET: z.string().min(8).default("changeme"),

  // "Am I Competitive?" section. `mock` (default) serves synthetic cohorts so
  // the whole flow runs locally with zero spend; `apify` hits the paid actor.
  TALENT_PROVIDER: z.enum(["mock", "apify"]).default("mock"),
  // Optional so a mock-only deploy doesn't need them. ApifyProvider checks at
  // call time and fails loudly if they're missing when TALENT_PROVIDER=apify.
  APIFY_TOKEN: z.string().optional(),
  // HarvestAPI's linkedin-profile-search returns full profiles from a single
  // search run (company + title filters), so no separate profile-scrape actor.
  // Requires a one-time permissions approval in the Apify console.
  APIFY_SEARCH_ACTOR: z.string().default("harvestapi~linkedin-profile-search"),
  // "Short" ($0.1 / page, ~25 profiles, no skills/experience) vs "Full"
  // ($0.1 / page + $0.004 / profile, with skills/experience/about).
  APIFY_PROFILE_MODE: z.enum(["Short", "Full", "Full + email search"]).default("Full"),
  // Days a cached cohort stays valid before a re-fetch is allowed.
  COHORT_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // "Engineers" section. A GitHub token for the API calls that source a
  // company's engineers (user search needs auth; unauthenticated public reads
  // are throttled to 60/hr). Optional so a deploy that doesn't use the section
  // still boots; GitHubClient checks at call time and fails loudly if missing.
  // A classic PAT with no scopes (or read:org) is enough for public data.
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_API_BASE: z.string().url().default("https://api.github.com"),
  // Days a cached engineer directory stays valid before a re-fetch is allowed.
  ENGINEERS_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export const env = ServerEnv.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  OLLAMA_LLM_MODEL: process.env.OLLAMA_LLM_MODEL,
  OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL,
  VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
  VOYAGE_EMBED_MODEL: process.env.VOYAGE_EMBED_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
  TALENT_PROVIDER: process.env.TALENT_PROVIDER,
  APIFY_TOKEN: process.env.APIFY_TOKEN,
  APIFY_SEARCH_ACTOR: process.env.APIFY_SEARCH_ACTOR,
  APIFY_PROFILE_MODE: process.env.APIFY_PROFILE_MODE,
  COHORT_TTL_DAYS: process.env.COHORT_TTL_DAYS,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_API_BASE: process.env.GITHUB_API_BASE,
  ENGINEERS_TTL_DAYS: process.env.ENGINEERS_TTL_DAYS,
});
