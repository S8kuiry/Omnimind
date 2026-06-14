"""
models/event.py — Agent Event Log
 
Every pipeline outcome writes here.
On each write, daily metrics counters are also incremented automatically.
 
Two collections work together:
    email_agent_events      — full audit trail, one doc per event
    email_agent_metrics_daily — fast counters, one doc per user per day
 
The pipeline only calls log_agent_event().
It never touches metrics_daily directly — that happens here automatically.
 
Event types and which metric counter they increment:
    auto_resolved    → metrics_daily.auto_resolved + 1
    auto_replied     → metrics_daily.auto_resolved + 1, auto_send_count + 1
    auto_acked       → metrics_daily.auto_resolved + 1, auto_ack_count + 1
    spam_blocked     → metrics_daily.spam_blocked + 1
    attention_queued → metrics_daily.attention_queued + 1
    user_reviewed    → metrics_daily.user_reviewed + 1
    user_replied     → metrics_daily.user_replied + 1
"""

from datetime import datetime, timezone, date, time
from pymongo import ASCENDING
from db.mongodb import get_collection
from models import metrics_daily


COLLECTION = "email_agent_events"


# Maps event_type → which metric fields to increment and by how much
# This is the single place that defines "what counts as what"
_METRIC_MAP: dict[str, dict[str, int]] = {
    # Tier-1: auto-reply was sent
    "auto_replied": {
        "auto_resolved": 1,
        "auto_send_count": 1,
    },
    # Tier-2: silently acknowledged, no reply sent
    "auto_acked": {
        "auto_resolved": 1,
        "auto_ack_count": 1,
    },
    # Generic auto-resolve (used when tier detail not needed)
    "auto_resolved": {
        "auto_resolved": 1,
    },
    # Hard drop — no-reply address, spam, or below processing threshold
    "spam_blocked": {
        "spam_blocked": 1,
    },
    # Tier-3: surfaced to your attention queue
    "attention_queued": {
        "attention_queued": 1,
    },
    # Legacy alias from older pipeline
    "draft": {
        "attention_queued": 1,
    },
    # User opened and dismissed from attention queue
    "user_reviewed": {
        "user_reviewed": 1,
    },
    # User manually replied from dashboard
    "user_replied": {
        "user_replied": 1,
    },
}

# ── Index setup ────────────────────────────────────────────────────

async def ensure_indexes():
    """Call once on startup."""
    col = get_collection(COLLECTION)
    # Query patterns: "all events for user", "all events for message"
    await col.create_index(
        [("user_email", ASCENDING), ("timestamp", ASCENDING)],
        name="user_timestamp",
    )
    await col.create_index(
        [("user_email", ASCENDING), ("message_id", ASCENDING)],
        name="user_message",
    )
    print("[event] Indexes ensured")



# ── Core write ─────────────────────────────────────────────────────

async def log_agent_event(
    user_email: str,
    event_type: str,
    message_id: str | None = None,
    meta: dict | None = None,
) -> None:
    """
    The single function the pipeline calls for every outcome.
 
    Writes to:
        1. email_agent_events (audit trail — always)
        2. email_agent_metrics_daily (counters — if event_type is in _METRIC_MAP)
 
    Unknown event_type still logs to events but won't increment metrics.
    This is intentional — debug events, errors, etc. shouldn't skew stats.
 
    Args:
        user_email:  who this event belongs to
        event_type:  one of the keys in _METRIC_MAP (or any string for debug)
        message_id:  the Gmail message ID this event is about (optional)
        meta:        any extra context — category, priority, mode, etc.
 
    Example calls from pipeline:
        await log_agent_event(user_email, "auto_replied",   msg_id, {"category": "newsletter"})
        await log_agent_event(user_email, "spam_blocked",   msg_id, {"reason": "no_reply_address"})
        await log_agent_event(user_email, "attention_queued", msg_id, {"priority": "high"})
    """
    now = datetime.now(timezone.utc)
    col = get_collection(COLLECTION)
    # 1. Write audit event
    await col.insert_one({
        "user_email":  user_email,
        "event_type":  event_type,
        "message_id":  message_id,
        "meta":        meta or {},
        "timestamp":   now,
    })

    # 2. Increment daily metrics if this event type maps to counters
    counters = _METRIC_MAP.get(event_type)
    if counters:
        await metrics_daily.increment_many(user_email, counters)
    


# ── Reads ──────────────────────────────────────────────────────────

async def get_today_auto_replies(user_email: str, limit: int = 50) -> list[dict]:
    """Auto-replied events for today (UTC), newest first."""
    col = get_collection(COLLECTION)
    start = datetime.combine(date.today(), time.min).replace(tzinfo=timezone.utc)

    cursor = col.find(
        {
            "user_email": user_email,
            "event_type": {"$in": ["auto_replied", "auto_resolved"]},
            "timestamp": {"$gte": start},
        },
        projection={"_id": 0},
        sort=[("timestamp", -1)],
        limit=limit,
    )

    events = []
    async for doc in cursor:
        meta = doc.get("meta") or {}
        events.append({
            "_id": doc.get("message_id", ""),
            "message_id": doc.get("message_id", ""),
            "timestamp": doc.get("timestamp"),
            "subject": meta.get("subject", ""),
            "from_name": meta.get("from_name", ""),
            "from_address": meta.get("from_address", ""),
            "snippet": meta.get("snippet", ""),
            "reply_preview": meta.get("reply_preview", ""),
            "category": meta.get("category", "work"),
            "priority": meta.get("priority", "medium"),
        })
    return events


async def get_recent_events(
    user_email: str,
    limit: int = 20,
    event_type: str | None = None,
) -> list[dict]:
    """
    Returns recent events for a user, newest first.
    Used by the agent log panel on the dashboard.
    """
    col = get_collection(COLLECTION)
    query: dict = {"user_email": user_email}
    if event_type:
        query["event_type"] = event_type
 
    cursor = col.find(
        query,
        projection={"_id": 0},
        sort=[("timestamp", -1)],
        limit=limit,
    )

    events = []
    async for doc in cursor:
        events.append(doc)
    return events


async def get_events_for_message(
    user_email: str,
    message_id: str,
) -> list[dict]:
    """
    Returns all events for a specific message — useful for debugging
    "what did the agent do with this email?"
    """
    col = get_collection(COLLECTION)
    cursor = col.find(
        {"user_email": user_email, "message_id": message_id},
        projection={"_id": 0},
        sort=[("timestamp", 1)],
    )
    events = []
    async for doc in cursor:
        events.append(doc)
    return events




    