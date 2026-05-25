import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache

import requests

from config import GOOGLE_API_KEY, EMBEDDING_DIMENSION

_local_env = os.getenv("USE_LOCAL_EMBEDDINGS", "").lower()
if _local_env in ("1", "true", "yes"):
    USE_LOCAL = True
elif _local_env in ("0", "false", "no"):
    USE_LOCAL = False
else:
    # Local BGE is 768-dim only — auto-disable when Pinecone index is not 768
    USE_LOCAL = EMBEDDING_DIMENSION == 768
LOCAL_MODEL = os.getenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")

MODEL = "models/gemini-embedding-001"
EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    f"models/gemini-embedding-001:embedContent?key={GOOGLE_API_KEY}"
)
BATCH_URL = (
    "https://generativelanguage.googleapis.com/v1beta/"
    f"models/gemini-embedding-001:batchEmbedContents?key={GOOGLE_API_KEY}"
)

BATCH_SIZE = 100
MAX_PARALLEL_BATCHES = 4


def _gemini_dim_kwargs() -> dict:
    """Gemini returns 3072 by default; only pass outputDimensionality when reducing."""
    if EMBEDDING_DIMENSION < 3072:
        return {"outputDimensionality": EMBEDDING_DIMENSION}
    return {}


@lru_cache(maxsize=1)
def _local_model():
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=LOCAL_MODEL)


def warmup_local_embeddings() -> None:
    """Load ONNX model at startup so first PDF upload is not blocked on download."""
    if USE_LOCAL:
        _local_model()


def _local_embed(texts: list[str], *, is_query: bool) -> list[list[float]]:
    tag = "query:" if is_query else "passage:"
    prefix = f"{tag} "
    prepared = [
        t if t.lower().startswith(tag) else f"{prefix}{t}"
        for t in texts
    ]
    model = _local_model()
    return [vec.tolist() for vec in model.embed(prepared, batch_size=32)]


def _gemini_one(text: str, *, task_type: str) -> list[float]:
    res = requests.post(
        EMBED_URL,
        json={
            "model": MODEL,
            "content": {"parts": [{"text": text}]},
            "taskType": task_type,
            **_gemini_dim_kwargs(),
        },
        timeout=60,
    )
    res.raise_for_status()
    return res.json()["embedding"]["values"]


def _gemini_batch(texts: list[str]) -> list[list[float]]:
    res = requests.post(
        BATCH_URL,
        json={
            "requests": [
                {
                    "model": MODEL,
                    "content": {"parts": [{"text": t}]},
                    "taskType": "RETRIEVAL_DOCUMENT",
                    **_gemini_dim_kwargs(),
                }
                for t in texts
            ]
        },
        timeout=120,
    )
    res.raise_for_status()
    return [e["values"] for e in res.json()["embeddings"]]


def _gemini_embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if len(texts) == 1:
        return [_gemini_one(texts[0], task_type="RETRIEVAL_DOCUMENT")]

    batches = [texts[i : i + BATCH_SIZE] for i in range(0, len(texts), BATCH_SIZE)]
    if len(batches) == 1:
        return _gemini_batch(batches[0])

    ordered: list[list[list[float]] | None] = [None] * len(batches)
    workers = min(MAX_PARALLEL_BATCHES, len(batches))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_gemini_batch, batch): idx for idx, batch in enumerate(batches)}
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()

    out: list[list[float]] = []
    for batch_vectors in ordered:
        out.extend(batch_vectors)
    return out


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    if USE_LOCAL:
        return _local_embed(texts, is_query=False)
    return _gemini_embed_texts(texts)


def embed_query(query: str) -> list[float]:
    if USE_LOCAL:
        return _local_embed([query], is_query=True)[0]
    return _gemini_one(query, task_type="RETRIEVAL_QUERY")
