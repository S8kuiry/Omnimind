import asyncio
import logging

from config import settings
from services.daily_jobs import run_gmail_cleanup_all

logger = logging.getLogger("cleanup_engine")


async def start_cleanup_engine():
    """Runs Gmail cleanup on each Pub/Sub wake window (same logic as /cron/daily)."""
    logger.info("Starting Gmail cleanup engine...")
    while True:
        try:
            await run_gmail_cleanup_all()
        except Exception as exc:
            logger.error(f"Cleanup daemon failure: {exc}")

        await asyncio.sleep(settings.cleanup_interval_seconds)
