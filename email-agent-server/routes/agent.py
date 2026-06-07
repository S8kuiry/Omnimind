from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import os
import time
import httpx
import asyncio
import email.utils as eut

from routes.auth import get_current_email
from lib.google_client import get_valid_access_token
from models.event import get_event_collection
from models.rule import list_rules
from models.user import find_user
from db.mongodb import get_collection, is_db_connected
from config import settings
from services.sync import sync_user_inbox

router = APIRouter(prefix="/agents", tags=["agent"])

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


class ManualSyncRequest(BaseModel):
    user_email: str | None = None
    access_token: str | None = None


async def _gmail_get(token: str, path: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{GMAIL_BASE}{path}",
            headers={"Authorization": f"Bearer {token}"},
            params=params or {},
        )
        r.raise_for_status()
        return r.json()


async def _list_threads(token: str, q: str = "", limit: int = 5):
    return await _gmail_get(
        token, "/threads", {"maxResults": limit, **({"q": q} if q else {})}
    )


async def _event_counts(user_email: str, week: int) -> dict:
    defaults = {
        "auto_resolved": 0,
        "spam_blocked": 0,
        "drafts_created": 0,
        "avg_latency": 0,
    }
    if not is_db_connected():
        return defaults
    try:
        events = get_event_collection()
        auto_resolved, spam_blocked, drafts_created = await asyncio.gather(
            events.count_documents(
                {"email": user_email, "action": "auto_resolved", "ts": {"$gte": week}}
            ),
            events.count_documents(
                {"email": user_email, "action": "spam_blocked", "ts": {"$gte": week}}
            ),
            events.count_documents(
                {"email": user_email, "action": "draft", "ts": {"$gte": week}}
            ),
        )
        pipe = [
            {
                "$match": {
                    "email": user_email,
                    "action": "draft",
                    "ts": {"$gte": week},
                    "latency_ms": {"$ne": None},
                }
            },
            {"$group": {"_id": None, "avg": {"$avg": "$latency_ms"}}},
        ]
        avg_doc = await events.aggregate(pipe).to_list(1)
        avg_latency = int(avg_doc[0]["avg"]) if avg_doc else 0
        return {
            "auto_resolved": auto_resolved,
            "spam_blocked": spam_blocked,
            "drafts_created": drafts_created,
            "avg_latency": avg_latency,
        }
    except Exception:
        return defaults


@router.post("/email/sync")
async def manual_email_sync(payload: ManualSyncRequest):
    """
    Sync inbox (Gmail fetch + LLM triage) and return live + DB-backed metrics.
    Accepts user_email (preferred) or legacy access_token.
    """
    user_email = payload.user_email
    token = payload.access_token

    if user_email and is_db_connected():
        await sync_user_inbox(user_email)
        try:
            token = await get_valid_access_token(user_email)
        except ValueError:
            token = token  # fall through if we still have access_token

    if not token and user_email:
        try:
            token = await get_valid_access_token(user_email)
        except ValueError as e:
            raise HTTPException(401, str(e))

    if not token:
        raise HTTPException(400, "user_email or access_token required")

    if not user_email:
        raise HTTPException(400, "user_email required for full sync metrics")

    try:
        total_data, unread_data = await asyncio.gather(
            _list_threads(token, "", 1),
            _list_threads(token, "is:unread", 1),
        )
        total = total_data.get("resultSizeEstimate", 0)
        unread = unread_data.get("resultSizeEstimate", 0)

        week = int(time.time()) - 7 * 86400
        event_stats = await _event_counts(user_email, week)

        classified = 0
        if is_db_connected():
            try:
                events = get_event_collection()
                classified = await events.count_documents(
                    {"email": user_email, "action": "classify", "ts": {"$gte": week}}
                )
            except Exception:
                pass

        automation_rate = (
            round((event_stats["auto_resolved"] / max(classified, 1)) * 100, 1)
            if classified
            else 0.0
        )

        return {
            "monitored_threads": total,
            "unread_pending": unread,
            "auto_resolved": event_stats["auto_resolved"],
            "drafts_created": event_stats["drafts_created"],
            "spam_blocked": event_stats["spam_blocked"],
            "avg_latency": event_stats["avg_latency"],
            "automation_rate": automation_rate,
        }

    except httpx.HTTPStatusError as e:
        raise HTTPException(401, "Google access token expired or invalid") from e
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@router.get("/stats")
async def stats(email: str = Depends(get_current_email)):
    try:
        token = await get_valid_access_token(email)
    except ValueError as e:
        raise HTTPException(401, detail=str(e))

    total_data, unread_data = await asyncio.gather(
        _list_threads(token, "", 1),
        _list_threads(token, "is:unread", 1),
    )
    total = total_data.get("resultSizeEstimate", 0)
    unread = unread_data.get("resultSizeEstimate", 0)

    if not is_db_connected():
        return {
            "total_threads": total,
            "unread_pending": unread,
            "auto_resolved": 0,
            "avg_response_time_ms": 0,
            "inference_calls": 0,
            "spam_blocked_pct": 0.0,
        }

    events = get_event_collection()
    now = int(time.time())
    week = now - 7 * 86400
    month = now - 30 * 86400

    auto_resolved, inference_calls, spam_blocked, total_classified = await asyncio.gather(
        events.count_documents({"email": email, "action": "auto_resolved", "ts": {"$gte": week}}),
        events.count_documents({"email": email, "action": "inference", "ts": {"$gte": month}}),
        events.count_documents({"email": email, "action": "spam_blocked", "ts": {"$gte": week}}),
        events.count_documents({"email": email, "action": "classify", "ts": {"$gte": week}}),
    )

    pipe = [
        {
            "$match": {
                "email": email,
                "action": "draft",
                "ts": {"$gte": week},
                "latency_ms": {"$ne": None},
            }
        },
        {"$group": {"_id": None, "avg": {"$avg": "$latency_ms"}}},
    ]
    avg_doc = await events.aggregate(pipe).to_list(1)
    avg_latency_ms = int(avg_doc[0]["avg"]) if avg_doc else 0

    spam_accuracy = (
        round((spam_blocked / total_classified) * 100, 1) if total_classified else 0.0
    )

    return {
        "total_threads": total,
        "unread_pending": unread,
        "auto_resolved": auto_resolved,
        "avg_response_time_ms": avg_latency_ms,
        "inference_calls": inference_calls,
        "spam_blocked_pct": spam_accuracy,
    }


