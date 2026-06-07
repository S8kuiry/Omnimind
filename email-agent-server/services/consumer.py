# queue → Gemini → emails collection + event telemetry

import time
import email.utils as eut

from models.event import get_event_collection
from models.email import get_emails_collection, build_email_document, normalize_category
from models.queue import get_queue_collection
from services.llm.categorizer import categorize_email
from services.llm.summarizer import summarize_email
from services.llm.responder import generate_draft_response
from db.mongodb import is_db_connected


async def process_incoming_email(job: dict) -> bool:
    """Run LLM pipeline for one queued job and persist to emails collection."""
    user_email = job["user_email"]
    thread_id = job["thread_id"]
    gmail_message_id = job["gmail_message_id"]
    sender = job.get("sender") or job.get("from_address", "")
    subject = job.get("subject", "")
    body = job.get("body", "")
    snippet = job.get("snippet", body[:240])
    from_name = job.get("from_name") or eut.parseaddr(sender)[0] or sender
    from_address = job.get("from_address") or eut.parseaddr(sender)[1] or sender

    events = get_event_collection()
    emails_col = get_emails_collection()
    current_ts = int(time.time())

    print(f"[Consumer] Processing {gmail_message_id} for {user_email}")

    try:
        cat_result = await categorize_email(sender, subject, body)
        category = cat_result.get("category", "work")
        priority = cat_result.get("priority", "medium")
        reasoning = cat_result.get("reasoning", "")

        await events.insert_one({
            "email": user_email,
            "thread_id": thread_id,
            "action": "classify",
            "category": normalize_category(category),
            "priority": priority,
            "ts": current_ts,
            "latency_ms": cat_result.get("latency_ms", 0),
        })
        await events.insert_one({
            "email": user_email,
            "action": "inference",
            "ts": current_ts,
        })

        if category == "spam":
            await events.insert_one({
                "email": user_email,
                "thread_id": thread_id,
                "action": "spam_blocked",
                "ts": current_ts,
            })
            doc = build_email_document(
                user_email=user_email,
                gmail_message_id=gmail_message_id,
                thread_id=thread_id,
                from_name=from_name,
                from_address=from_address,
                subject=subject,
                body_text=body,
                snippet=snippet,
                category="spam",
                priority=priority,
                summary="Identified as spam and filtered.",
                llm_reasoning=reasoning,
                llm_action="archived",
                draft_body=None,
                is_actionable=False,
            )
            await emails_col.update_one(
                {"user_email": user_email, "gmail_message_id": gmail_message_id},
                {"$set": doc},
                upsert=True,
            )
            return True

        summary_text = ""
        draft_body = None
        llm_action = "archived"

        if cat_result.get("is_actionable", True) and category in ("work", "billing", "critical", "personal"):
            sum_result = await summarize_email(subject, body)
            summary_text = sum_result.get("summary", "")

            if category in ("work", "billing", "critical"):
                draft_result = await generate_draft_response(sender, subject, body, summary_text)
                draft_body = draft_result.get("draft_body")
                llm_action = "draft_saved"

                await events.insert_one({
                    "email": user_email,
                    "thread_id": thread_id,
                    "action": "draft",
                    "tone_applied": draft_result.get("tone_applied", "formal"),
                    "suggest_human_review": draft_result.get("suggest_human_review", False),
                    "ts": current_ts,
                    "latency_ms": draft_result.get("latency_ms", 0),
                })

                if (
                    not draft_result.get("suggest_human_review", True)
                    and draft_result.get("confidence_score", 0) > 0.8
                ):
                    await events.insert_one({
                        "email": user_email,
                        "thread_id": thread_id,
                        "action": "auto_resolved",
                        "ts": current_ts,
                    })
        else:
            sum_result = await summarize_email(subject, body)
            summary_text = sum_result.get("summary", "")

        doc = build_email_document(
            user_email=user_email,
            gmail_message_id=gmail_message_id,
            thread_id=thread_id,
            from_name=from_name,
            from_address=from_address,
            subject=subject,
            body_text=body,
            snippet=snippet,
            category=category,
            priority=priority,
            summary=summary_text,
            llm_reasoning=reasoning,
            llm_action=llm_action,
            draft_body=draft_body,
            is_actionable=cat_result.get("is_actionable", False),
        )
        await emails_col.update_one(
            {"user_email": user_email, "gmail_message_id": gmail_message_id},
            {"$set": doc},
            upsert=True,
        )
        return True

    except Exception as err:
        print(f"[Consumer] Failed on {gmail_message_id}: {err}")
        return False


async def process_queue_batch(user_email: str, limit: int = 10) -> int:
    """Process up to `limit` queued jobs for a user. Returns count processed."""
    if not is_db_connected():
        return 0

    queue_col = get_queue_collection()
    processed = 0

    for _ in range(limit):
        job = await queue_col.find_one_and_delete(
            {"user_email": user_email, "status": "queued_pending"}
        )
        if not job:
            break
        ok = await process_incoming_email(job)
        if ok:
            processed += 1

    return processed


async def worker_queue_listener() -> None:
    """Background daemon — processes any queued job across all users."""
    import asyncio

    print("[Consumer] Background worker started")
    while True:
        try:
            if not is_db_connected():
                await asyncio.sleep(5)
                continue

            queue_col = get_queue_collection()
            job = await queue_col.find_one_and_delete({"status": "queued_pending"})
            if job:
                await process_incoming_email(job)
            else:
                await asyncio.sleep(2)
        except Exception as err:
            print(f"[Consumer] Worker loop error: {err}")
            await asyncio.sleep(5)
