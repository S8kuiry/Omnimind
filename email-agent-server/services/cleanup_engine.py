import asyncio
import logging

from config import settings
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_old_unread_messages, batch_move_to_trash
from models.user import list_users_with_gmail_tokens, get_cleanup_settings
from models.event import log_agent_event
from routes.emails import _broadcast_metrics

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
                    if old_ids:
                        logger.info(f"Trashing {len(old_ids)} old unread messages for {user_email}")
                        await asyncio.to_thread(batch_move_to_trash, creds=creds, message_ids=old_ids)

                        for msg_id in old_ids:
                            await log_agent_event(user_email, "inbox_cleaned", message_id=msg_id)

                        await _broadcast_metrics(user_email)
                except Exception as user_err:
                    logger.error(f"Cleanup error for {user_email}: {user_err}")
        except Exception as exc:
            logger.error(f"Cleanup daemon failure: {exc}")

        await asyncio.sleep(settings.cleanup_interval_seconds)
