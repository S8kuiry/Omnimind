import asyncio
import logging

from config import settings
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_old_unread_messages, batch_move_to_trash
from models.user import list_users_with_gmail_tokens

logger = logging.getLogger("cleanup_engine")


async def start_cleanup_engine():
    logger.info("Starting Gmail cleanup engine...")
    while True:
        try:
            users = await list_users_with_gmail_tokens()
            for user in users:
                user_email = user.get("email")
                if not user_email:
                    continue
                try:
                    creds = await get_gmail_credentials(user_email)
                    old_ids = await asyncio.to_thread(
                        fetch_old_unread_messages,
                        creds=creds,
                        batch_size=settings.cleanup_batch_size,
                    )
                    if old_ids:
                        logger.info(f"Trashing {len(old_ids)} old unread messages for {user_email}")
                        await asyncio.to_thread(batch_move_to_trash, creds=creds, message_ids=old_ids)
                except Exception as user_err:
                    logger.error(f"Cleanup error for {user_email}: {user_err}")
        except Exception as exc:
            logger.error(f"Cleanup daemon failure: {exc}")

        await asyncio.sleep(settings.cleanup_interval_seconds)
