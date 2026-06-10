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
