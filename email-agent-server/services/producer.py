# Gmail → queue (dedup by gmail_message_id)

import time
import base64
import email.utils as eut
import httpx

from db.mongodb import is_db_connected
from models.queue import get_queue_collection
from models.email import get_emails_collection
from lib.google_client import get_valid_access_token

GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _extract_email_body(payload: dict) -> str:
    if payload.get("body", {}).get("data"):
        raw = payload["body"]["data"]
        return base64.urlsafe_b64decode(raw.encode("UTF-8")).decode("UTF-8", errors="replace")

    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            raw = part["body"]["data"]
            return base64.urlsafe_b64decode(raw.encode("UTF-8")).decode("UTF-8", errors="replace")
        if part.get("parts"):
            text = _extract_email_body(part)
            if text:
                return text
    return ""


def _get_header(headers: list[dict], name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


async def fetch_and_queue_new_emails(user_email: str, max_results: int = 25) -> int:
    """
    Poll Gmail for unread inbox messages and stage new ones in the queue.
    Returns count of newly queued messages.
    """
    if not is_db_connected():
        print("[Producer] Database not connected — skipping ingest")
        return 0

    try:
        token = await get_valid_access_token(user_email)
    except ValueError as err:
        print(f"[Producer] Auth failed for {user_email}: {err}")
        return 0

    queued = 0
    async with httpx.AsyncClient(timeout=20) as client:
        headers = {"Authorization": f"Bearer {token}"}
        try:
            list_resp = await client.get(
                f"{GMAIL_BASE}/messages",
                headers=headers,
                params={"maxResults": max_results, "q": "is:unread is:inbox"},
            )
            list_resp.raise_for_status()
            messages = list_resp.json().get("messages", [])
            if not messages:
                return 0

            queue_col = get_queue_collection()
            emails_col = get_emails_collection()

            for summary in messages:
                msg_id = summary["id"]
                thread_id = summary.get("threadId", msg_id)

                existing = await emails_col.find_one(
                    {"user_email": user_email, "gmail_message_id": msg_id}
                )
                if existing:
                    continue

                in_queue = await queue_col.find_one(
                    {"user_email": user_email, "gmail_message_id": msg_id}
                )
                if in_queue:
                    continue

                detail_resp = await client.get(
                    f"{GMAIL_BASE}/messages/{msg_id}",
                    headers=headers,
                    params={"format": "full"},
                )
                detail_resp.raise_for_status()
                msg = detail_resp.json()

                payload_headers = msg.get("payload", {}).get("headers", [])
                sender_raw = _get_header(payload_headers, "From")
                subject = _get_header(payload_headers, "Subject") or "(No Subject)"
                body = _extract_email_body(msg.get("payload", {}))
                snippet = msg.get("snippet", body[:240])
                from_name, from_address = eut.parseaddr(sender_raw)
                if not from_name:
                    from_name = from_address
                    # ── ADD THIS FILTERING BLOCK HERE ─────────────────────────────────
                auto_submitted = _get_header(payload_headers, "Auto-Submitted").lower()
                
                # Check for standard automated headers or known system accounts
                is_automated = (
                    auto_submitted in ["auto-replied", "auto-generated", "auto"] or
                    any(sys_term in from_address.lower() for sys_term in ["mailer-daemon", "postmaster", "donotreply", "no-reply"]) or
                    any(sys_term in subject.lower() for sys_term in ["delivery status notification", "undeliverable"])
                )

                if is_automated:
                    print(f"[Producer] Dropping automated system email {msg_id} from {from_address}")
                    # Skip inserting into the queue entirely
                    continue
                # ──────────────────────────────────────────────────────────────────

                await queue_col.insert_one({
                    "user_email": user_email,
                    "gmail_message_id": msg_id,
                    "thread_id": thread_id,
                    "sender": sender_raw,
                    "from_name": from_name,
                    "from_address": from_address or sender_raw,
                    "subject": subject,
                    "body": body,
                    "snippet": snippet,
                    "status": "queued_pending",
                    "ts": int(time.time()),
                })
                queued += 1
                print(f"[Producer] Queued message {msg_id} for {user_email}")

        except httpx.HTTPStatusError as api_err:
            print(f"[Producer] Gmail API error: {api_err.response.text}")
        except Exception as err:
            print(f"[Producer] Ingest error: {err}")

    return queued
