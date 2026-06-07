"""Cron / manual sync triggers."""

from fastapi import APIRouter, HTTPException, Query

from db.mongodb import is_db_connected
from services.sync import sync_user_inbox

router = APIRouter(prefix="/cron", tags=["cron"])


@router.post("/sync")
async def cron_sync(user_email: str = Query(...)):
    """Manual sync — fetch unread Gmail + process queue (same as Sync Now)."""
    if not is_db_connected():
        raise HTTPException(503, "Database not connected")
    return await sync_user_inbox(user_email)
