"""
routes/cron.py — Manual Ingest Trigger

POST /cron/ingest  — triggers one full ingest cycle manually (admin/debug only)

Normal ingest runs automatically every 15 minutes via ingest_scheduler.py.
"""

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from models.user import find_user_by_email

logger = logging.getLogger("routes.cron")
router = APIRouter(prefix="/cron", tags=["cron"])


@router.post("/ingest")
async def trigger_ingest(
    background_tasks: BackgroundTasks,
    user_email: str = Query(..., description="Run ingest for this specific user"),
):
    from services.ingest_scheduler import run_ingest_for_user

    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(status_code=404, detail=f"No user found for {user_email}")

    if not user.get("gmail_access_token") and not user.get("oauth_token", {}).get("refresh_token") and not user.get("google_refresh_token"):
        raise HTTPException(status_code=400, detail=f"User {user_email} has no Gmail token")

    background_tasks.add_task(run_ingest_for_user, user)

    logger.info(f"[cron] Manual ingest triggered for {user_email}")
    return {
        "status": "triggered",
        "user_email": user_email,
        "message": "Ingest cycle started in background",
    }


@router.get("/status")
async def ingest_status(user_email: str = Query(...)):
    from models.seen import count_by_outcome
    from models.metrics_daily import get_today

    outcomes = await count_by_outcome(user_email)
    today = await get_today(user_email)

    return {
        "user_email": user_email,
        "seen_outcomes": outcomes,
        "metrics_today": today,
    }
