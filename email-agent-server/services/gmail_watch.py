"""
services/gmail_watch.py — Gmail Push Watch Registration
 
Registers a Gmail Push watch for a user so Gmail notifies us of new mail
via Pub/Sub instead of us polling every minute.
 
Gmail watch expires after 7 days. We renew every 6 days via the ingest
scheduler (called inside run_ingest_for_user if expiry is close).
 
Usage in routes/auth.py (after label provision + bootstrap):
    from services.gmail_watch import register_watch
    await register_watch(user, creds)
 
GCP setup required (document in README):
    1. Create Pub/Sub topic
    2. Create push subscription → https://<server>/webhooks/gmail
    3. Set env: GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>
    4. Grant gmail-api-push@system.gserviceaccount.com publish permission on topic
"""

import asyncio
import logging
from datetime import datetime, timezone
 
from config import settings
from db.mongodb import get_collection
 
logger = logging.getLogger("gmail_watch")
 
USERS_COLLECTION = "users"


async def register_watch(user: dict, creds) -> bool:
    """
    Register (or renew) Gmail Push watch for a user.
 
    Stores history_id and watch expiry on the user document.
    Returns True on success, False on failure (non-fatal — cron is the fallback).
 
    Called:
        - Once after OAuth connect (bootstrap flow)
        - Every 6 days by ingest_scheduler for renewal
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
    expiration_ms = response.get("expiration")  # Unix ms string from Gmail
 
    # Store on user doc so push handler can use latest history_id
    col = get_collection(USERS_COLLECTION)
    await col.update_one(
        {"email": user_email},
        {
            "$set": {
                "gmail_history_id": str(history_id) if history_id else None,
                "gmail_watch_expiry_ms": int(expiration_ms) if expiration_ms else None,
                "gmail_watch_registered_at": datetime.now(timezone.utc),
            }
        },
    )
 
    expiry_days = (int(expiration_ms) / 1000 - datetime.now(timezone.utc).timestamp()) / 86400 if expiration_ms else 0
    logger.info(
        f"[watch] Registered for {user_email} — "
        f"historyId={history_id}, expires in {expiry_days:.1f} days"
    )
    return True




async def needs_renewal(user: dict) -> bool:
    """
    Returns True if the watch expires within 24 hours (time to renew).
    Called by ingest_scheduler before each cycle.
    """
    expiry_ms = user.get("gmail_watch_expiry_ms")
    if not expiry_ms:
        return True  # Never registered — register now
 
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    hours_left = (int(expiry_ms) - now_ms) / (1000 * 3600)
    return hours_left < 24
 
 
def _call_watch_api(creds, topic: str) -> dict:
    """
    Synchronous Gmail API call — run via asyncio.to_thread.
    Returns the watch response dict from Gmail API.
    """
    from googleapiclient.discovery import build
 
    service = build("gmail", "v1", credentials=creds)
    response = (
        service.users()
        .watch(
            userId="me",
            body={
                "topicName": topic,
                "labelIds": ["INBOX"],          # Only watch INBOX
                "labelFilterBehavior": "INCLUDE",
            },
        )
        .execute()
    )
    return response