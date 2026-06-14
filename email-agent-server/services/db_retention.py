"""
services/db_retention.py — Purge old email-agent DB records (MongoDB only).

Does NOT touch Gmail. Runs on a slow daily loop in small batches.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from config import settings
from db.mongodb import get_collection, is_db_connected

logger = logging.getLogger("db_retention")

SEEN_COLLECTION = "email_agent_seen"
EVENTS_COLLECTION = "email_agent_events"
METRICS_COLLECTION = "email_agent_metrics_daily"


async def start_db_retention_engine():
    """Background loop — purge stale DB rows older than db_retention_days."""
    days = max(1, settings.db_retention_days)
    interval = max(3600, settings.db_retention_interval_seconds)
    batch_size = max(50, settings.db_retention_batch_size)

    logger.info(
        f"DB retention engine started — keep {days} days, "
        f"run every {interval}s, batch {batch_size}"
    )

    await asyncio.sleep(120)

    while True:
        try:
            if is_db_connected():
                summary = await run_db_retention_once()
                if summary["total_deleted"]:
                    logger.info(f"DB retention purge: {summary}")
            else:
                logger.debug("DB retention skipped — database not connected")
        except Exception as exc:
            logger.error(f"DB retention failure: {exc}")

        await asyncio.sleep(interval)


async def run_db_retention_once() -> dict:
    """Delete records older than the configured retention window."""
    days = max(1, settings.db_retention_days)
    batch_size = max(50, settings.db_retention_batch_size)
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_date = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")

    seen_deleted = await _purge_in_batches(
        get_collection(SEEN_COLLECTION),
        {"seen_at": {"$lt": cutoff_dt}},
        batch_size,
    )
    events_deleted = await _purge_in_batches(
        get_collection(EVENTS_COLLECTION),
        {"timestamp": {"$lt": cutoff_dt}},
        batch_size,
    )
    metrics_deleted = await _purge_in_batches(
        get_collection(METRICS_COLLECTION),
        {"date": {"$lt": cutoff_date}},
        batch_size,
    )

    total = seen_deleted + events_deleted + metrics_deleted
    return {
        "retention_days": days,
        "seen_deleted": seen_deleted,
        "events_deleted": events_deleted,
        "metrics_deleted": metrics_deleted,
        "total_deleted": total,
    }


async def _purge_in_batches(collection, query: dict, batch_size: int) -> int:
    """Delete matching docs in small batches to avoid DB spikes."""
    deleted = 0

    while True:
        cursor = collection.find(query, projection={"_id": 1}).limit(batch_size)
        ids = [doc["_id"] async for doc in cursor]
        if not ids:
            break

        result = await collection.delete_many({"_id": {"$in": ids}})
        deleted += result.deleted_count

        if result.deleted_count < batch_size:
            break

        await asyncio.sleep(0.2)

    return deleted