def _header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _initials(from_field: str) -> str:
    name, _ = eut.parseaddr(from_field)
    parts = (name or from_field).split()
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


@router.get("/threads")
async def recent_threads(limit: int = 5, email: str = Depends(get_current_email)):
    try:
        token = await get_valid_access_token(email)
    except ValueError as e:
        raise HTTPException(401, detail=str(e))
    listing = await _list_threads(token, "", limit)

    async def fetch(tid: str):
        full = await _gmail_get(
            token,
            f"/threads/{tid}",
            {"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
        )
        msg = full["messages"][0]
        headers = msg["payload"]["headers"]
        from_full = _header(headers, "From")
        name, addr = eut.parseaddr(from_full)
        return {
            "id": tid,
            "from": name or addr,
            "from_email": addr,
            "initials": _initials(from_full),
            "subject": _header(headers, "Subject") or "(no subject)",
            "internal_date": int(msg["internalDate"]),
            "unread": "UNREAD" in msg.get("labelIds", []),
            "label_ids": msg.get("labelIds", []),
        }

    threads = await asyncio.gather(
        *(fetch(t["id"]) for t in listing.get("threads", []))
    )
    return {"threads": threads}


@router.get("/categories")
async def categories(email: str = Depends(get_current_email)):
    if not is_db_connected():
        return {"categories": []}

    events = get_event_collection()
    week = int(time.time()) - 7 * 86400
    pipe = [
        {"$match": {"email": email, "category": {"$ne": None}, "ts": {"$gte": week}}},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    rows = await events.aggregate(pipe).to_list(50)
    total = sum(r["count"] for r in rows) or 1
    return {
        "categories": [
            {
                "name": r["_id"],
                "count": r["count"],
                "pct": round(r["count"] * 100 / total, 1),
            }
            for r in rows
        ]
    }


@router.get("/rules")
async def rules(email: str = Depends(get_current_email)):
    rs = await list_rules(email)
    return {
        "rules": [
            {
                "id": str(r["_id"]),
                "name": r["name"],
                "hits": r.get("hits", 0),
                "status": r.get("status", "active"),
            }
            for r in rs
        ]
    }


@router.get("/pipeline")
async def pipeline(email: str = Depends(get_current_email)):
    user = await find_user(email)
    now = int(time.time())

    has_refresh = bool(user and user.get("google_refresh_token"))
    token_valid = bool(user and user.get("token_expiry", 0) - 60 > now)
    oauth_status = "ok" if has_refresh else ("warn" if token_valid else "error")

    mongo_status = "ok" if is_db_connected() else "error"

    gemini_status = "ok"
    api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/"
                    f"models/{settings.gemini_model}?key={api_key}"
                )
                r = await c.get(url)
                if r.status_code >= 400:
                    gemini_status = "warn"
        except Exception:
            gemini_status = "error"
    else:
        gemini_status = "warn"

    return {
        "nodes": [
            {
                "label": "google_oauth_scope",
                "value": "connected" if has_refresh else "missing_refresh",
                "status": oauth_status,
            },
            {
                "label": "mongodb_atlas",
                "value": settings.mongodb_db_name,
                "status": mongo_status,
            },
            {
                "label": "gemini_flash_inference",
                "value": "healthy" if gemini_status == "ok" else gemini_status,
                "status": gemini_status,
            },
            {"label": "triage_consumer", "value": "active", "status": "ok"},
        ]
    }
