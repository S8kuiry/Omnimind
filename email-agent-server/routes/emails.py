"""
routes/emails.py — Attention Queue + Stats API

Changes from old version (per plan):
  1. Removed is_db_connected() gate on GET /emails — serve from cache instead
  2. GET /emails/stats reads from metrics_daily DB rollups — no Gmail fetch
  3. Added POST /{id}/dismiss alias (logs user_reviewed + mark_seen)
  4. POST /{id}/send logs user_replied + mark_seen + metrics_updated WS broadcast
  5. DELETE /{id} logs user_reviewed + mark_seen + metrics_updated WS broadcast
  6. POST /sync now returns deprecation notice — frontend must stop calling it
  7. Removed import of services/metrics.py (file does not exist in final structure)
  8. attention_cache used for analyze cache only — list comes from Gmail/localStorage
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from lib.google_client import get_gmail_credentials
from lib.gmail_client import (
    fetch_attention_labeled_emails,
    fetch_message_detail,
    send_gmail_reply,
    modify_labels,
)
from config import settings
from models.user import find_user_by_email
from models.event import log_agent_event
from models.seen import update_outcome, mark_seen, is_seen
from models.metrics_daily import get_rollup, get_today
from services.attention_cache import attention_cache
from services.ws_manager import ws_manager
from services.email_pipeline import process_incoming_email_pipeline, _build_card
from services.auto_reply_policy import is_system_drop_meta
from services.session_stats import session_stats
from services.llm.summarizer import generate_full_summary, regenerate_draft_with_tone

logger = logging.getLogger("routes.emails")

router = APIRouter(prefix="/emails", tags=["emails"])


# ── Request models ─────────────────────────────────────────────────────────

class RegenerateDraftRequest(BaseModel):
    user_email: str
    tone: str = "professional"
    context: str = ""


class SendReplyRequest(BaseModel):
    user_email: str
    to: str
    subject: str
    body: str
    provider: str = "gmail"


# ── Shared helpers ─────────────────────────────────────────────────────────

async def _require_user(user_email: str) -> dict:
    if not user_email:
        raise HTTPException(400, "user_email is required")
    user = await find_user_by_email(user_email)
    if not user:
        raise HTTPException(404, f"No Gmail connection for {user_email}")
    return user


def _enrich_notifications(cards: list[dict]) -> list[dict]:
    enriched = []
    for card in cards:
        msg_id = card.get("id") or card.get("provider_message_id")
        analysis = attention_cache.get_analysis(msg_id) if msg_id else None
        notification = card if card.get("_id") else _build_card(
            card,
            card.get("category", "work"),
            card.get("priority", "medium"),
        )
        if analysis:
            notification["summary"] = analysis.get("summary", notification.get("summary", ""))
            notification["draft_body"] = analysis.get("draft_body", notification.get("draft_body", ""))
        enriched.append(notification)
    return enriched


def _partition_system_drops(cards: list[dict]) -> tuple[list[dict], list[str]]:
    """Split attention cards into keep vs silently-drop (mail delivery failures, etc.)."""
    keep: list[dict] = []
    drop_ids: list[str] = []
    for card in cards:
        if is_system_drop_meta(card):
            msg_id = card.get("id") or card.get("provider_message_id") or card.get("_id")
            if msg_id:
                drop_ids.append(str(msg_id))
            continue
        keep.append(card)
    return keep, drop_ids


async def _silently_purge_system_drops(
    user: dict,
    user_email: str,
    message_ids: list[str],
) -> None:
    """Remove mislabeled system mail from Attention → Processed in Gmail."""
    if not message_ids:
        return
    try:
        creds = await get_gmail_credentials(user_email)
    except Exception as exc:
        logger.warning(f"Could not purge system drops for {user_email}: {exc}")
        return

    processed_id = user.get("gmail_label_processed_id")
    attention_id = user.get("gmail_label_attention_id")
    purged = 0

    for message_id in message_ids:
        try:
            remove_ids = ["UNREAD"]
            if attention_id:
                remove_ids.append(attention_id)
            await asyncio.to_thread(
                modify_labels,
                creds=creds,
                message_id=message_id,
                add_label_ids=[processed_id] if processed_id else None,
                remove_label_ids=remove_ids,
            )
            attention_cache.invalidate_email(user_email, message_id)
            session_stats.record_dropped(user_email)
            await log_agent_event(
                user_email,
                "spam_blocked",
                message_id=message_id,
                meta={"reason": "mail_delivery_subsystem"},
            )
            await ws_manager.broadcast_to_user(
                user_email, {"event": "email_removed", "id": message_id}
            )
            purged += 1
        except Exception as exc:
            logger.warning(f"Failed to purge system drop {message_id} for {user_email}: {exc}")

    if purged:
        await _broadcast_metrics(user_email)
        logger.info(f"Silently purged {purged} system-drop message(s) for {user_email}")


def _filter_cards(cards: list[dict], category: str | None, priority: str | None) -> list[dict]:
    result = cards
    if category and category != "all":
        result = [c for c in result if c.get("category") == category]
    if priority and priority != "all":
        result = [c for c in result if c.get("priority") == priority]
    return result


async def _load_attention_list(user: dict, user_email: str, *, force_refresh: bool = False) -> list[dict]:
    """
    Load the attention list.
    Cache-first: serve from attention_cache if available.
    Falls back to Gmail API fetch and repopulates cache.
    System-delivery failures are never returned — purged from Gmail in background.
    """
    if not force_refresh:
        cached = attention_cache.get_emails(user_email)
        if cached is not None:
            keep, drop_ids = _partition_system_drops(cached)
            if drop_ids:
                attention_cache.set_emails(user_email, keep)
                asyncio.create_task(_silently_purge_system_drops(user, user_email, drop_ids))
            return keep

    attention_id = user.get("gmail_label_attention_id")
    if not attention_id:
        return []

    try:
        creds = await get_gmail_credentials(user_email)
        live = await asyncio.to_thread(
            fetch_attention_labeled_emails,
            creds=creds,
            attention_label_id=attention_id,
        )
        keep, drop_ids = _partition_system_drops(live)
        if drop_ids:
            asyncio.create_task(_silently_purge_system_drops(user, user_email, drop_ids))
        notifications = _enrich_notifications(keep)
        attention_cache.set_emails(user_email, notifications)
        return notifications
    except Exception:
        # Serve stale cache rather than failing — no DB gate
        fallback = attention_cache.get_emails_even_expired(user_email)
        if fallback is not None:
            keep, drop_ids = _partition_system_drops(fallback)
            if drop_ids:
                asyncio.create_task(_silently_purge_system_drops(user, user_email, drop_ids))
            return keep
        raise


async def _broadcast_metrics(user_email: str) -> None:
    """
    Broadcast current metrics to the frontend after any state change.
    Frontend stat bar updates live — no polling needed.
    """
    try:
        today = await get_today(user_email)
        rollup = await get_rollup(user_email, n_days=7)
        active_cards = len(attention_cache.get_emails(user_email) or [])
        stats = session_stats.get_stats(user_email)

        handled = today.get("auto_resolved", 0) + today.get("spam_blocked", 0)
        total_seen = handled + today.get("attention_queued", 0)
        rate = round((handled / total_seen) * 100, 1) if total_seen > 0 else 0.0

        await ws_manager.broadcast_to_user(
            user_email,
            {
                "event": "metrics_updated",
                "data": {
                    "auto_replies_total": today.get("auto_resolved", 0),
                    "system_dropped_total": today.get("spam_blocked", 0),
                    "manual_attention_historical_total": today.get("attention_queued", 0),
                    "current_active_buffer_cards": active_cards,
                    "automation_rate": rate,
                    "inbox_cleaned_total": rollup.get("inbox_cleaned", 0),
                },
            },
        )
    except Exception as e:
        logger.warning(f"metrics_updated broadcast failed for {user_email}: {e}")


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_emails(
    user_email: str = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    category: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    refresh: bool = Query(False),
):
    """
    Returns the attention queue.
    FIX 1: No is_db_connected() gate — serve from cache if DB is down.
    """
    user = await _require_user(user_email)
    if refresh:
        attention_cache.invalidate_list(user_email)
    try:
        all_cards = await _load_attention_list(user, user_email, force_refresh=refresh)
    except Exception as exc:
        raise HTTPException(503, f"Gmail API unavailable: {exc}") from exc

    filtered = _filter_cards(all_cards, category, priority)
    total = len(filtered)
    start = (page - 1) * page_size
    page_cards = filtered[start: start + page_size]
    total_pages = max(1, (total + page_size - 1) // page_size)

    return {
        "notifications": page_cards,
        "total_active_cards": total,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/stats")
async def email_stats(
    user_email: str = Query(...),
    period: int = Query(7, ge=1, le=30),
):
    """
    Returns aggregated metrics for the stat bar.
    FIX 2: Reads from metrics_daily DB rollups only — no Gmail fetch.
    FIX 7: No import of services/metrics.py.
    """
    await _require_user(user_email)

    rollup = await get_rollup(user_email, n_days=period)
    today = await get_today(user_email)
    active_cards = len(attention_cache.get_emails(user_email) or [])

    handled = today.get("auto_resolved", 0) + today.get("spam_blocked", 0)
    total_seen = handled + today.get("attention_queued", 0)
    rate = round((handled / total_seen) * 100, 1) if total_seen > 0 else 0.0

    return {
        # Stat bar fields (frontend EmailStats.tsx)
        "current_active_buffer_cards": active_cards,
        "auto_replies_total": rollup.get("auto_resolved", 0),
        "system_dropped_total": rollup.get("spam_blocked", 0),
        "manual_attention_historical_total": rollup.get("attention_queued", 0),
        "inbox_cleaned_total": rollup.get("inbox_cleaned", 0),
        "automation_rate": rollup.get("automation_rate", 0.0),

        # Today breakdown
        "auto_resolved_today": today.get("auto_resolved", 0),
        "spam_blocked_today": today.get("spam_blocked", 0),
        "attention_queued_today": today.get("attention_queued", 0),
        "inbox_cleaned_today": today.get("inbox_cleaned", 0),
        "auto_send_count_today": today.get("auto_send_count", 0),
        "auto_ack_count_today": today.get("auto_ack_count", 0),
        "automation_rate_today": rate,

        "period_days": period,
    }


@router.post("/sync")
async def sync_inbox_deprecated():
    """
    FIX 6: Deprecated. Frontend must stop calling this.
    Ingest runs automatically every 15 minutes via ingest_scheduler.
    Use POST /cron/ingest?user_email=... for manual trigger (debug only).
    """
    return {
        "status": "deprecated",
        "message": (
            "POST /emails/sync is deprecated. "
            "Ingest runs automatically every 15 minutes. "
            "Use POST /cron/ingest for manual debug trigger."
        ),
    }


@router.get("/auto-replied")
async def list_auto_replied_today(user_email: str = Query(...)):
    """Today's auto-replied emails — audit log, resets at midnight UTC."""
    from models.event import get_today_auto_replies

    await _require_user(user_email)
    today = await get_today(user_email)
    items = await get_today_auto_replies(user_email)
    return {
        "items": items,
        "count_today": today.get("auto_send_count", 0),
    }


