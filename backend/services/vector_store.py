# vector_store.py — Pinecone backend, full drop-in replacement
import re
import time
import os
from pinecone import Pinecone, ServerlessSpec
from config import (
    PINECONE_API_KEY,
    PINECONE_INDEX_NAME,
    PINECONE_CLOUD,
    PINECONE_REGION,
    EMBEDDING_DIMENSION,
)

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
            dimension=EMBEDDING_DIMENSION,
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
    top_k: int = 8,
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


# ── Page chunk helpers (for PDF citations) ─────────────────────────

_VEC_ID_TAIL = re.compile(r"_page(\d+)_chunk\d+$")


def _list_vector_ids(index, namespace: str, prefix: str | None = None) -> list[str]:
    """List Pinecone IDs; prefix listing may be unavailable on some plans."""
    ids: list[str] = []
    try:
        kwargs = {"namespace": namespace}
        if prefix:
            kwargs["prefix"] = prefix
        for id_batch in index.list(**kwargs):
            ids.extend(id_batch)
    except Exception as exc:
        print(f"[vector_store] list failed (prefix={prefix!r}, ns={namespace}): {exc}")
    return ids


def _doc_name_from_vector_id(namespace: str, vector_id: str) -> str | None:
    """Parse doc name from {namespace}_{doc}_page{N}_chunk{M}."""
    prefix = f"{namespace}_"
    if not vector_id.startswith(prefix):
        return None
    tail = vector_id[len(prefix) :]
    m = _VEC_ID_TAIL.search(tail)
    if not m:
        return None
    return tail[: m.start()]


def list_doc_names_in_namespace(namespace: str) -> list[str]:
    """All document source names stored under a chat/user namespace."""
    index = _get_index()
    ids = _list_vector_ids(index, namespace, prefix=f"{namespace}_")
    if not ids:
        ids = _list_vector_ids(index, namespace)

    names: set[str] = set()
    for vid in ids:
        doc = _doc_name_from_vector_id(namespace, vid)
        if doc:
            names.add(doc)
    return sorted(names)


def resolve_doc_name(requested: str, namespace: str) -> str:
    """Map LLM/citation doc labels to the name used at upload time in Pinecone."""
    docs = list_doc_names_in_namespace(namespace)
    if not docs:
        return requested

    if requested in docs:
        return requested

    lower = requested.lower()
    for d in docs:
        if d.lower() == lower:
            return d

    for d in docs:
        dl, rl = d.lower(), lower
        if rl in dl or dl in rl:
            return d

    return requested


def _coerce_page(value) -> int:
    try:
        if value is None:
            return 0
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _fetch_chunks_by_ids(
    index,
    ids: list[str],
    namespace: str,
    *,
    page: int | None = None,
    source: str | None = None,
) -> list[dict]:
    chunks: list[dict] = []
    for i in range(0, len(ids), 100):
        batch = ids[i : i + 100]
        if not batch:
            continue
        try:
            fetched = index.fetch(ids=batch, namespace=namespace)
        except Exception as exc:
            print(f"[vector_store] fetch failed: {exc}")
            continue
        for vec_id, vec_data in fetched.vectors.items():
            meta = vec_data.metadata or {}
            meta_page = _coerce_page(meta.get("page"))
            meta_source = str(meta.get("source") or "")
            text = meta.get("text") or ""
            if not text:
                continue
            if page is not None and meta_page != page:
                continue
            if source is not None and meta_source != source:
                continue
            chunks.append({
                "chunk_id": vec_id,
                "text": text,
                "page": meta_page,
                "source": meta_source,
            })
    chunks.sort(key=lambda c: c["chunk_id"])
    return chunks


def get_page_chunks(
    doc_name: str,
    page: int,
    namespace: str
) -> list[dict]:
    """
    Returns all chunks for a specific page of a document.

    Stream/RAG uses semantic query; this uses ID listing + metadata so
    citations still resolve when dummy-vector metadata queries miss.
    """
    index = _get_index()
    resolved = resolve_doc_name(doc_name, namespace)

    # 1) Page-specific ID prefix
    page_prefix = f"{namespace}_{resolved}_page{page}_"
    ids = _list_vector_ids(index, namespace, prefix=page_prefix)
    chunks = _fetch_chunks_by_ids(index, ids, namespace)
    if chunks:
        return chunks

    # 2) All vectors for this doc in the namespace, filter by metadata page
    doc_prefix = f"{namespace}_{resolved}_"
    ids = _list_vector_ids(index, namespace, prefix=doc_prefix)
    chunks = _fetch_chunks_by_ids(index, ids, namespace, page=page, source=resolved)
    if chunks:
        return chunks

    # 3) Citation page may be wrong — return nearest page that has chunks
    all_doc = _fetch_chunks_by_ids(index, ids, namespace, source=resolved)
    if all_doc:
        pages = sorted({c["page"] for c in all_doc if c["page"] > 0})
        if pages:
            nearest = min(pages, key=lambda p: abs(p - page))
            return [c for c in all_doc if c["page"] == nearest]

    # 4) Metadata filter query (last resort)
    try:
        results = index.query(
            vector=[0.0] * EMBEDDING_DIMENSION,
            top_k=100,
            namespace=namespace,
            filter={
                "source": {"$eq": resolved},
                "page": {"$eq": page},
            },
            include_metadata=True,
        )
        chunks = []
        for match in results.matches:
            meta = match.metadata or {}
            text = meta.get("text") or ""
            if not text:
                continue
            chunks.append({
                "chunk_id": match.id,
                "text": text,
                "page": _coerce_page(meta.get("page", page)),
                "source": str(meta.get("source") or resolved),
            })
        chunks.sort(key=lambda c: c["chunk_id"])
        if chunks:
            return chunks
    except Exception as exc:
        print(f"[get_page_chunks] metadata query failed: {exc}")

    return []


def retrieve_chunks_for_question(
    question: str,
    namespace: str,
    doc_names: list[str] | None = None,
    top_k: int = 8,
) -> list[dict]:
    """
    Semantic retrieval with fallbacks so all models get document context
    even when the user's wording doesn't match chunk embeddings well.
    """
    from services.embedder import embed_query

    names = doc_names or list_doc_names_in_namespace(namespace)
    query_vec = embed_query(question)
    chunks = query_chunks(query_vec, user_id=namespace, top_k=top_k)
    if chunks:
        return chunks

    if not names:
        return []

    probes = [
        question,
        f"{question} — projects experience skills pdf",
        "projects experience education technical skills",
    ]
    seen: set[tuple] = set()
    merged: list[dict] = []
    for probe in probes:
        qv = embed_query(probe)
        for c in query_chunks(qv, user_id=namespace, top_k=top_k):
            key = (c.get("source"), c.get("page"), (c.get("text") or "")[:96])
            if key in seen:
                continue
            seen.add(key)
            merged.append(c)
            if len(merged) >= top_k:
                return merged

    index = _get_index()
    doc = resolve_doc_name(names[0], namespace)
    ids = _list_vector_ids(index, namespace, prefix=f"{namespace}_{doc}_")
    return _fetch_chunks_by_ids(index, ids[: top_k * 3], namespace)[:top_k]


def get_page_text(doc_name: str, page: int, namespace: str) -> str:
    """
    Convenience wrapper — returns joined text for a page.
    Used by the /document endpoint and citation rendering.
    """
    chunks = get_page_chunks(doc_name, page, namespace)
    return "\n\n".join(c["text"] for c in chunks)