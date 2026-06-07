"""Orchestrates Gmail fetch → queue → LLM processing for one user."""

from services.producer import fetch_and_queue_new_emails
from services.consumer import process_queue_batch


async def sync_user_inbox(user_email: str, batch_size: int = 25) -> dict:
    """
    Full sync: pull unread Gmail messages into the queue, then process up to
    batch_size jobs synchronously (suitable for manual 'Sync now' clicks).
    """
    await fetch_and_queue_new_emails(user_email)
    processed = await process_queue_batch(user_email, limit=batch_size)
    return {
        "user_email": user_email,
        "processed": processed,
        "message": f"Sync complete — {processed} email(s) processed",
    }
