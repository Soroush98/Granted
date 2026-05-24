"""Thin Supabase client wrapper + helpers for the few operations we need."""

from __future__ import annotations

import time
from functools import lru_cache, wraps
from typing import Any, Callable, TypeVar

from supabase import Client, create_client

from .config import settings


@lru_cache(maxsize=1)
def client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


_T = TypeVar("_T")


def _is_transient(exc: Exception) -> bool:
    """Errors worth retrying with a fresh HTTP/2 connection.

    Supabase's edge proxy sends GOAWAY after ~20k streams on a single HTTP/2
    connection, which surfaces as RemoteProtocolError on the next request.
    Local socket exhaustion (Errno 35) and statement timeouts (57014) under
    transient load are also retryable."""
    msg = str(exc)
    return (
        "RemoteProtocolError" in type(exc).__name__
        or "ConnectionTerminated" in msg
        or "Errno 35" in msg
        or "57014" in msg
        or "ReadError" in type(exc).__name__
        or "TimeoutException" in type(exc).__name__
    )


def with_retry(fn: Callable[..., _T]) -> Callable[..., _T]:
    """Wrap a Supabase-client-using function with retry-on-transient-error.
    Clears the cached client between attempts so we get a fresh HTTP/2 connection."""
    @wraps(fn)
    def wrapped(*args: Any, **kwargs: Any) -> _T:
        last_exc: Exception | None = None
        for attempt in range(5):
            try:
                return fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001
                if not _is_transient(exc):
                    raise
                last_exc = exc
                client.cache_clear()  # force new client + new HTTP/2 connection
                time.sleep(0.5 * (2 ** attempt))
        raise RuntimeError(f"{fn.__name__} failed after 5 attempts: {last_exc}")
    return wrapped


@with_retry
def get_program_id(code: str) -> str:
    """Look up a funding_programs.id by short code (e.g. 'NSERC_ALLIANCE')."""
    res = client().table("funding_programs").select("id").eq("code", code).single().execute()
    if not res.data:
        raise RuntimeError(f"funding_programs.code={code!r} not found — did the migration run?")
    return res.data["id"]


@with_retry
def upsert_company(row: dict[str, Any]) -> str:
    """Insert (or fetch existing by normalized_name+org_type) and return the company id.

    Supabase's upsert with on_conflict needs the unique columns spelled out.
    """
    res = (
        client()
        .table("companies")
        .upsert(row, on_conflict="normalized_name,org_type")
        .execute()
    )
    return res.data[0]["id"]


@with_retry
def upsert_grant(row: dict[str, Any]) -> str | None:
    """Idempotent grant insert keyed on (program_id, award_id). Returns id, or None
    if no award_id was provided (we can't dedupe without one)."""
    if not row.get("award_id"):
        res = client().table("grants").insert(row).execute()
        return res.data[0]["id"]
    res = (
        client()
        .table("grants")
        .upsert(row, on_conflict="program_id,award_id")
        .execute()
    )
    return res.data[0]["id"]


def insert_chunk(row: dict[str, Any], *, embed: bool = True) -> None:
    """Insert a single chunk, embedding inline by default. See bulk_insert_chunks."""
    if embed and "embedding" not in row:
        from . import voyage
        row["embedding"] = voyage.embed(row["content"])
    try:
        client().table("grant_chunks").insert(row).execute()
    except Exception as exc:  # noqa: BLE001
        if "23505" not in str(exc):
            raise


