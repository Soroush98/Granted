import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

// POST /api/revalidate { "tags": ["search", "company:<id>"] }
// Called by the ingestion pipeline after a successful upsert to bust the
// relevant `'use cache'` boundaries. Authorize with a shared secret.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.REVALIDATE_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { tags?: string[] };
  const tags = body.tags ?? [];
  // Next 16: revalidateTag requires a cacheLife profile as the second arg.
  for (const tag of tags) revalidateTag(tag, "default");
  return NextResponse.json({ ok: true, revalidated: tags });
}
