import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from lib.google_client import get_gmail_credentials
from models.metrics_daily import get_today
from models.user import find_user_by_email
from services.stats_email import generate_metrics_html, send_gmail_sync

logger = logging.getLogger("routes.notifications")
router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationRequest(BaseModel):
    user_email: str


@router.get("/")
async def get_notifications(user_email: str = Query(...)):
    """Fetch recent alert activity logs for a user."""
    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "active", "user_email": user_email}


@router.post("/")
async def create_notification(payload: NotificationRequest):
    """Email today's stats rollup to the user via Gmail."""
    email = payload.user_email

    user = await find_user_by_email(email)
    if not user or "oauth_token" not in user:
        raise HTTPException(status_code=400, detail="User accounts or Gmail auth sync maps missing")

    try:
        creds = await get_gmail_credentials(email)
        stats_data = await get_today(email) or {}
        html_report = generate_metrics_html(email, {
            "auto_replies_total": stats_data.get("auto_resolved", 0),
            "system_dropped_total": stats_data.get("spam_blocked", 0),
            "manual_attention_historical_total": stats_data.get("attention_queued", 0),
            "inbox_cleaned_total": stats_data.get("inbox_cleaned", 0),
        })
        await asyncio.to_thread(send_gmail_sync, creds, email, html_report)
        logger.info(f"Stats report sent to {email}")
        return {"status": "success", "message": f"Metrics report sent to {email}"}
    except Exception as err:
        logger.error(f"Notification dispatch failure: {err}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Notification dispatch failure: {str(err)}") from err