@router.get("/{message_id}")
async def get_email_detail(message_id: str, user_email: str = Query(...)):
    """Return full parsed body for the detail panel."""
    await _require_user(user_email)
    creds = await get_gmail_credentials(user_email)
    try:
        detail = await asyncio.to_thread(fetch_message_detail, creds=creds, message_id=message_id)
    except Exception as exc:
        raise HTTPException(404, f"Could not load email {message_id}: {exc}") from exc
    return detail


@router.post("/{message_id}/analyze")
async def analyze_email(message_id: str, user_email: str = Query(...)):
    user = await _require_user(user_email)
    cached = attention_cache.get_analysis(message_id)
    if cached:
        return cached

    creds = await get_gmail_credentials(user_email)
    analysis = await generate_full_summary(creds=creds, message_id=message_id)
    attention_cache.set_analysis(message_id, analysis)
    return analysis


@router.post("/{message_id}/regenerate")
async def regenerate_draft(message_id: str, payload: RegenerateDraftRequest):
    await _require_user(payload.user_email)
    creds = await get_gmail_credentials(payload.user_email)
    result = await regenerate_draft_with_tone(
        creds=creds,
        message_id=message_id,
        tone=payload.tone,
        instructions=payload.context or None,
    )
    attention_cache.set_analysis(message_id, result)
    return {
        "new_draft_body": result.get("draft_body", ""),
        "tone_applied": payload.tone,
        "summary": result.get("summary", ""),
    }


