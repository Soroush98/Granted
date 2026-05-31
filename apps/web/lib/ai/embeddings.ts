import "server-only";
import { env } from "@/lib/env";

// Voyage AI voyage-3.5 → 1024-dim. Asymmetric encoder: input_type='query' for
// user queries, 'document' for corpus chunks (which the Python ingester sets).
export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: [text],
      model: env.VOYAGE_EMBED_MODEL,
      input_type: "query",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  const vec = json.data?.[0]?.embedding;
  if (!vec) throw new Error("Voyage returned no embedding");
  return vec;
}

// Batch embed corpus documents (input_type='document') in one round-trip — used
// to embed a whole talent cohort (~20 profiles) at fetch time. voyage-3.5 takes
// up to ~1000 inputs per call, so a single cohort always fits. Returns vectors
// in the same order as `texts`.
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: texts,
      model: env.VOYAGE_EMBED_MODEL,
      input_type: "document",
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed (batch) failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };
  const data = json.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(`Voyage returned ${data.length} embeddings for ${texts.length} inputs`);
  }
  // Voyage may return out of order — sort by index to realign with `texts`.
  return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
