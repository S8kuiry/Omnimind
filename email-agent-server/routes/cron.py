"""
routes/cron.py — External cron triggers

GET /cron/daily  — Gmail cleanup + DB retention + final daily stats email
                   (runs synchronously; point cron-job.org here at 18:00 UTC)

POST /cron/ingest — manual ingest for one user (debug)
GET  /cron/status — per-user metrics snapshot (debug)
"""

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from models.user import find_user_by_email
from services.daily_jobs import run_daily_jobs

logger = logging.getLogger("routes.cron")
router = APIRouter(prefix="/cron", tags=["cron"])


@router.get("/daily")
async def trigger_daily_jobs():
    """
    Daily maintenance bundle for Render free tier.

    Pub/Sub handles live mail ingest while the server is awake.
    External cron (cron-job.org) should call this once per day at 18:00 UTC
    (23:30 IST) so all work completes inside the active request window.
    """
    try:
        results = await run_daily_jobs()
        return {"status": "ok", "results": results}
    except Exception as exc:
        logger.error(f"[cron] Daily jobs failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
