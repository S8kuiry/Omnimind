# GET  /emails                  (paginated, filterable)
# GET  /emails/{id}             (single full email)
# GET  /emails/stats            (counts by category/priority)
# POST /emails/{id}/draft       (user asks LLM to draft reply)
# POST /emails/{id}/send        (user approves + sends draft)
# POST /emails/{id}/override    (user overrides LLM decision)
# DELETE /emails/{id}           (manual delete)

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel
from datetime import datetime
from bson import ObjectId

from db.mongodb import get_collection, is_db_connected
from models.user import find_user
from lib.google_client import refresh_token_if_needed
from lib.gmail_client import send_email, save_draft, trash_message
from services.sync import sync_user_inbox
from services.llm.responder import generate_draft_response

router = APIRouter(prefix="/emails", tags=["emails"])


# ── Request models ─────────────────────────────────────────────────

class DraftRequest(BaseModel):
    user_email: str
    tone: str = "professional"        # professional | friendly | formal
    context: str = ""                 # optional extra instruction from user


class SendRequest(BaseModel):
    user_email: str
    to: str
    subject: str
    body: str                         # user-edited or LLM draft


class OverrideRequest(BaseModel):
    user_email: str
    new_action: str                   # auto_replied | draft_saved | archived | deleted
    reason: str = ""


# ── Helpers ────────────────────────────────────────────────────────

def _serialize(doc: dict) -> dict:
    """Convert MongoDB ObjectId to string for JSON response."""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc


async def _get_user_tokens(user_email: str) -> dict:
    user = await find_user(user_email)
    if not user:
        raise HTTPException(404, f"User {user_email} not found — connect Gmail first")
    token_dict = {
        "access_token": user["google_access_token"],
        "refresh_token": user.get("google_refresh_token"),
        "expiry": user.get("token_expiry"),
    }
    # Refresh if needed
    refreshed = refresh_token_if_needed(token_dict)
    return refreshed


# ── GET /emails ────────────────────────────────────────────────────

