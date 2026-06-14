"""
services/ingest_scheduler.py — Batch Ingest (Pub/Sub wake window)

Ingest runs every 15 minutes while the server is awake (Pub/Sub or cron wake).
Daily stats emails are sent via GET /cron/daily (external cron), not here.

Start from main.py:
    asyncio.create_task(start_ingest_scheduler())
"""

import asyncio
import logging
from datetime import datetime, timezone

from config import settings
from models.user import list_users_with_gmail_tokens
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_messages_for_triage

logger = logging.getLogger("ingest_scheduler")

async def run_ingest_for_user(user: dict) -> None:
    user_email = user.get("email")
    if not user_email:
        return

    label_map = {
        "OmniMind/Attention": user.get("gmail_label_attention_id"),
        "OmniMind/Processed": user.get("gmail_label_processed_id"),
    }

    if not label_map["OmniMind/Attention"] or not label_map["OmniMind/Processed"]:
        logger.debug(f"[ingest] Skipping {user_email} — labels not provisioned")
        return

    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as e:
        logger.warning(f"[ingest] Could not get credentials for {user_email}: {e}")
        return

    try:
        from services.gmail_watch import needs_renewal, register_watch
        if await needs_renewal(user):
            await register_watch(user, creds)
    except Exception as e:
        logger.warning(f"[ingest] Watch renewal skipped for {user_email}: {e}")

    try:
        messages = await asyncio.to_thread(
            fetch_messages_for_triage,
            creds=creds,
            max_results=settings.ingest_batch_size,
        )
    except Exception as e:
        logger.error(f"[ingest] Gmail fetch failed for {user_email}: {e}")
        return

    if not messages:
        logger.debug(f"[ingest] No untriaged messages for {user_email}")
        return

    logger.info(f"[ingest] {len(messages)} messages to process for {user_email}")

    from services.email_pipeline import process_incoming_email_pipeline

    tasks = [
        asyncio.create_task(
            process_incoming_email_pipeline(
                user=user,
                email_meta=msg,
                label_map=label_map,
                creds=creds,
            )
        )
        for msg in messages
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)
    errors = [r for r in results if isinstance(r, Exception)]
    if errors:
        logger.error(f"[ingest] {len(errors)} pipeline errors for {user_email}: {errors[0]}")

    logger.info(
        f"[ingest] Cycle complete for {user_email} — "
        f"{len(messages) - len(errors)}/{len(messages)} processed"
    )


async def _run_all_users() -> None:
    try:
        users = await list_users_with_gmail_tokens()
    except Exception as e:
        logger.error(f"[ingest] Failed to list users: {e}")
        return

    if not users:
        return

    logger.info(f"[ingest] Starting cycle for {len(users)} user(s)")
    for user in users:
        try:
            await run_ingest_for_user(user)
        except Exception as e:
            logger.error(f"[ingest] Unhandled error for {user.get('email')}: {e}")


async def start_ingest_scheduler() -> None:
    interval = getattr(settings, "ingest_interval_seconds", 900)
    logger.info(f"[ingest] Scheduler started — interval {interval}s ({interval // 60} min)")

    while True:
        start = datetime.now(timezone.utc)
        logger.info(f"[ingest] Cycle starting at {start.isoformat()}")
        try:
            await _run_all_users()
        except Exception as e:
            logger.error(f"[ingest] Cycle failed: {e}", exc_info=True)
        elapsed = (datetime.now(timezone.utc) - start).total_seconds()
        sleep_for = max(0, interval - elapsed)
        logger.info(f"[ingest] Cycle done in {elapsed:.1f}s — sleeping {sleep_for:.0f}s")
        await asyncio.sleep(sleep_for)
