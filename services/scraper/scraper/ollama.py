"""Ollama wrappers — embeddings and a tiny structured-JSON chat helper."""

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import settings


def embed(text: str) -> list[float]:
    """One-shot embedding call. Returns a 768-dim float vector for nomic-embed-text."""
    return embed_batch([text])[0]


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Batched embedding call. Ollama returns one vector per input in order."""
    if not texts:
        return []
    with httpx.Client(timeout=120.0) as c:
        r = c.post(
            f"{settings.ollama_base_url}/api/embed",
            json={"model": settings.ollama_embed_model, "input": texts},
        )
        r.raise_for_status()
        payload = r.json()
    vecs = payload.get("embeddings") or []
    if len(vecs) != len(texts):
        raise RuntimeError(f"Ollama returned {len(vecs)} embeddings for {len(texts)} inputs")
    return vecs


def chat_json(system: str, user: str, *, temperature: float = 0.2) -> Any:
    """Single-shot chat returning parsed JSON. Uses Ollama's format=json mode."""
    with httpx.Client(timeout=120.0) as c:
        r = c.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_llm_model,
                "stream": False,
                "format": "json",
                "think": False,
                "options": {"temperature": temperature},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
        )
        r.raise_for_status()
        payload = r.json()
    content = (payload.get("message") or {}).get("content")
    if not content:
        raise RuntimeError("Ollama returned empty chat content")
    return json.loads(content)
