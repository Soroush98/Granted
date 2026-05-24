"""Voyage AI embeddings wrapper (direct REST, no SDK).

The official `voyageai` SDK doesn't support Python 3.14+, so we call the
REST endpoint directly. Up to ~1000 inputs per call; voyage-3.5 returns
1024-dim vectors. Kept ollama.py around for the gemma2:2b rerank chat —
only the embedding side moved off Ollama.
"""

from __future__ import annotations

import httpx

from .config import settings

_ENDPOINT = "https://api.voyageai.com/v1/embeddings"


def embed(text: str) -> list[float]:
    return embed_batch([text])[0]


def embed_batch(texts: list[str], *, input_type: str = "document") -> list[list[float]]:
    """Embed up to ~1000 inputs in one HTTP round-trip.

    ``input_type``: 'document' for corpus chunks (default), 'query' for user
    queries — voyage-3.5 is an asymmetric encoder so this matters for retrieval.

    Retries on transient HTTP errors (connection drops, 5xx, 429 rate-limits)
    so a single network blip doesn't kill long-running ingest jobs."""
    if not texts:
        return []
    import time

    last_exc: Exception | None = None
    for attempt in range(5):
        try:
            with httpx.Client(timeout=60.0) as c:
                r = c.post(
                    _ENDPOINT,
                    headers={
                        "authorization": f"Bearer {settings.voyage_api_key}",
                        "content-type": "application/json",
                    },
                    json={
                        "input": texts,
                        "model": settings.voyage_embed_model,
                        "input_type": input_type,
                    },
                )
                # 5xx and 429 are retryable; 4xx (bad key/payload) are not.
                if r.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError(
                        f"retryable {r.status_code}", request=r.request, response=r
                    )
                r.raise_for_status()
                payload = r.json()
            data = payload.get("data") or []
            if len(data) != len(texts):
                raise RuntimeError(
                    f"Voyage returned {len(data)} embeddings for {len(texts)} inputs"
                )
            data_sorted = sorted(data, key=lambda d: d["index"])
            return [d["embedding"] for d in data_sorted]
        except (httpx.RemoteProtocolError, httpx.ConnectError, httpx.ReadError,
                httpx.HTTPStatusError, httpx.TimeoutException) as exc:
            last_exc = exc
            time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError(f"voyage.embed_batch failed after 5 attempts: {last_exc}")
