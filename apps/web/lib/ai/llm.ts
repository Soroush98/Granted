import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// One client per process. The SDK handles retries (default max_retries=2)
// and timeouts internally — no need to wrap.
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/**
 * Single-shot chat that returns a parsed JSON object. Backed by Claude's
 * Messages API with `output_config.format` for strict schema enforcement when
 * `schema` is provided.
 *
 * Was previously an Ollama wrapper using `format: "json"`; the public shape
 * is preserved so call sites only need to pass `schema` to opt into strict
 * validation. `temperature` is accepted for backwards compatibility but
 * ignored — Opus 4.7 rejects sampling parameters.
 */
export async function chatJson<T = unknown>(opts: {
  system: string;
  user: string;
  schema?: Record<string, unknown>;
  /** @deprecated ignored — Opus 4.7 doesn't accept sampling params */
  temperature?: number;
}): Promise<T> {
  // `effort` is only valid on Opus 4.5+ and Sonnet 4.6 — Haiku 4.5 and
  // Sonnet 4.5 return 400 if it's set. Detect Haiku/Sonnet-4.5 and omit it.
  const supportsEffort =
    !env.ANTHROPIC_MODEL.includes("haiku") &&
    !env.ANTHROPIC_MODEL.startsWith("claude-sonnet-4-5");

  const outputConfig: Record<string, unknown> = {};
  if (supportsEffort) outputConfig.effort = "low";
  if (opts.schema) outputConfig.format = { type: "json_schema", schema: opts.schema };

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    output_config: outputConfig,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });

  // With output_config.format, the model emits exactly one text block whose
  // content is JSON matching the schema. Concat all text blocks for safety.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text) throw new Error("Claude returned no text content");
  return JSON.parse(text) as T;
}
