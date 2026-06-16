"""
services/daily_jobs.py — Scheduled daily maintenance (triggered by external cron).

Pub/Sub + ingest_scheduler handle live mail fetching. This module runs:
  1. Gmail cleanup — old unread → Trash (per-user retention settings)
  2. MongoDB retention — purge stale DB rows
  3. Final daily stats email — sent to all connected users

Extend by adding steps to DAILY_STEPS or new run_* helpers.
"""

import asyncio
import logging

from config import settings
from db.mongodb import is_db_connected
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_old_unread_messages, batch_move_to_trash
from models.event import log_agent_event
from models.metrics_daily import get_today
from models.user import list_users_with_gmail_tokens, get_cleanup_settings
from routes.emails import _broadcast_metrics
from services.db_retention import run_db_retention_once
from services.stats_email import (
    FINAL_DAILY_SUBJECT,
    generate_metrics_html,
    send_gmail_sync,
)

logger = logging.getLogger("daily_jobs")


async def run_gmail_cleanup_all() -> dict:
    """Trash old unread inbox mail for every user with cleanup enabled."""
    users = await list_users_with_gmail_tokens()
    summary: dict = {"users_processed": 0, "messages_trashed": 0, "errors": []}

    for user in users:
        user_email = user.get("email")
        if not user_email:
            continue

        cleanup_settings = get_cleanup_settings(user)
        if not cleanup_settings["enabled"]:
            continue

        try:
            creds = await get_gmail_credentials(user_email)
            old_ids = await asyncio.to_thread(
                fetch_old_unread_messages,
                creds=creds,
                batch_size=settings.cleanup_batch_size,
                older_than_days=cleanup_settings["older_than_days"],
            )
            if not old_ids:
                summary["users_processed"] += 1
                continue

            logger.info(f"[daily] Trashing {len(old_ids)} old unread for {user_email}")
            await asyncio.to_thread(batch_move_to_trash, creds=creds, message_ids=old_ids)

            for msg_id in old_ids:
                await log_agent_event(user_email, "inbox_cleaned", message_id=msg_id)

            await _broadcast_metrics(user_email)
            summary["users_processed"] += 1
            summary["messages_trashed"] += len(old_ids)
        except Exception as err:
            logger.error(f"[daily] Gmail cleanup failed for {user_email}: {err}")
            summary["errors"].append({"user": user_email, "error": str(err)})

    return summary


async def run_db_retention() -> dict:
    """Purge MongoDB rows older than db_retention_days."""
    if not is_db_connected():
        return {"skipped": True, "reason": "database not connected"}
    return await run_db_retention_once()


async def send_final_daily_stats() -> dict:
    """Email today's stats rollup to every connected user."""
    users = await list_users_with_gmail_tokens()
    summary: dict = {"users_notified": 0, "errors": []}

    for user in users:
        user_email = user.get("email")
        if not user_email:
            continue

        try:
            creds = await get_gmail_credentials(user_email)
            raw = await get_today(user_email)
            stats = {
                "auto_replies_total": raw.get("auto_resolved", 0),
                "system_dropped_total": raw.get("spam_blocked", 0),
                "manual_attention_historical_total": raw.get("attention_queued", 0),
                "inbox_cleaned_total": raw.get("inbox_cleaned", 0),
            }
            html = generate_metrics_html(user_email, stats)
            await asyncio.to_thread(
                send_gmail_sync,
                creds,
                user_email,
                html,
                FINAL_DAILY_SUBJECT,
            )
            summary["users_notified"] += 1
            logger.info(f"[daily] Final stats email sent to {user_email}")
        except Exception as err:
            logger.error(f"[daily] Stats email failed for {user_email}: {err}")
            summary["errors"].append({"user": user_email, "error": str(err)})

    return summary


async def run_daily_jobs() -> dict:
    """
    Run all daily maintenance steps in order.
    Called synchronously from GET /cron/daily so Render stays alive until done.
    """
    logger.info("[daily] Starting daily job bundle")
    results = {
        "gmail_cleanup": await run_gmail_cleanup_all(),
        "db_retention": await run_db_retention(),
        "notifications": await send_final_daily_stats(),
    }
    logger.info(f"[daily] Job bundle complete: {results}")
    return results
