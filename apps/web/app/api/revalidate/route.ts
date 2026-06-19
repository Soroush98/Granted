import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// POST /api/revalidate { "tags": ["search", "company:<id>"] }
// Called by the ingestion pipeline after a successful upsert to bust the
// relevant `'use cache'` boundaries. Authorize with a shared bearer secret.

/** Constant-time bearer check. Fails closed when the secret is unset. */
function authorized(header: string | null): boolean {
  if (!env.REVALIDATE_SECRET || !header) return false;
  const expected = Buffer.from(`Bearer ${env.REVALIDATE_SECRET}`);
  const got = Buffer.from(header);
  // timingSafeEqual throws on length mismatch, so guard length first. The
  // length itself is not secret (the prefix is fixed), so this is fine.
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { tags?: string[] };
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 100) : [];
  // Next 16: revalidateTag requires a cacheLife profile as the second arg.
  for (const tag of tags) revalidateTag(tag, "default");
  return NextResponse.json({ ok: true, revalidated: tags });
}
