"""
models/seen.py — Seen Registry
 
One document per (user_email, message_id) pair.
This is the single source of truth for "has this email been processed?".
 
Collection: email_agent_seen
Index: unique on (user_email, message_id) — enforced at DB level
 
Outcome values:
    auto_resolved    — pipeline handled it silently (auto-reply or ack)
    spam_blocked     — hard-dropped, no-reply or spam
    attention_queued — needs human, surfaced to dashboard
    user_reviewed    — user opened and dismissed from attention queue
    user_replied     — user manually sent a reply from dashboard
"""
from datetime import datetime,timezone
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError
from db.mongodb import get_collection 

COLLECTION = "email_agent_seen"
# ── Index setup ────────────────────────────────────────────────────

async def ensure_indexes(): 
    """
    Call once on startup from main.py.
    Creates the unique compound index that prevents duplicate processing.
    Safe to call multiple times — MongoDB is idempotent on index creation.
    """
    col = get_collection(COLLECTION)
    await col.create_index(
        [("user_email", ASCENDING), ("message_id", ASCENDING)],
        unique=True,
        name="unique_user_message",
    )
    print("[seen] Index ensured: unique (user_email, message_id)")


# ── Core API ───────────────────────────────────────────────────────
async def is_seen(user_email: str, message_id: str) -> bool:
    """
    Returns True if this message has already been processed for this user.
    Fast — single indexed lookup, no full scan.
 
    Usage in pipeline:
        if await is_seen(user_email, message_id):
            return  # skip silently
    """

    col = get_collection(COLLECTION)
    doc = await col.find_one(
        {"user_email": user_email, "message_id": message_id},
        # Only fetch _id — we just need to know it exists, not its contents
        projection={"_id": 1},
    )
    return doc is not None


async def mark_seen( user_email: str,
    message_id: str,
    outcome: str,
    meta: dict | None = None,
) -> bool:
    """
    Marks a message as processed.
    Returns True if newly inserted, False if it already existed (race condition).
 
    The DuplicateKeyError catch handles the race condition where:
    - Push webhook and 15-min cron both see the same new email
    - Both call mark_seen() within milliseconds of each other
    - The unique index ensures only one wins — the other gets False back
    - The losing process should then skip its pipeline run
 
    Usage in pipeline:
        newly_inserted = await mark_seen(user_email, message_id, "auto_resolved")
        if not newly_inserted:
            return  # another process already handled this
    """
    col = get_collection(COLLECTION)
    now = datetime.now(timezone.utc)
    try :
        await col.insert_one({

            "user_email": user_email,
            "message_id": message_id,
            "outcome": outcome,
            "meta": meta or {},
            "seen_at": now,
        })
        return True  # successfully marked
    except DuplicateKeyError:
        return False  # another process already marked this
    



async def update_outcome(
    user_email: str,
    message_id: str,
    new_outcome: str,
) -> bool:
    """
    Updates the outcome of an already-seen message.
    Used when a user manually reviews an attention_queued email:
        update_outcome(email, msg_id, "user_reviewed")
 
    Returns True if document was found and updated.
    """
    col = get_collection(COLLECTION)
    result = await col.update_one(
        {"user_email": user_email, "message_id": message_id},
        {"$set": {
            "outcome": new_outcome,
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    return result.matched_count > 0


# ── Lookup helpers ─────────────────────────────────────────────────


async def get_seen_record(user_email: str, message_id: str) -> dict | None:
    """
    Returns the full seen record for a message, or None.
    Useful for debugging — "why was this email skipped?"
    """
    col = get_collection(COLLECTION)
    return await col.find_one(
        {"user_email": user_email, "message_id": message_id}
    )



async def count_by_outcome(user_email: str, since: datetime | None = None) -> dict:
    """
    Returns a breakdown of outcomes for a user.
    Useful for sanity-checking pipeline behavior.

    Example return:
        {
            "auto_resolved": 142,
            "spam_blocked": 38,
            "attention_queued": 7,
            "user_reviewed": 5,
            "user_replied": 2,
        }
    """
    col = get_collection(COLLECTION)
    match: dict = {'user_email': user_email}
    if since:
        match["seen_at"] = {"$gte": since}
    
    pipeline = [
        {"$match": match},
        {"$group": {"_id": "$outcome", "count": {"$sum": 1}}},
    ]
 
    cursor = col.aggregate(pipeline)
    result = {}
    async for doc in cursor:
        result[doc["_id"] or "unknown"] = doc["count"]
 
    return result