@router.post("/{message_id}/send")
async def send_reply(message_id: str, payload: SendReplyRequest):
    """
    FIX 4: Now logs user_replied event + mark_seen + metrics_updated WS.
    """
    user = await _require_user(payload.user_email)
    creds = await get_gmail_credentials(payload.user_email)

    await asyncio.to_thread(
        send_gmail_reply, creds=creds, message_id=message_id, body=payload.body
    )

    processed_id = user.get("gmail_label_processed_id")
    attention_id = user.get("gmail_label_attention_id")
    remove_ids = [lid for lid in [attention_id, "UNREAD"] if lid]
    await asyncio.to_thread(
        modify_labels,
        creds=creds,
        message_id=message_id,
        add_label_ids=[processed_id] if processed_id else None,
        remove_label_ids=remove_ids or None,
    )

    attention_cache.invalidate_email(payload.user_email, message_id)

    # Log event + update seen outcome
    await log_agent_event(payload.user_email, "user_replied", message_id=message_id)
    await update_outcome(payload.user_email, message_id, "user_replied")

    # Broadcast to frontend
    await ws_manager.broadcast_to_user(
        payload.user_email, {"event": "email_removed", "id": message_id}
    )
    await _broadcast_metrics(payload.user_email)

    return {"status": "sent"}


