"""Gmail fetch → pipeline triage for one user."""

import asyncio
import logging

from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_attention_labeled_emails, fetch_messages_for_triage
from config import settings
from models.user import find_user_by_email
from services.email_pipeline import process_incoming_email_pipeline

logger = logging.getLogger("sync")


async def sync_user_inbox(user_email: str, batch_size: int | None = None) -> dict:
    user = await find_user_by_email(user_email)
    if not user:
        return {"user_email": user_email, "processed": 0, "message": "User not found"}

    limit = batch_size or settings.sync_backlog_max_results
    creds = await get_gmail_credentials(user_email)
    backlog = await asyncio.to_thread(fetch_messages_for_triage, creds=creds, max_results=limit)
    label_map = {
        "OmniMind/Attention": user.get("gmail_label_attention_id"),
        "OmniMind/Processed": user.get("gmail_label_processed_id"),
    }

    attention_id = user.get("gmail_label_attention_id")
    attention_backlog = []
    if attention_id:
        attention_backlog = await asyncio.to_thread(
            fetch_attention_labeled_emails,
            creds=creds,
            attention_label_id=attention_id,
            max_results=limit,
            user_email=user_email,
        )

    queued = 0
    for msg_meta in attention_backlog:
        asyncio.create_task(
            process_incoming_email_pipeline(
                user=user,
                email_meta=msg_meta,
                label_map=label_map,
                creds=creds,
                reprocess_attention=True,
            )
        )
        queued += 1

    for msg_meta in backlog[:limit]:
        asyncio.create_task(
            process_incoming_email_pipeline(user=user, email_meta=msg_meta, label_map=label_map, creds=creds)
        )
        queued += 1

    return {
        "user_email": user_email,
        "processed": queued,
        "message": f"Sync initiated — {queued} message(s) queued for triage/auto-reply",
    }
