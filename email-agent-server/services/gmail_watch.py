"""
services/gmail_watch.py — Gmail Push Watch Registration

Registers a Gmail Push watch for a user so Gmail notifies us of new mail
via Pub/Sub instead of us polling every minute.

Gmail watch expires after 7 days. We renew every 6 days via the ingest
scheduler (called inside run_ingest_for_user if expiry is close).
"""

import asyncio
import logging
from datetime import datetime, timezone

from config import settings
from models.user import update_gmail_watch_state

logger = logging.getLogger("gmail_watch")


async def register_watch(user: dict, creds) -> bool:
    """
    Register (or renew) Gmail Push watch for a user.
    Stores history_id and watch expiry on email_agent_users.
    """
    if not getattr(settings, "gmail_push_enabled", False):
        logger.info("[watch] Gmail Push disabled in config — skipping watch registration")
        return False

    topic = getattr(settings, "gmail_pubsub_topic", "")
    if not topic:
        logger.warning("[watch] GMAIL_PUBSUB_TOPIC not set — skipping watch registration")
        return False

    user_email = user.get("email")
    if not user_email:
        return False

    try:
        response = await asyncio.to_thread(_call_watch_api, creds, topic)
    except Exception as e:
        logger.error(f"[watch] Failed to register watch for {user_email}: {e}")
        return False

    history_id = response.get("historyId")
    expiration_ms = response.get("expiration")

    await update_gmail_watch_state(
        user_email,
        history_id=str(history_id) if history_id else None,
        expiry_ms=int(expiration_ms) if expiration_ms else None,
    )

    expiry_days = (
        (int(expiration_ms) / 1000 - datetime.now(timezone.utc).timestamp()) / 86400
        if expiration_ms else 0
    )
    logger.info(
        f"[watch] Registered for {user_email} — "
        f"historyId={history_id}, expires in {expiry_days:.1f} days"
    )
    return True


async def needs_renewal(user: dict) -> bool:
    """True if the watch expires within 24 hours."""
    expiry_ms = user.get("gmail_watch_expiry_ms")
    if not expiry_ms:
        return True

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    hours_left = (int(expiry_ms) - now_ms) / (1000 * 3600)
    return hours_left < 24


def _call_watch_api(creds, topic: str) -> dict:
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=creds)
    return (
        service.users()
        .watch(
            userId="me",
            body={
                "topicName": topic,
                "labelIds": ["INBOX"],
                "labelFilterBehavior": "INCLUDE",
            },
        )
        .execute()
    )
