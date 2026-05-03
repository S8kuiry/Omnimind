# vector_store.py — Pinecone backend, full drop-in replacement
import time
import os
from pinecone import Pinecone, ServerlessSpec
from config import PINECONE_API_KEY, PINECONE_INDEX_NAME, PINECONE_CLOUD, PINECONE_REGION

TTL_DAYS = 30
TTL_SECONDS = TTL_DAYS * 24 * 60 * 60

_index = None


def _get_index():
    """Lazily initialises and caches the Pinecone index."""
    global _index
    if _index is not None:
        return _index

    pc = Pinecone(api_key=PINECONE_API_KEY)

    existing = [idx.name for idx in pc.list_indexes()]
    if PINECONE_INDEX_NAME not in existing:
        pc.create_index(
            name=PINECONE_INDEX_NAME,
            dimension=768,           # all-MiniLM-L6-v2 outputs 384-dim vectors
            metric="cosine",
            spec=ServerlessSpec(
                cloud=PINECONE_CLOUD,
                region=PINECONE_REGION
            )
        )

    _index = pc.Index(PINECONE_INDEX_NAME)
    return _index


# ── Store ──────────────────────────────────────────────────────────

def store_chunks(
    chunks: list[dict],
    embeddings: list[list[float]],
    doc_name: str,
    user_id: str
) -> int:
    """
    Upserts chunks into the user's namespace.
    Namespace = user_id gives hard infra-level isolation —
    queries physically cannot cross namespace boundaries.
    Text is stored inside metadata since Pinecone has no
    separate documents field like ChromaDB.
    """
    index = _get_index()
    now = int(time.time())

    vectors = []
    for chunk, embedding in zip(chunks, embeddings):
        vec_id = f"{user_id}_{doc_name}_{chunk['chunk_id']}"
        vectors.append({
            "id": vec_id,
            "values": embedding,
            "metadata": {
                "source": doc_name,
                "source_type": "pdf",
                "page": chunk["page"],
                "user_id": user_id,
                "uploaded_at": now,
                "last_accessed": now,
                "text": chunk["text"],
            }
        })

    # Pinecone recommends batches of 100
    for i in range(0, len(vectors), 100):
        index.upsert(vectors=vectors[i:i + 100], namespace=user_id)

    return len(vectors)


# ── Query ──────────────────────────────────────────────────────────

def query_chunks(
    query_embedding: list[float],
    user_id: str,
    top_k: int = 4,
    source_filter: str = None
) -> list[dict]:
    """
    Queries within the user's namespace only — no cross-user leakage possible.
    Optional source_filter narrows results to a specific document.
    Updates last_accessed on matched chunks to reset the TTL clock.
    """
    index = _get_index()

    metadata_filter = {"source": {"$eq": source_filter}} if source_filter else None

    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        namespace=user_id,
        filter=metadata_filter,
        include_metadata=True
    )

    if not results.matches:
        return []

    chunks = []
    accessed_ids = []

    for match in results.matches:
        meta = match.metadata
        chunks.append({
            "text": meta["text"],
            "source": meta["source"],
            "page": meta["page"],
        })
        accessed_ids.append(match.id)

    _touch_chunks(accessed_ids, user_id)
    return chunks


def _touch_chunks(ids: list[str], user_id: str):
    """
    Resets last_accessed for queried chunks so active docs
    never get cleaned up by the TTL task.
    Pinecone has no partial update — requires fetch → mutate → upsert.
    """
    if not ids:
        return

    index = _get_index()
    now = int(time.time())

    fetched = index.fetch(ids=ids, namespace=user_id)

    updated = []
    for vec_id, vec_data in fetched.vectors.items():
        updated.append({
            "id": vec_id,
            "values": vec_data.values,
            "metadata": {**vec_data.metadata, "last_accessed": now}
        })

    if updated:
        index.upsert(vectors=updated, namespace=user_id)


# ── List documents ─────────────────────────────────────────────────

