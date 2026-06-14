"""
services/gmail_push_handler.py — Gmail Push Notification Handler

Called by routes/webhooks.py after it decodes the Pub/Sub envelope.
Receives (user_email, history_id) and:
  1. Looks up the user + credentials
  2. Calls Gmail history.list to find messages added since last known history_id
  3. Runs each new message through the pipeline
  4. Updates stored history_id for next push

This is the instant path — new mail hits the dashboard within seconds.
The 15-min cron is the fallback safety net.
"""

import asyncio
import logging

from db.mongodb import get_collection
from lib.google_client import get_gmail_credentials
from models.user import find_user_by_email

logger = logging.getLogger("gmail_push_handler")

USERS_COLLECTION = "users"


async def handle_gmail_push(user_email: str, history_id: str) -> None:
    """
    Entry point called by routes/webhooks.py as a background task.

    Fetches what changed since the stored history_id,
    runs new messages through the pipeline.
    """
    user = await find_user_by_email(user_email)
    if not user:
        logger.warning(f"[push] No user found for {user_email}, ignoring")
        return

    # Need stored history_id to know what's new since last notification
    stored_history_id = user.get("gmail_history_id")
    if not stored_history_id:
        logger.warning(
            f"[push] No stored history_id for {user_email} — "
            "can't do history.list, skipping. Will be caught by next cron cycle."
        )
        # Update to current history_id for future pushes
        await _update_history_id(user_email, history_id)
        return

    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as e:
        logger.error(f"[push] Could not get credentials for {user_email}: {e}")
        return

    # Fetch message IDs added since stored_history_id
    try:
        new_message_ids = await asyncio.to_thread(
            _fetch_new_message_ids,
            creds=creds,
            start_history_id=stored_history_id,
        )
    except Exception as e:
        logger.error(f"[push] history.list failed for {user_email}: {e}")
        # Still update history_id — don't fall behind permanently
        await _update_history_id(user_email, history_id)
        return

    # Update stored history_id immediately — don't reprocess on next push
    await _update_history_id(user_email, history_id)

    if not new_message_ids:
        logger.debug(f"[push] No new messages for {user_email} since historyId={stored_history_id}")
        return

    logger.info(f"[push] {len(new_message_ids)} new message(s) for {user_email}")

    label_map = {
        "OmniMind/Attention": user.get("gmail_label_attention_id"),
        "OmniMind/Processed": user.get("gmail_label_processed_id"),
    }

    if not label_map["OmniMind/Attention"] or not label_map["OmniMind/Processed"]:
        logger.warning(f"[push] Labels not provisioned for {user_email}, skipping")
        return

    # Fetch minimal metadata for each new message, then pipeline
    from services.email_pipeline import process_incoming_email_pipeline

    tasks = []
    for msg_id in new_message_ids:
        try:
            email_meta = await asyncio.to_thread(
                _fetch_message_metadata, creds=creds, message_id=msg_id
            )
            if email_meta:
                tasks.append(
                    asyncio.create_task(
                        process_incoming_email_pipeline(
                            user=user,
                            email_meta=email_meta,
                            label_map=label_map,
                            creds=creds,
                        )
                    )
                )
        except Exception as e:
            logger.error(f"[push] Failed to fetch metadata for {msg_id}: {e}")

    if tasks:
        results = await asyncio.gather(*tasks, return_exceptions=True)
        errors = [r for r in results if isinstance(r, Exception)]
        if errors:
            logger.error(f"[push] {len(errors)} pipeline errors for {user_email}")

    logger.info(f"[push] Handled {len(tasks)} message(s) for {user_email}")


async def _update_history_id(user_email: str, history_id: str) -> None:
    """Persist the latest history_id so next push knows where to start."""
    try:
        col = get_collection(USERS_COLLECTION)
        await col.update_one(
            {"email": user_email},
            {"$set": {"gmail_history_id": history_id}},
        )
    except Exception as e:
        logger.error(f"[push] Failed to update history_id for {user_email}: {e}")


def _fetch_new_message_ids(creds, start_history_id: str) -> list[str]:
    """
    Synchronous Gmail history.list call — run via asyncio.to_thread.
    Returns list of message IDs added since start_history_id.
    """
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=creds)
    response = (
        service.users()
        .history()
        .list(
            userId="me",
            startHistoryId=start_history_id,
            historyTypes=["messageAdded"],
            labelId="INBOX",
        )
        .execute()
    )

    message_ids = []
    for record in response.get("history", []):
        for msg in record.get("messagesAdded", []):
            msg_id = msg.get("message", {}).get("id")
            if msg_id:
                message_ids.append(msg_id)

    # Deduplicate — same message can appear in multiple history records
    return list(dict.fromkeys(message_ids))


def _fetch_message_metadata(creds, message_id: str) -> dict | None:
    """
    Fetch minimal metadata for one message.
    Returns the same shape that fetch_messages_for_triage returns.
    """
    from googleapiclient.discovery import build

    service = build("gmail", "v1", credentials=creds)
    msg = (
        service.users()
        .messages()
        .get(
            userId="me",
            id=message_id,
            format="metadata",
            metadataHeaders=["From", "Subject", "Date"],
        )
        .execute()
    )

    if not msg:
        return None

    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    from_raw = headers.get("from", "")
    from_name, from_address = _parse_from(from_raw)

    return {
        "id": msg["id"],
        "threadId": msg.get("threadId", ""),
        "labelIds": msg.get("labelIds", []),
        "snippet": msg.get("snippet", ""),
        "from_name": from_name,
        "from_address": from_address,
        "subject": headers.get("subject", ""),
        "date": headers.get("date", ""),
    }


def _parse_from(from_raw: str) -> tuple[str, str]:
    """Parse 'Name <email@example.com>' into (name, email)."""
    if "<" in from_raw and ">" in from_raw:
        name = from_raw[:from_raw.index("<")].strip().strip('"')
        address = from_raw[from_raw.index("<") + 1: from_raw.index(">")].strip()
        return name, address.lower()
    return "", from_raw.strip().lower()