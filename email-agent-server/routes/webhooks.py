"""
routes/webhooks.py — Gmail Push Webhook

POST /webhooks/gmail  — receives Pub/Sub push notifications from Gmail

How Gmail Push works:
  1. Gmail detects new mail in a watched inbox
  2. Gmail publishes a Pub/Sub message to your GCP topic
  3. GCP pushes that message to this endpoint as an HTTP POST
  4. We decode the Pub/Sub envelope, extract history_id
  5. We call gmail_push_handler to fetch what changed and run pipeline

The payload from GCP looks like:
{
    "message": {
        "data": "<base64-encoded JSON>",   ← contains emailAddress + historyId
        "messageId": "...",
        "publishTime": "..."
    },
    "subscription": "projects/.../subscriptions/..."
}

The decoded data looks like:
{
    "emailAddress": "user@gmail.com",
    "historyId": "1234567"
}

IMPORTANT: Always return 200 immediately.
If we return 4xx/5xx, GCP will retry — causing duplicate processing.
All real work happens in background tasks.
"""

import base64
import json
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

logger = logging.getLogger("routes.webhooks")

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/gmail")
async def gmail_push_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Receives Gmail Pub/Sub push notification.

    Always returns 200 — GCP retries on any other status.
    Real processing happens in background via gmail_push_handler.
    """
    # Import here to avoid circular imports at module load time
    from services.gmail_push_handler import handle_gmail_push

    try:
        body = await request.json()
    except Exception:
        # Malformed body — ack it anyway so GCP doesn't retry forever
        logger.warning("[webhooks] Received malformed JSON body, acking silently")
        return Response(status_code=200)

    # ── Decode Pub/Sub envelope ────────────────────────────────────────────
    pubsub_message = body.get("message", {})
    encoded_data = pubsub_message.get("data", "")

    if not encoded_data:
        logger.warning("[webhooks] Pub/Sub message has no data field, acking")
        return Response(status_code=200)

    try:
        decoded = base64.b64decode(encoded_data).decode("utf-8")
        notification = json.loads(decoded)
    except Exception as e:
        logger.warning(f"[webhooks] Failed to decode Pub/Sub data: {e}, acking")
        return Response(status_code=200)

    # ── Extract what we need ───────────────────────────────────────────────
    user_email = notification.get("emailAddress")
    history_id = notification.get("historyId")

    if not user_email or not history_id:
        logger.warning(
            f"[webhooks] Missing emailAddress or historyId in notification: {notification}"
        )
        return Response(status_code=200)

    logger.info(f"[webhooks] Gmail push for {user_email}, historyId={history_id}")

    # ── Hand off to background — respond 200 immediately ──────────────────
    background_tasks.add_task(handle_gmail_push, user_email, str(history_id))

    return Response(status_code=200)