def list_user_documents(user_id: str) -> list[dict]:
    """
    Returns all unique documents for this user.

    Uses Pinecone's list() API to paginate all vector IDs in the
    namespace — no query vector needed, no arbitrary top_k limit.
    Then fetches metadata in batches of 100 to deduplicate by source.

    This is the correct Pinecone-native approach vs a zero-vector
    query hack which is both inaccurate and wasteful.
    """
    index = _get_index()

    # list() paginates all IDs in the namespace without a query vector
    all_ids = []
    for id_batch in index.list(namespace=user_id):
        all_ids.extend(id_batch)

    if not all_ids:
        return []

    # fetch metadata in batches of 100 (Pinecone fetch limit)
    seen = {}
    for i in range(0, len(all_ids), 100):
        batch_ids = all_ids[i:i + 100]
        fetched = index.fetch(ids=batch_ids, namespace=user_id)

        for vec_data in fetched.vectors.values():
            meta = vec_data.metadata
            src = meta["source"]
            if src not in seen:
                seen[src] = {
                    "doc_name": src,
                    "uploaded_at": meta["uploaded_at"],
                    "last_accessed": meta["last_accessed"],
                    "days_until_deletion": max(
                        0,
                        TTL_DAYS - int((time.time() - meta["last_accessed"]) / 86400)
                    )
                }

    return list(seen.values())


# ── Delete ─────────────────────────────────────────────────────────

def delete_document(doc_name: str, user_id: str) -> int:
    """
    Deletes all chunks for a document within the user's namespace.
    Namespace scoping ensures users cannot delete each other's docs.
    Uses list() with prefix to find exact chunk IDs — no query needed.
    Returns number of chunks deleted.
    """
    index = _get_index()

    # IDs are structured as {user_id}_{doc_name}_{chunk_id}
    # so we can prefix-match to find all chunks for this document
    prefix = f"{user_id}_{doc_name}_"
    ids_to_delete = []
    for id_batch in index.list(prefix=prefix, namespace=user_id):
        ids_to_delete.extend(id_batch)

    if not ids_to_delete:
        return 0

    # delete in batches of 1000 (Pinecone delete limit)
    for i in range(0, len(ids_to_delete), 1000):
        index.delete(ids=ids_to_delete[i:i + 1000], namespace=user_id)

    return len(ids_to_delete)


# ── TTL Cleanup ────────────────────────────────────────────────────

def cleanup_expired_documents() -> dict:
    """
    Deletes all chunks not accessed within TTL_DAYS across all users.
    Uses list() per namespace + fetch to check last_accessed —
    avoids zero-vector queries entirely. Call from a cron job.
    """
    index = _get_index()
    cutoff = int(time.time()) - TTL_SECONDS

    stats = index.describe_index_stats()
    namespaces = list(stats.namespaces.keys())

    total_deleted = 0
    affected_docs: set[str] = set()

    for namespace in namespaces:
        # paginate all IDs in this user's namespace
        all_ids = []
        for id_batch in index.list(namespace=namespace):
            all_ids.extend(id_batch)

        if not all_ids:
            continue

        stale_ids = []

        # fetch metadata in batches to check last_accessed
        for i in range(0, len(all_ids), 100):
            batch_ids = all_ids[i:i + 100]
            fetched = index.fetch(ids=batch_ids, namespace=namespace)

            for vec_id, vec_data in fetched.vectors.items():
                meta = vec_data.metadata
                if meta.get("last_accessed", 0) < cutoff:
                    stale_ids.append(vec_id)
                    affected_docs.add(meta.get("source", "unknown"))

        if not stale_ids:
            continue

        # delete stale chunks in batches of 1000
        for i in range(0, len(stale_ids), 1000):
            index.delete(ids=stale_ids[i:i + 1000], namespace=namespace)

        total_deleted += len(stale_ids)

    return {
        "chunks_deleted": total_deleted,
        "documents_affected": list(affected_docs)
    }