@router.post("/{message_id}/dismiss")
async def dismiss_email_post(message_id: str, user_email: str = Query(...)):
    """
    FIX 3: POST alias for dismiss (plan says add this).
    Logs user_reviewed event. Frontend can call either DELETE or POST /dismiss.
    """
    return await _do_dismiss(message_id, user_email)


@router.delete("/{message_id}")
async def dismiss_email(message_id: str, user_email: str = Query(...)):
    """
    FIX 5: Now logs user_reviewed + mark_seen + metrics_updated WS.
    """
    return await _do_dismiss(message_id, user_email)


async def _do_dismiss(message_id: str, user_email: str) -> dict:
    """Shared logic for both dismiss routes."""
    user = await _require_user(user_email)
    creds = await get_gmail_credentials(user_email)

    processed_id = user.get("gmail_label_processed_id")
    attention_id = user.get("gmail_label_attention_id")

    await asyncio.to_thread(
        modify_labels,
        creds=creds,
        message_id=message_id,
        add_label_ids=[processed_id] if processed_id else None,
        remove_label_ids=[attention_id] if attention_id else None,
    )

    attention_cache.invalidate_email(user_email, message_id)

    # Log event + update seen outcome
    await log_agent_event(user_email, "user_reviewed", message_id=message_id)
    await update_outcome(user_email, message_id, "user_reviewed")

    # Broadcast to frontend
    await ws_manager.broadcast_to_user(user_email, {"event": "email_removed", "id": message_id})
    await _broadcast_metrics(user_email)

    return {"status": "dismissed"}


@router.post("/{message_id}/read")
async def mark_email_as_read(message_id: str, user_email: str = Query(...)):
    """
    Marks an email as read/reviewed by the user without removing it
    from the Gmail Attention label queue.
    """
    await _require_user(user_email)
    creds = await get_gmail_credentials(user_email)

    # Clear Gmail UNREAD only — keep the Attention label so the card stays in queue
    try:
        await asyncio.to_thread(
            modify_labels,
            creds=creds,
            message_id=message_id,
            remove_label_ids=["UNREAD"],
        )
    except Exception as exc:
        logger.warning(f"Could not clear UNREAD for {message_id}: {exc}")

    await log_agent_event(user_email, "user_viewed", message_id=message_id)
    if await is_seen(user_email, message_id):
        await update_outcome(user_email, message_id, "user_viewed")
    else:
        await mark_seen(user_email, message_id, "user_viewed")

    await ws_manager.broadcast_to_user(
        user_email,
        {
            "event": "email_read",
            "id": message_id,
        },
    )

    await _broadcast_metrics(user_email)

    return {"status": "marked_read"}


# @router.websocket("/stream")
# async def websocket_email_stream(websocket: WebSocket, user_email: str):
#     await ws_manager.connect(user_email, websocket)
#     try:
#         while True:
#             await websocket.receive_text()
#     except WebSocketDisconnect:
#         ws_manager.disconnect(user_email, websocket)
@router.websocket("/stream")
async def websocket_email_stream(websocket: WebSocket, user_email: str):
    await ws_manager.connect(user_email, websocket)
    try:
        while True:
            # Maintain the connection alive & listen for client pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info(u"WebSocket disconnected cleanly for %s", user_email)
    except Exception as e:
        logger.error(u"Unexpected WebSocket error for %s: %s", user_email, e)
    finally:
        # ── GUARANTEED CLEANUP ────────────────────────────────────────
        # This block ALWAYS runs, protecting your server from memory leaks
        ws_manager.disconnect(user_email, websocket)