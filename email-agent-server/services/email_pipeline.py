import asyncio
import logging

from config import settings
from lib.gmail_client import modify_labels, send_gmail_reply, thread_already_handled, finalize_outbound_reply
from services.llm.categorizer_light import triage_email_light
from services.llm.auto_reply import generate_auto_reply_body
from services.auto_reply_policy import (
    should_auto_reply,
    is_system_drop_meta,
    is_omnimind_notification_meta,
    is_job_recruiting_meta,
    apply_triage_overrides,
)
from models.event import log_agent_event
from models.metrics_daily import get_today
from services.session_stats import session_stats
from services.attention_cache import attention_cache
from services.ws_manager import ws_manager

logger = logging.getLogger("email_pipeline")
pipeline_semaphore = asyncio.Semaphore(settings.llm_concurrency)


async def process_incoming_email_pipeline(
    user: dict,
    email_meta: dict,
    label_map: dict,
    creds,
    *,
    reprocess_attention: bool = False,
):
    user_email = user.get("email")
    if not user_email:
        return

    message_id = email_meta.get("id")
    from_address = (email_meta.get("from_address") or "").lower()
    attention_label_id = label_map.get("OmniMind/Attention")
    processed_label_id = label_map.get("OmniMind/Processed")

    if not attention_label_id or not processed_label_id:
        logger.error(
            f"Skipping {message_id}: OmniMind Gmail labels not provisioned for {user_email}"
        )
        return

    label_ids = email_meta.get("labelIds", [])
    if processed_label_id and processed_label_id in label_ids:
        return

    async with pipeline_semaphore:
        try:
            # System / non-replyable — never show user; also cleans mislabeled Attention mail
            if is_system_drop_meta(email_meta):
                await _mark_processed(
                    creds=creds,
                    message_id=message_id,
                    processed_label_id=processed_label_id,
                    attention_label_id=attention_label_id,
                    label_ids=label_ids,
                    user_email=user_email,
                )
                session_stats.record_dropped(user_email)
                await log_agent_event(
                    user_email,
                    "spam_blocked",
                    message_id=message_id,
                    meta={"reason": "system_non_replyable"},
                )
                logger.info(f"System-dropped {message_id} for {user_email}")
                return

            if is_omnimind_notification_meta(email_meta, user_email):
                logger.debug(f"Ignoring OmniMind notification {message_id} for {user_email}")
                return

            if attention_label_id and attention_label_id in label_ids and not reprocess_attention:
                return

            thread_id = email_meta.get("threadId") or ""
            if thread_id and not is_job_recruiting_meta(email_meta):
                already_handled = await asyncio.to_thread(
                    thread_already_handled,
                    creds,
                    thread_id,
                    processed_label_id,
                    message_id,
                )
                if already_handled:
                    await _mark_processed(
                        creds=creds,
                        message_id=message_id,
                        processed_label_id=processed_label_id,
                        attention_label_id=attention_label_id,
                        label_ids=label_ids,
                        user_email=user_email,
                    )
                    await log_agent_event(
                        user_email,
                        "auto_resolved",
                        message_id=message_id,
                        meta={"reason": "thread_already_handled"},
                    )
                    logger.info(f"Thread follow-up {message_id} marked processed (already handled)")
                    return

            triage = await triage_email_light(email_meta)
            triage = apply_triage_overrides(email_meta, triage)
            category = triage.get("category", "work")
            priority = triage.get("priority", "medium")
            needs_manual = triage.get("needs_manual_review", True)

            if category in ["spam", "newsletter"]:
                await _mark_processed(
                    creds=creds,
                    message_id=message_id,
                    processed_label_id=processed_label_id,
                    attention_label_id=attention_label_id,
                    label_ids=label_ids,
                    user_email=user_email,
                )
                session_stats.record_dropped(user_email)
                await log_agent_event(
                    user_email,
                    "spam_blocked",
                    message_id=message_id,
                    meta={"category": category},
                )
                return

            allow_auto, auto_reason = should_auto_reply(
                email_meta,
                category=category,
                priority=priority,
                needs_manual=needs_manual,
            )

            if allow_auto:
                reply_body = await generate_auto_reply_body(email_meta, category=category)
                subject = email_meta.get("subject", "")
                snippet = email_meta.get("snippet", "")
                sent_result = await asyncio.to_thread(
                    send_gmail_reply, creds=creds, message_id=message_id, body=reply_body
                )
                await asyncio.to_thread(
                    finalize_outbound_reply,
                    creds,
                    sent_result,
                    attention_label_id=attention_label_id,
                    processed_label_id=processed_label_id,
                )
                session_stats.record_auto_reply(user_email)
                await _mark_processed(
                    creds=creds,
                    message_id=message_id,
                    processed_label_id=processed_label_id,
                    attention_label_id=attention_label_id,
                    label_ids=label_ids,
                    user_email=user_email,
                )

                card = _build_auto_replied_card(email_meta, category, priority, reply_body)
                await log_agent_event(
                    user_email,
                    "auto_replied",
                    message_id=message_id,
                    meta={
                        "category": category,
                        "priority": priority,
                        "reason": auto_reason,
                        "subject": subject,
                        "from_name": email_meta.get("from_name", ""),
                        "from_address": email_meta.get("from_address", ""),
                        "snippet": snippet,
                        "reply_preview": reply_body[:280],
                    },
                )
                await ws_manager.broadcast_to_user(
                    user_email, {"event": "auto_replied", "data": card}
                )
                await _broadcast_metrics_update(user_email)
                logger.info(f"Auto-replied to {message_id} ({auto_reason}) for {user_email}")
                return

            logger.debug(
                f"Routing {message_id} to attention (auto-reply skipped: {auto_reason})"
            )

            if reprocess_attention and attention_label_id in label_ids:
                return

            await _route_to_attention(
                user_email=user_email,
                email_meta=email_meta,
                message_id=message_id,
                category=category,
                priority=priority,
                attention_label_id=attention_label_id,
                creds=creds,
            )

        except Exception as err:
            logger.error(
                f"Pipeline error for {message_id} ({email_meta.get('subject', '(no subject)')}): {err}",
                exc_info=True,
            )


