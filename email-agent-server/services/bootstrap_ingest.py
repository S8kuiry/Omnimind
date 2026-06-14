"""
services/bootstrap_ingest.py — First Session Bootstrap
 
Called ONCE after a user connects Gmail (OAuth callback in routes/auth.py).
Fetches today's 20 most recent untriaged messages and runs them through the pipeline.
 
This gives the user an immediate populated dashboard instead of waiting
for the first 15-min cron cycle.
 
Usage in routes/auth.py (after label provision):
    from services.bootstrap_ingest import run_bootstrap_ingest
    asyncio.create_task(run_bootstrap_ingest(user))
"""

import asyncio
import logging

from config import settings
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_today_untriaged_batch
 
logger = logging.getLogger("bootstrap_ingest")



async def run_bootstrap_ingest(user: dict) -> None:
    """
    Fetch today's untriaged batch and run pipeline for each message.
    Runs as a background task — non-blocking, won't delay OAuth response.
 
    Uses newer_than:1d query so we only process today's mail,
    not the user's entire inbox history.
    """
    user_email = user.get("email")
    if not user_email:
        return
 
    label_map = {
        "OmniMind/Attention": user.get("gmail_label_attention_id"),
        "OmniMind/Processed": user.get("gmail_label_processed_id"),
    }
 
    if not label_map["OmniMind/Attention"] or not label_map["OmniMind/Processed"]:
        logger.warning(f"[bootstrap] Labels not provisioned for {user_email}, skipping")
        return
 
    logger.info(f"[bootstrap] Starting first-session ingest for {user_email}")
 
    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as e:
        logger.error(f"[bootstrap] Could not get credentials for {user_email}: {e}")
        return
 
    try:
        # fetch_today_untriaged_batch uses newer_than:1d + max 20
        messages = await asyncio.to_thread(
            fetch_today_untriaged_batch,
            creds=creds,
            max_results=settings.ingest_batch_size,  # 20
        )
    except Exception as e:
        logger.error(f"[bootstrap] Gmail fetch failed for {user_email}: {e}")
        return
 
    if not messages:
        logger.info(f"[bootstrap] No messages to bootstrap for {user_email}")
        return
 
    logger.info(f"[bootstrap] Processing {len(messages)} messages for {user_email}")
 
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
        logger.error(f"[bootstrap] {len(errors)} errors during bootstrap for {user_email}")
 
    logger.info(
        f"[bootstrap] Done for {user_email} — "
        f"{len(messages) - len(errors)}/{len(messages)} processed successfully"
    )