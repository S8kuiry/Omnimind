"""
services/ingest_scheduler.py — 15-Minute Batch Ingest + Scheduled Notifications

Two jobs run in the same loop:
  1. Ingest — every 15 minutes for all users
  2. Notifications — daily at 3 fixed IST times:
       08:00 IST (02:30 UTC) → yesterday's complete summary
       18:00 IST (12:30 UTC) → today so far (workday snapshot)
       23:30 IST (18:00 UTC) → today's final daily tally

Start from main.py:
    asyncio.create_task(start_ingest_scheduler())
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from config import settings
from models.user import list_users_with_gmail_tokens
from lib.google_client import get_gmail_credentials
from lib.gmail_client import fetch_messages_for_triage

logger = logging.getLogger("ingest_scheduler")

# ── Notification slots (UTC hour, minute, label, subject prefix) ───
# IST = UTC + 5:30
NOTIFICATION_SLOTS = [
    (2,  30, "morning", "☀️ Yesterday's"),   # 08:00 IST — overnight digest
    (12, 30, "evening", "🌆 Today's"),        # 18:00 IST — workday snapshot
    (18,  0, "night",   "🌙 Final Daily"),    # 23:30 IST — end-of-day tally
]


# ── Ingest ─────────────────────────────────────────────────────────

async def run_ingest_for_user(user: dict) -> None:
    user_email = user.get("email")
    if not user_email:
        return

    label_map = {
        "OmniMind/Attention": user.get("gmail_label_attention_id"),
        "OmniMind/Processed": user.get("gmail_label_processed_id"),
    }

    if not label_map["OmniMind/Attention"] or not label_map["OmniMind/Processed"]:
        logger.debug(f"[ingest] Skipping {user_email} — labels not provisioned")
        return

    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as e:
        logger.warning(f"[ingest] Could not get credentials for {user_email}: {e}")
        return

    try:
        from services.gmail_watch import needs_renewal, register_watch
        if await needs_renewal(user):
            await register_watch(user, creds)
    except Exception as e:
        logger.warning(f"[ingest] Watch renewal skipped for {user_email}: {e}")

    try:
        messages = await asyncio.to_thread(
            fetch_messages_for_triage,
            creds=creds,
            max_results=settings.ingest_batch_size,
        )
    except Exception as e:
        logger.error(f"[ingest] Gmail fetch failed for {user_email}: {e}")
        return

    if not messages:
        logger.debug(f"[ingest] No untriaged messages for {user_email}")
        return

    logger.info(f"[ingest] {len(messages)} messages to process for {user_email}")

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
        logger.error(f"[ingest] {len(errors)} pipeline errors for {user_email}: {errors[0]}")

    logger.info(
        f"[ingest] Cycle complete for {user_email} — "
        f"{len(messages) - len(errors)}/{len(messages)} processed"
    )


async def _run_all_users() -> None:
    try:
        users = await list_users_with_gmail_tokens()
    except Exception as e:
        logger.error(f"[ingest] Failed to list users: {e}")
        return

    if not users:
        return

    logger.info(f"[ingest] Starting cycle for {len(users)} user(s)")
    for user in users:
        try:
            await run_ingest_for_user(user)
        except Exception as e:
            logger.error(f"[ingest] Unhandled error for {user.get('email')}: {e}")


# ── Notifications ──────────────────────────────────────────────────

def _next_trigger_seconds(hour_utc: int, minute_utc: int) -> float:
    """
    Returns seconds until the next occurrence of (hour_utc, minute_utc).
    If the time already passed today, schedules for tomorrow.
    """
    now = datetime.now(timezone.utc)
    target_today = now.replace(hour=hour_utc, minute=minute_utc, second=0, microsecond=0)
    target = target_today if now < target_today else target_today + timedelta(days=1)
    return (target - now).total_seconds()


async def _send_notification_for_user(
    user: dict,
    slot_label: str,
    subject_prefix: str,
) -> None:
    """
    Fetch the right metrics for this slot and email them to the user.

    morning → yesterday's complete data   (day is fully over, clean numbers)
    evening → today so far                (workday snapshot)
    night   → today's final tally         (day essentially complete at 11:30pm)
    """
    from routes.notifications import send_gmail_sync, generate_metrics_html
    from models.metrics_daily import get_today, get_last_n_days

    user_email = user.get("email")
    if not user_email:
        return

    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as e:
        logger.warning(f"[notify] No credentials for {user_email}: {e}")
        return

    try:
        if slot_label == "morning":
            # Pull yesterday — index 0 is oldest when n=2, so [0] = yesterday
            days = await get_last_n_days(user_email, n=2)
            raw = days[0] if days else {}
        else:
            # Evening snapshot + night final both use today's live counters
            raw = await get_today(user_email)

        # Normalise field names to match generate_metrics_html expectations
        stats = {
            "auto_replies_total":               raw.get("auto_resolved", 0),
            "system_dropped_total":             raw.get("spam_blocked", 0),
            "manual_attention_historical_total": raw.get("attention_queued", 0),
        }

        subject_map = {
            "morning": "☀️ Yesterday's Email Agent Summary",
            "evening": "🌆 Today's Email Agent Summary (Workday)",
            "night":   "🌙 Final Daily Email Agent Summary",
        }

        html = generate_metrics_html(user_email, stats)
        await asyncio.to_thread(
            send_gmail_sync,
            creds,
            user_email,
            html,
            subject=subject_map[slot_label],
        )

        logger.info(f"[notify] {slot_label} email sent to {user_email}")

    except Exception as e:
        logger.error(f"[notify] Error for {user_email} ({slot_label}): {e}", exc_info=True)


async def _send_slot_to_all_users(slot_label: str, subject_prefix: str) -> None:
    try:
        users = await list_users_with_gmail_tokens()
    except Exception as e:
        logger.error(f"[notify] Failed to list users for {slot_label}: {e}")
        return

    if not users:
        return

    logger.info(f"[notify] Sending {slot_label} notification to {len(users)} user(s)")
    for user in users:
        try:
            await _send_notification_for_user(user, slot_label, subject_prefix)
        except Exception as e:
            logger.error(f"[notify] Failed for {user.get('email')} ({slot_label}): {e}")


async def _notification_scheduler() -> None:
    """
    Launches 3 independent slot tasks in parallel.
    Each slot sleeps until its next UTC time, fires, then repeats every 24h.
    If one slot crashes it doesn't affect the others.
    """
    async def _run_slot(hour: int, minute: int, label: str, prefix: str) -> None:
        while True:
            wait = _next_trigger_seconds(hour, minute)
            h, m = int(wait // 3600), int((wait % 3600) // 60)
            logger.info(f"[notify] {label} slot fires in {h}h {m}m")
            await asyncio.sleep(wait)

            logger.info(f"[notify] Firing {label} slot")
            await _send_slot_to_all_users(label, prefix)

            # Sleep 23h 55m — wakes up just before next trigger, avoids drift
            await asyncio.sleep(23 * 3600 + 55 * 60)

    await asyncio.gather(*[
        _run_slot(hour, minute, label, prefix)
        for hour, minute, label, prefix in NOTIFICATION_SLOTS
    ], return_exceptions=True)


# ── Main entry point ───────────────────────────────────────────────

async def start_ingest_scheduler() -> None:
    """
    Starts two concurrent infinite loops:
      1. _ingest_loop        — every 15 min
      2. _notification_scheduler — 3 daily slots (8am, 6pm, 11:30pm IST)

    Called once from main.py lifespan:
        asyncio.create_task(start_ingest_scheduler())
    """
    interval = getattr(settings, "ingest_interval_seconds", 900)

    # Log all slot times clearly on startup
    logger.info(f"[ingest] Scheduler started — interval {interval}s ({interval // 60} min)")
    for hour, minute, label, _ in NOTIFICATION_SLOTS:
        # Convert UTC → IST for the log message
        ist_hour = (hour + 5) % 24
        ist_minute = (minute + 30) % 60
        if minute + 30 >= 60:
            ist_hour = (ist_hour + 1) % 24
        logger.info(
            f"[notify] {label:7s} slot → "
            f"{ist_hour:02d}:{ist_minute:02d} IST  "
            f"({hour:02d}:{minute:02d} UTC)"
        )

    async def _ingest_loop() -> None:
        while True:
            start = datetime.now(timezone.utc)
            logger.info(f"[ingest] Cycle starting at {start.isoformat()}")
            try:
                await _run_all_users()
            except Exception as e:
                logger.error(f"[ingest] Cycle failed: {e}", exc_info=True)
            elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            sleep_for = max(0, interval - elapsed)
            logger.info(f"[ingest] Cycle done in {elapsed:.1f}s — sleeping {sleep_for:.0f}s")
            await asyncio.sleep(sleep_for)

    # Both loops run forever — if gather catches an exception from one,
    # return_exceptions=True keeps the other running
    await asyncio.gather(
        _ingest_loop(),
        _notification_scheduler(),
        return_exceptions=True,
    )