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
});