@with_retry
def bulk_upsert_companies(rows: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    """Bulk-upsert companies; returns (normalized_name, org_type) -> id."""
    if not rows:
        return {}
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        deduped[(r["normalized_name"], r["org_type"])] = r
    res = (
        client()
        .table("companies")
        .upsert(list(deduped.values()), on_conflict="normalized_name,org_type")
        .execute()
    )
    return {(r["normalized_name"], r["org_type"]): r["id"] for r in res.data}


@with_retry
def bulk_upsert_grants(rows: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    """Bulk-upsert grants keyed on (program_id, award_id); returns that tuple -> grant_id.
    Rows without award_id are skipped (we can't key them)."""
    keyed = [r for r in rows if r.get("award_id")]
    if not keyed:
        return {}
    # Dedup within the batch (multi-installment grants can repeat the same award_id).
    deduped: dict[tuple[str, str], dict[str, Any]] = {}
    for r in keyed:
        deduped[(r["program_id"], r["award_id"])] = r
    res = (
        client()
        .table("grants")
        .upsert(list(deduped.values()), on_conflict="program_id,award_id")
        .execute()
    )
    return {(r["program_id"], r["award_id"]): r["id"] for r in res.data}


def bulk_insert_chunks(rows: list[dict[str, Any]], *, embed: bool = True) -> None:
    """Bulk-insert grant chunks with embeddings populated inline by default.

    Dedupes within the batch on the same key the DB's unique index uses
    (grant_id, kind, md5(content)). On a 23505 unique violation from cross-run
    duplicates, falls back to per-row inserts so the rest of the batch lands.

    When ``embed`` is True (default), we call Ollama once with all chunk
    contents and stuff the resulting vectors into each row before insert —
    avoiding the per-row UPDATE writeback that overwhelms shared compute."""
    if not rows:
        return
    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for r in rows:
        key = (r["grant_id"], r["kind"], r["content"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    if embed:
        from . import voyage  # local import: db.py shouldn't hard-require voyage
        vecs = voyage.embed_batch([r["content"] for r in deduped])
        for r, v in zip(deduped, vecs, strict=True):
            r["embedding"] = v

    # Sub-chunk into smaller INSERTs. With 1024-dim embeddings each row is
    # ~10KB; a 200-row insert is ~2MB which PostgREST handles quickly, while a
    # 1000-row insert (~10MB) crawls or times out on the shared tier.
    def _single_insert_retry(row: dict[str, Any]) -> None:
        """Per-row insert with the same transient-error retry. Swallows 23505
        (unique violation) since that's the whole point of falling back."""
        last: Exception | None = None
        for att in range(5):
            try:
                client().table("grant_chunks").insert(row).execute()
                return
            except Exception as exc:  # noqa: BLE001
                last = exc
                if "23505" in str(exc):
                    return  # duplicate, fine
                if _is_transient(exc):
                    client.cache_clear()
                    time.sleep(0.5 * (2 ** att))
                    continue
                raise
        raise RuntimeError(f"single chunk insert failed after 5 attempts: {last}")

    SUB = 150
    for i in range(0, len(deduped), SUB):
        sub = deduped[i : i + SUB]
        last_exc: Exception | None = None
        for attempt in range(5):
            try:
                client().table("grant_chunks").insert(sub).execute()
                last_exc = None
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if "23505" in str(exc):
                    for r in sub:
                        _single_insert_retry(r)
                    last_exc = None
                    break
                # Force fresh HTTP/2 connection on the next attempt — Supabase
                # closes connections after ~20k streams and other transients.
                if _is_transient(exc):
                    client.cache_clear()
                time.sleep(1.0 * (2 ** attempt))
        if last_exc is not None:
            raise RuntimeError(f"bulk_insert_chunks sub-batch failed after 5 attempts: {last_exc}")


@with_retry
def grant_chunks_pending_embedding(limit: int = 500) -> list[dict[str, Any]]:
    res = (
        client()
        .table("grant_chunks")
        .select("id,content")
        .is_("embedding", "null")
        .limit(limit)
        .execute()
    )
    return res.data or []


@with_retry
def bulk_set_chunk_embeddings(updates: list[tuple[str, list[float]]]) -> int:
    """Apply N embedding updates in a single round-trip via the
    apply_chunk_embeddings RPC. Returns the number of rows updated."""
    if not updates:
        return 0
    payload = [{"id": cid, "embedding": vec} for cid, vec in updates]
    res = client().rpc("apply_chunk_embeddings", {"updates": payload}).execute()
    return int(res.data) if res.data is not None else 0


def set_chunk_embedding(chunk_id: str, embedding: list[float]) -> None:
    # Transient socket errors (Errno 35 / connection resets) happen when many
    # threads slam the Supabase REST client at once. Retry a few times before
    # giving up so a single hiccup doesn't kill a long-running embed job.
    import time

    last_exc: Exception | None = None
    for attempt in range(5):
        try:
            client().table("grant_chunks").update({"embedding": embedding}).eq("id", chunk_id).execute()
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            time.sleep(0.2 * (2 ** attempt))
    raise RuntimeError(f"set_chunk_embedding failed after 5 attempts for {chunk_id}: {last_exc}")
