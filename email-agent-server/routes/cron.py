"""
routes/cron.py — Manual Ingest Trigger
 
POST /cron/ingest  — triggers one full ingest cycle manually (admin/debug only)
 
This is NOT how ingest normally runs.
Normal ingest runs automatically every 15 minutes via ingest_scheduler.py.
This route exists so you can:
  - test the pipeline without waiting 15 minutes
  - debug a stuck user's inbox
  - trigger a one-off backfill from Render/cURL
 
No auth guard for now — add an API key header before exposing publicly.
"""

import logging
from  fastapi import APIRouter,BackgroundTasks,HTTPException,Query
from models.user import find_user_by_email
logger = logging.getLogger('routes.cron')
router = APIRouter(prefix="/cron",tags=["cron"])



@router.post("/ingest")
async def trigger_ingest(
    background_tasks: BackgroundTasks,
    user_email: str = Query(..., description="Run ingest for this specific user"),
):
    """
    Manually trigger one ingest cycle for a user.
    Runs in background — returns immediately.
 
    Usage:
        POST /cron/ingest?user_email=you@gmail.com
    """
    # Import here to avoid circular imports at module load time
    from services.ingest_scheduler import run_ingest_for_user
 
    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(status_code=404, detail=f"No user found for {user_email}")
 
    if not user.get("gmail_access_token"):
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
    """
    Quick check — returns today's seen + metrics counts for a user.
    Useful to verify the pipeline is actually processing emails.
    """
    from models.seen import count_by_outcome
    from models.metrics_daily import get_today
 
    outcomes = await count_by_outcome(user_email)
    today = await get_today(user_email)
 
    return {
        "user_email": user_email,
        "seen_outcomes": outcomes,
        "metrics_today": today,
    }
 