async def _mark_processed(
    *,
    creds,
    message_id: str,
    processed_label_id: str,
    attention_label_id: str,
    label_ids: list,
    user_email: str | None = None,
) -> None:
    had_attention = bool(attention_label_id and attention_label_id in label_ids)
    remove_ids = ["UNREAD"]
    if had_attention:
        remove_ids.append(attention_label_id)
    await asyncio.to_thread(
        modify_labels,
        creds=creds,
        message_id=message_id,
        add_label_ids=[processed_label_id] if processed_label_id else None,
        remove_label_ids=remove_ids,
    )
    if user_email and had_attention:
        attention_cache.invalidate_email(user_email, message_id)
        await ws_manager.broadcast_to_user(
            user_email, {"event": "email_removed", "id": message_id}
        )


async def _broadcast_metrics_update(user_email: str) -> None:
    try:
        today = await get_today(user_email)
        active_cards = len(attention_cache.get_emails(user_email) or [])
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
                    "auto_send_count_today": today.get("auto_send_count", 0),
                },
            },
        )
    except Exception as e:
        logger.warning(f"metrics broadcast failed: {e}")


async def _route_to_attention(
    *,
    user_email: str,
    email_meta: dict,
    message_id: str,
    category: str,
    priority: str,
    attention_label_id: str,
    creds,
) -> None:
    await asyncio.to_thread(
        modify_labels,
        creds=creds,
        message_id=message_id,
        add_label_ids=[attention_label_id] if attention_label_id else None,
    )

    card = _build_card(email_meta, category, priority)
    current_cache = attention_cache.get_emails(user_email)
    if current_cache is not None:
        if not any(c.get("provider_message_id") == message_id for c in current_cache):
            current_cache.insert(0, card)
            attention_cache.set_emails(user_email, current_cache)

    session_stats.record_attention(user_email)
    await log_agent_event(
        user_email,
        "attention_queued",
        message_id=message_id,
        meta={"category": category, "priority": priority},
    )
    await ws_manager.broadcast_to_user(user_email, {"event": "new_email", "data": card})


def _build_card(email_meta: dict, category: str, priority: str) -> dict:
    message_id = email_meta.get("id")
    return {
        "_id": message_id,
        "provider_message_id": message_id,
        "thread_id": email_meta.get("threadId", ""),
        "from_name": email_meta.get("from_name", ""),
        "from_address": email_meta.get("from_address", ""),
        "subject": email_meta.get("subject", ""),
        "snippet": email_meta.get("snippet", ""),
        "body_text": email_meta.get("body_text", "") or email_meta.get("snippet", ""),
        "summary": "",
        "draft_body": "",
        "needs_reply": True,
        "category": category,
        "priority": priority,
        "date": email_meta.get("date", ""),
        "provider": "gmail",
    }


def _build_auto_replied_card(
    email_meta: dict, category: str, priority: str, reply_body: str
) -> dict:
    card = _build_card(email_meta, category, priority)
    card["llm_action"] = "auto_replied"
    card["auto_reply_sent"] = True
    card["reply_preview"] = reply_body[:280]
    card["needs_reply"] = False
    return card
