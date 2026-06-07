"""Processed inbox emails — powers GET /emails and dashboard stats."""

from datetime import datetime

from db.mongodb import get_collection, is_db_connected

EMAILS_COLLECTION = "emails"


def get_emails_collection():
    return get_collection(EMAILS_COLLECTION)


async def ensure_email_indexes() -> None:
    if not is_db_connected():
        return
    col = get_emails_collection()
    await col.create_index(
        [("user_email", 1), ("gmail_message_id", 1)],
        unique=True,
        name="user_gmail_msg_unique",
    )
    await col.create_index([("user_email", 1), ("date", -1)])
    await col.create_index([("user_email", 1), ("category", 1)])
    await col.create_index([("user_email", 1), ("is_trashed", 1)])


def normalize_category(category: str) -> str:
    """Map LLM categories to API/frontend values."""
    mapping = {
        "billing": "bill",
        "finance": "bill",
        "alert": "critical",
    }
    return mapping.get(category, category)


def build_email_document(
    *,
    user_email: str,
    gmail_message_id: str,
    thread_id: str,
    from_name: str,
    from_address: str,
    subject: str,
    body_text: str,
    snippet: str,
    category: str,
    priority: str,
    summary: str,
    llm_reasoning: str,
    llm_action: str,
    draft_body: str | None,
    is_actionable: bool,
) -> dict:
    now = datetime.utcnow()
    cat = normalize_category(category)
    needs_reply = is_actionable and cat not in ("spam", "newsletter")
    return {
        "user_email": user_email,
        "gmail_message_id": gmail_message_id,
        "thread_id": thread_id,
        "subject": subject,
        "from_name": from_name,
        "from_address": from_address,
        "snippet": snippet or body_text[:240],
        "body_text": body_text,
        "date": now,
        "category": cat,
        "priority": priority,
        "summary": summary,
        "llm_action": llm_action,
        "llm_reasoning": llm_reasoning,
        "needs_reply": needs_reply,
        "action_required": priority == "high" or cat == "critical",
        "draft_body": draft_body,
        "reply_draft": draft_body,
        "draft_id": None,
        "auto_reply_sent": False,
        "gmail_link": f"https://mail.google.com/mail/u/0/#inbox/{gmail_message_id}",
        "user_overrode": False,
        "user_action": None,
        "is_read": False,
        "is_trashed": False,
        "alert_sent_to_user": False,
        "processed_at": now,
        "synced_at": now,
    }
