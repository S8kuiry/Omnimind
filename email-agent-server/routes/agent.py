"""
routes/agent.py — Email Agent Overview

Plan says: replace POST /agents/email/sync metrics storm
with a thin GET wrapper to /emails/stats.

Old behaviour (removed):
  POST /agents/email/sync triggered a full Gmail fetch + triage pipeline
  just to show stats on the dashboard — hammering Gmail API on every page load.

New behaviour:
  GET /agents/email → reads pre-aggregated daily rollups from MongoDB
  No Gmail API calls. No pipeline trigger. Just DB reads.

The agent overview page calls this for the 7-day stat cards.
Live stat bar uses WS metrics_updated events instead of polling here.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from models.user import find_user_by_email
from models.metrics_daily import get_rollup, get_today

logger = logging.getLogger("routes.agent")

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/email")
async def get_email_agent_overview(
    user_email: str = Query(...),
    period: int = Query(7, ge=1, le=30, description="Number of days to roll up"),
):
    """
    Returns aggregated metrics for the email agent overview page.

    Reads from email_agent_metrics_daily — no Gmail API call, no pipeline trigger.
    Fast: single MongoDB query over N daily documents.

    Frontend (page.tsx) calls this once on mount.
    Stat bar updates live via WS metrics_updated — no polling here.
    """
    if not user_email:
        raise HTTPException(status_code=400, detail="user_email is required")

    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(status_code=404, detail=f"No account found for {user_email}")

    # 7-day rollup for overview cards
    rollup = await get_rollup(user_email, n_days=period)

    # Today's breakdown for the "today" card
    today = await get_today(user_email)

    return {
        # Overview stat cards (7-day)
        "auto_replies_total": rollup.get("auto_resolved", 0),
        "system_dropped_total": rollup.get("spam_blocked", 0),
        "manual_attention_historical_total": rollup.get("attention_queued", 0),
        "user_reviewed_total": rollup.get("user_reviewed", 0),
        "user_replied_total": rollup.get("user_replied", 0),
        "automation_rate": rollup.get("automation_rate", 0.0),
        "period_days": period,

        # Today breakdown
        "auto_resolved_today": today.get("auto_resolved", 0),
        "spam_blocked_today": today.get("spam_blocked", 0),
        "attention_queued_today": today.get("attention_queued", 0),
        "auto_send_count_today": today.get("auto_send_count", 0),
        "auto_ack_count_today": today.get("auto_ack_count", 0),
    }