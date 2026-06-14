"""
models/metrics_daily.py — Daily Metrics Rollups
 
One document per (user_email, date) pair.
Counters are incremented atomically with $inc — never overwritten.
 
Collection: email_agent_metrics_daily
 
Document shape:
{
    "user_email": "you@gmail.com",
    "date": "2026-06-11",           ← string YYYY-MM-DD, easy to query by range
    "auto_resolved": 47,            ← auto-reply sent OR silently acked
    "spam_blocked": 12,             ← hard-dropped (no-reply, spam classifier)
    "attention_queued": 3,          ← surfaced to your dashboard
    "auto_send_count": 8,           ← Tier-1: actual reply sent
    "auto_ack_count": 4,            ← Tier-2: acked without sending
    "user_reviewed": 2,             ← you opened + dismissed
    "user_replied": 1,              ← you manually replied from dashboard
    "created_at": datetime,
    "updated_at": datetime,
}
 
Why string date not datetime?
    "2026-06-11" is trivial to query as a range:
        { "date": { "$gte": "2026-06-05", "$lte": "2026-06-11" } }
    No timezone math needed for daily grouping.
"""

from datetime import datetime,timezone,date
from pymongo import ASCENDING
from db.mongodb import get_collection

COLLECTION = 'email_agent_metrics_daily'

# All counter fields — used for initialisation and type safety
COUNTER_FIELDS = [
    "auto_resolved",
    "spam_blocked",
    "attention_queued",
    "auto_send_count",
    "auto_ack_count",
    "user_reviewed",
    "user_replied",
    "inbox_cleaned",

]

# ── Index setup ────────────────────────────────────────────────────

async def ensure_indexes():
    """
    Call once on startup.
    Unique on (user_email, date) — one document per user per day.
    """
    col = get_collection(COLLECTION)
    await col.create_index(
        [("user_email", ASCENDING), ("date", ASCENDING)],
        unique=True,
        name="unique_user_date",
    )
    print("[metrics_daily] Index ensured: unique (user_email, date)")

# ── Core write ─────────────────────────────────────────────────────

async def increment(user_email: str,
    field: str,
    amount: int = 1,
    today: str | None = None,
) -> None:
    """
    Atomically increments one counter for today.
 
    This is the only write function the pipeline needs to call.
    Everything else (reads, rollups) is downstream.
 
    Args:
        user_email: the user this event belongs to
        field:      one of COUNTER_FIELDS, e.g. "auto_resolved"
        amount:     how much to increment (almost always 1)
        today:      override date string, defaults to UTC today
                    (pass in for testing or backfill)
 
    Example:
        await increment("you@gmail.com", "auto_resolved")
        await increment("you@gmail.com", "spam_blocked")
        await increment("you@gmail.com", "auto_send_count")
    """
    if field not in COUNTER_FIELDS:
        # Fail loudly — a typo in a field name would silently lose data
        raise ValueError(
            f"Unknown metric field '{field}'. "
            f"Must be one of: {COUNTER_FIELDS}"
        )

    date_str = today or _today_str()
    col = get_collection(COLLECTION)
    now = datetime.now(timezone.utc)

    await col.update_one(
        # Find today's document for this user
        {"user_email": user_email, "date": date_str},
        {
            # $inc adds to the counter (creates field at 0 if missing)
            "$inc": {field: amount},
            # $set on updated_at always reflects last write time
            "$set": {"updated_at": now},
            # $setOnInsert only runs when upsert creates a new document
            # — sets created_at and initialises all counters to 0
            "$setOnInsert": {
                "created_at": now,
                **{f: 0 for f in COUNTER_FIELDS if f != field},
            },
        },
        upsert=True,  # create today's doc if it doesn't exist yet
    )



async def increment_many(user_email: str, fields: dict[str, int]):

    """
    Increment multiple counters in a single DB write.
    More efficient than calling increment() in a loop.
 
    Example:
        await increment_many("you@gmail.com", {
            "auto_resolved": 1,
            "auto_send_count": 1,
        })
    """
    for field in fields:
        if field not in COUNTER_FIELDS:
            raise ValueError(f"Unknown metric field '{field}'")

    date_str = _today_str()
    col = get_collection(COLLECTION)
    now = datetime.now(timezone.utc)
    await col.update_one(
        {"user_email": user_email, "date": date_str},
        {
            "$inc": fields,
            "$set": {"updated_at": now},
            "$setOnInsert": {
                "created_at": now,
                **{f: 0 for f in COUNTER_FIELDS if f not in fields},
            },
        },
        upsert=True,
    )



# ── Reads ──────────────────────────────────────────────────────────

async def get_today(user_email: str) -> dict:
    """
    Returns today's metrics document.
    Returns zeroed dict if no activity today yet.
    """
    col = get_collection(COLLECTION)
    doc = await col.find_one(
        {"user_email": user_email, "date": _today_str()},
        projection={"_id": 0, "user_email": 0},
    )
    return doc or _empty_day(_today_str())





async def get_last_n_days(user_email: str, n: int = 7) -> list[dict]:
    """
    Returns the last N daily documents, sorted oldest → newest.
    Missing days are filled with zeroed documents.
 
    Used by the agent overview page for 7-day trend cards.
    """
    from datetime import timedelta
 
    col = get_collection(COLLECTION)
 
    # Generate the date strings we want
    today = date.today()
    date_strings = [
        (today - timedelta(days=i)).strftime("%Y-%m-%d")
        for i in range(n - 1, -1, -1)   # n-1 down to 0 → oldest first
    ]
 
    # Fetch all in one query
    cursor = col.find(
        {
            "user_email": user_email,
            "date": {"$in": date_strings},
        },
        projection={"_id": 0, "user_email": 0},
    )
    docs_by_date = {}
    async for doc in cursor:
        docs_by_date[doc["date"]] = doc
 
    # Fill missing days with zeros so frontend always gets N items
    return [
        docs_by_date.get(d, _empty_day(d))
        for d in date_strings
    ]




async def get_rollup(user_email: str, n_days: int = 7) -> dict:
    """
    Returns a single dict summing all counters across the last N days.
    This is what the dashboard stat cards consume.
 
    Example return for n_days=7:
    {
        "auto_resolved": 218,
        "spam_blocked": 94,
        "attention_queued": 12,
        "auto_send_count": 61,
        "auto_ack_count": 31,
        "user_reviewed": 8,
        "user_replied": 3,
        "days": 7,
        "automation_rate": 91.4,   ← computed here
    }
    """
    days = await get_last_n_days(user_email, n_days)
 
    totals: dict = {f: 0 for f in COUNTER_FIELDS}
    for day in days:
        for field in COUNTER_FIELDS:
            totals[field] += day.get(field, 0)
 
    # automation_rate = auto_resolved / (auto_resolved + attention_queued)
    # Tells you: "what % of emails did the agent handle without bothering you?"
    handled = totals["auto_resolved"] + totals["spam_blocked"]
    total_seen = handled + totals["attention_queued"]
    totals["automation_rate"] = (
        round((handled / total_seen) * 100, 1) if total_seen > 0 else 0.0
    )
    totals["days"] = n_days
 
    return totals





# ── Internal helpers ───────────────────────────────────────────────
 
def _today_str() -> str:
    """UTC today as YYYY-MM-DD string."""
    return date.today().strftime("%Y-%m-%d")
 
 
def _empty_day(date_str: str) -> dict:
    """Zero-filled document for a day with no activity."""
    return {
        "date": date_str,
        **{f: 0 for f in COUNTER_FIELDS},
    }
 







