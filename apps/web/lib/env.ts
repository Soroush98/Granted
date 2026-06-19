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

  // No default: an unset secret must DISABLE the revalidate webhook (the route
  // fails closed), never fall back to a guessable shared value.
  REVALIDATE_SECRET: z.string().min(8).optional(),

  // Origin lock for the AI-cost paths (see proxy.ts). When set, Cloudflare
  // stamps this as the x-origin-verify header and the app rejects AI requests
  // that lack it (i.e. that bypassed the WAF by hitting the origin directly).
  // OPT-IN: leave unset until the Cloudflare header rule is live. Read directly
  // from process.env in proxy (edge runtime), declared here for docs/parity.
  ORIGIN_VERIFY_SECRET: z.string().min(16).optional(),

  // Cloudflare Turnstile (bot defense on the finder forms). BOTH optional:
  // when the secret is absent, verifyTurnstile() fails OPEN so local dev and
  // pre-setup deploys keep working. The site key is NEXT_PUBLIC_ so the client
  // widget can read it directly via process.env.
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),

  // Stripe (Job Hunt Pass). Optional so the app boots before they're set;
  // the checkout/webhook routes guard on their presence.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  // Display-only price label for the /pass page (e.g. "$29"). The REAL price
  // lives on the Stripe Price object — keep the two in sync.
  NEXT_PUBLIC_PASS_PRICE: z.string().optional(),

  // Resend (transactional email). RESEND_FROM is the verified sender.
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().default("Granted <onboarding@resend.dev>"),

  // Absolute origin for Stripe redirect + email links. Defaults to local dev.
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
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
  ORIGIN_VERIFY_SECRET: process.env.ORIGIN_VERIFY_SECRET,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  NEXT_PUBLIC_PASS_PRICE: process.env.NEXT_PUBLIC_PASS_PRICE,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