@router.get("")
async def list_emails(
    user_email: str = Query(...),
    category: str = Query(None),       # work | newsletter | bill | personal | spam | critical
    priority: str = Query(None),       # high | medium | low
    is_read: bool = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Returns paginated emails for a user."""
    if not is_db_connected():
        raise HTTPException(503, "Database not connected")

    col = get_collection("emails")

    query: dict = {"user_email": user_email, "is_trashed": {"$ne": True}}
    if category:
        query["category"] = category
    if priority:
        query["priority"] = priority
    if is_read is not None:
        query["is_read"] = is_read

    skip = (page - 1) * page_size
    total = await col.count_documents(query)

    cursor = col.find(query).sort("date", -1).skip(skip).limit(page_size)
    emails = []
    async for doc in cursor:
        emails.append(_serialize(doc))

    return {
        "emails": emails,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


# ── GET /emails/stats ──────────────────────────────────────────────

@router.get("/stats")
async def get_email_stats(user_email: str = Query(...)):
    """Returns counts grouped by category and priority."""
    if not is_db_connected():
        raise HTTPException(503, "Database not connected")

    col = get_collection("emails")
    base = {"user_email": user_email, "is_trashed": {"$ne": True}}

    # Category breakdown
    cat_pipeline = [
        {"$match": base},
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
    ]
    cat_cursor = col.aggregate(cat_pipeline)
    by_category = {}
    async for doc in cat_cursor:
        by_category[doc["_id"] or "uncategorized"] = doc["count"]

    # Priority breakdown
    pri_pipeline = [
        {"$match": base},
        {"$group": {"_id": "$priority", "count": {"$sum": 1}}},
    ]
    pri_cursor = col.aggregate(pri_pipeline)
    by_priority = {}
    async for doc in pri_cursor:
        by_priority[doc["_id"] or "unknown"] = doc["count"]

    # Unread count
    unread = await col.count_documents({**base, "is_read": False})

    # Critical unread — needs user attention
    critical_unread = await col.count_documents({
        **base,
        "category": "critical",
        "is_read": False,
    })

    # Today's processed count
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = await col.count_documents({
        **base,
        "processed_at": {"$gte": today_start},
    })

    return {
        "total": await col.count_documents(base),
        "unread": unread,
        "critical_unread": critical_unread,
        "today_processed": today_count,
        "by_category": by_category,
        "by_priority": by_priority,
    }


# ── POST /emails/sync ──────────────────────────────────────────────

@router.post("/sync")
async def sync_emails(user_email: str = Query(...)):
    """Fetch unread Gmail messages, run LLM triage, populate inbox collection."""
    if not is_db_connected():
        raise HTTPException(503, "Database not connected")
    return await sync_user_inbox(user_email)


# ── GET /emails/{id} ──────────────────────────────────────────────

@router.get("/{email_id}")
async def get_email(email_id: str, user_email: str = Query(...)):
    """
    Returns full email detail including summary, LLM reasoning, draft, gmail link.
    """
    col = get_collection("emails")

    try:
        doc = await col.find_one({
            "_id": ObjectId(email_id),
            "user_email": user_email,
        })
    except Exception:
        raise HTTPException(400, "Invalid email ID format")

    if not doc:
        raise HTTPException(404, "Email not found")

    # Mark as read when viewed in dashboard
    if not doc.get("is_read"):
        await col.update_one(
            {"_id": ObjectId(email_id)},
            {"$set": {"is_read": True}}
        )
        doc["is_read"] = True

    return _serialize(doc)


# ── POST /emails/{id}/draft ────────────────────────────────────────

@router.post("/{email_id}/draft")
async def generate_draft(email_id: str, req: DraftRequest):
    """Generate a reply draft with Gemini and save to Gmail + MongoDB."""
    col = get_collection("emails")

    try:
        doc = await col.find_one({
            "_id": ObjectId(email_id),
            "user_email": req.user_email,
        })
    except Exception:
        raise HTTPException(400, "Invalid email ID format")

    if not doc:
        raise HTTPException(404, "Email not found")

    draft_result = await generate_draft_response(
        doc.get("from_address", ""),
        doc.get("subject", ""),
        doc.get("body_text", doc.get("snippet", "")),
        doc.get("summary", ""),
    )
    draft_text = draft_result.get("draft_body", "").strip()
    if req.context:
        draft_text = f"{draft_text}\n\n{req.context}".strip()

    # Save as Gmail draft
    token_dict = await _get_user_tokens(req.user_email)
    gmail_draft = save_draft(
        token_dict=token_dict,
        to=doc["from_address"],
        subject=f"Re: {doc['subject']}",
        body=draft_text,
    )

    # Update email record
    await col.update_one(
        {"_id": ObjectId(email_id)},
        {"$set": {
            "draft_id": gmail_draft["draft_id"],
            "draft_body": draft_text,
            "llm_action": "draft_saved",
            "updated_at": datetime.utcnow(),
        }}
    )

    # Log action
    await _log_action(
        user_email=req.user_email,
        email_id=email_id,
        actor="llm",
        action="draft_saved",
        detail=f"Draft generated with tone={req.tone}",
    )

    return {
        "draft_id": gmail_draft["draft_id"],
        "draft_body": draft_text,
        "to": doc["from_address"],
        "subject": f"Re: {doc['subject']}",
    }


# ── POST /emails/{id}/send ─────────────────────────────────────────

@router.post("/{email_id}/send")
async def send_reply(email_id: str, req: SendRequest):
    """
    User approves and sends a reply (LLM draft or their own text).
    """
    col = get_collection("emails")

    try:
        doc = await col.find_one({
            "_id": ObjectId(email_id),
            "user_email": req.user_email,
        })
    except Exception:
        raise HTTPException(400, "Invalid email ID")

    if not doc:
        raise HTTPException(404, "Email not found")

    # Send via Gmail API
    token_dict = await _get_user_tokens(req.user_email)
    result = send_email(
        token_dict=token_dict,
        to=req.to,
        subject=req.subject,
        body=req.body,
    )

    # Update record
    await col.update_one(
        {"_id": ObjectId(email_id)},
        {"$set": {
            "auto_reply_sent": True,
            "llm_action": "auto_replied",
            "sent_message_id": result["message_id"],
            "updated_at": datetime.utcnow(),
        }}
    )

    await _log_action(
        user_email=req.user_email,
        email_id=email_id,
        actor="user",
        action="sent_reply",
        detail=f"Reply sent to {req.to}",
    )

    return {"message": "Reply sent", "gmail_message_id": result["message_id"]}


# ── POST /emails/{id}/override ─────────────────────────────────────

@router.post("/{email_id}/override")
async def override_decision(email_id: str, req: OverrideRequest):
    """
    User disagrees with LLM decision and overrides it.
    Records both the old and new decision for audit.
    """
    col = get_collection("emails")

    try:
        doc = await col.find_one({
            "_id": ObjectId(email_id),
            "user_email": req.user_email,
        })
    except Exception:
        raise HTTPException(400, "Invalid email ID")

    if not doc:
        raise HTTPException(404, "Email not found")

    old_action = doc.get("llm_action", "unknown")

    await col.update_one(
        {"_id": ObjectId(email_id)},
        {"$set": {
            "user_overrode": True,
            "user_action": req.new_action,
            "override_reason": req.reason,
            "updated_at": datetime.utcnow(),
        }}
    )

    await _log_action(
        user_email=req.user_email,
        email_id=email_id,
        actor="user",
        action="override",
        detail=f"LLM said '{old_action}', user chose '{req.new_action}'. Reason: {req.reason}",
    )

    return {
        "message": "Decision overridden",
        "old_action": old_action,
        "new_action": req.new_action,
    }


# ── DELETE /emails/{id} ────────────────────────────────────────────

@router.delete("/{email_id}")
async def delete_email(email_id: str, user_email: str = Query(...)):
    """
    Manually delete an email — trashes on Gmail and marks in MongoDB.
    """
    col = get_collection("emails")

    try:
        doc = await col.find_one({
            "_id": ObjectId(email_id),
            "user_email": user_email,
        })
    except Exception:
        raise HTTPException(400, "Invalid email ID")

    if not doc:
        raise HTTPException(404, "Email not found")

    # Trash on Gmail
    try:
        token_dict = await _get_user_tokens(user_email)
        trash_message(token_dict, doc["gmail_message_id"])
    except Exception as e:
        print(f"[Gmail trash] Warning: {e}")

    # Soft delete in MongoDB
    await col.update_one(
        {"_id": ObjectId(email_id)},
        {"$set": {
            "is_trashed": True,
            "trashed_at": datetime.utcnow(),
        }}
    )

    await _log_action(
        user_email=user_email,
        email_id=email_id,
        actor="user",
        action="deleted",
        detail="Manually deleted from dashboard",
    )

    return {"message": f"Email {email_id} deleted"}


# ── PATCH /emails/{id}/read ────────────────────────────────────────────

class MarkReadRequest(BaseModel):
    user_email: str


@router.patch("/{email_id}/read")
async def mark_as_read(email_id: str, req: MarkReadRequest):
    if not is_db_connected():
        raise HTTPException(503, "Database not connected")

    col = get_collection("emails")

    try:
        oid = ObjectId(email_id)
    except Exception:
        raise HTTPException(400, "Invalid email ID format")

    result = await col.update_one(
        {"_id": oid, "user_email": req.user_email, "is_trashed": {"$ne": True}},
        {"$set": {"is_read": True}},
    )

    if result.matched_count == 0:
        raise HTTPException(404, "Email not found")

    return {"status": "success", "message": "Email marked as read"}


# ── Internal helpers ───────────────────────────────────────────────

def _build_draft_prompt(email_doc: dict, tone: str, context: str) -> str:
    return f"""You are drafting a reply to the following email.

FROM: {email_doc.get('from_name', '')} <{email_doc.get('from_address', '')}>
SUBJECT: {email_doc.get('subject', '')}
EMAIL BODY:
{email_doc.get('body_text', email_doc.get('snippet', ''))}

SUMMARY: {email_doc.get('summary', '')}

Instructions:
- Tone: {tone}
- Keep the reply concise and relevant
- Do not include a subject line — just the body text
- Do not include placeholder text like [Your Name]
{f'- Additional context: {context}' if context else ''}

Write only the reply body:"""


async def _log_action(
    user_email: str,
    email_id: str,
    actor: str,
    action: str,
    detail: str,
):
    col = get_collection("action_logs")
    await col.insert_one({
        "user_email": user_email,
        "email_id": email_id,
        "actor": actor,
        "action": action,
        "detail": detail,
        "timestamp": datetime.utcnow(),
    })