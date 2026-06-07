# OAuth2 client + token refresh

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from config import settings
import base64
import re


def _build_service(token_dict: dict):
    """Build Gmail API service from stored token dict."""
    creds = Credentials(
        token=token_dict["access_token"],
        refresh_token=token_dict.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
    )
    return build("gmail", "v1", credentials=creds)


def get_user_profile(token_dict: dict) -> dict:
    """Returns Gmail profile — email address + messages total."""
    service = _build_service(token_dict)
    profile = service.users().getProfile(userId="me").execute()
    return {
        "email": profile.get("emailAddress"),
        "messages_total": profile.get("messagesTotal"),
        "threads_total": profile.get("threadsTotal"),
    }


def fetch_unread_message_ids(token_dict: dict, max_results: int = 500) -> list[str]:
    """
    Fetch up to max_results unread message IDs.
    Returns list of gmail_message_id strings.
    """
    service = _build_service(token_dict)
    ids = []
    page_token = None

    while len(ids) < max_results:
        batch = min(500, max_results - len(ids))
        kwargs = {
            "userId": "me",
            "q": "is:unread",
            "maxResults": batch,
        }
        if page_token:
            kwargs["pageToken"] = page_token

        result = service.users().messages().list(**kwargs).execute()
        messages = result.get("messages", [])
        ids.extend(m["id"] for m in messages)

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return ids


def fetch_message_detail(token_dict: dict, message_id: str) -> dict:
    """
    Fetch full message detail for one Gmail message ID.
    Returns cleaned dict ready for processing.
    """
    service = _build_service(token_dict)
    msg = service.users().messages().get(
        userId="me",
        id=message_id,
        format="full",
    ).execute()

    headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}
    body = _extract_body(msg["payload"])

    return {
        "gmail_message_id": message_id,
        "thread_id": msg.get("threadId"),
        "subject": headers.get("subject", "(no subject)"),
        "from_address": _parse_email(headers.get("from", "")),
        "from_name": _parse_name(headers.get("from", "")),
        "to": headers.get("to", ""),
        "date_str": headers.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "body_text": body,
        "gmail_link": f"https://mail.google.com/mail/u/0/#inbox/{message_id}",
        "label_ids": msg.get("labelIds", []),
        "is_read": "UNREAD" not in msg.get("labelIds", []),
    }


def send_email(token_dict: dict, to: str, subject: str, body: str) -> dict:
    """Send an email. Returns sent message metadata."""
    service = _build_service(token_dict)
    message = _build_raw_message(to=to, subject=subject, body=body)
    sent = service.users().messages().send(userId="me", body=message).execute()
    return {"message_id": sent["id"], "thread_id": sent.get("threadId")}


def save_draft(token_dict: dict, to: str, subject: str, body: str) -> dict:
    """Save a draft. Returns draft ID."""
    service = _build_service(token_dict)
    message = _build_raw_message(to=to, subject=subject, body=body)
    draft = service.users().drafts().create(
        userId="me",
        body={"message": message}
    ).execute()
    return {"draft_id": draft["id"]}


def trash_message(token_dict: dict, message_id: str) -> bool:
    """Move message to trash."""
    service = _build_service(token_dict)
    service.users().messages().trash(userId="me", id=message_id).execute()
    return True


def mark_as_read(token_dict: dict, message_id: str):
    """Remove UNREAD label."""
    service = _build_service(token_dict)
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"removeLabelIds": ["UNREAD"]},
    ).execute()


# ── Helpers ────────────────────────────────────────────────────────

def _extract_body(payload: dict) -> str:
    """Recursively extract plain text body from Gmail payload."""
    if payload.get("body", {}).get("data"):
        return _decode_base64(payload["body"]["data"])

    for part in payload.get("parts", []):
        mime = part.get("mimeType", "")
        if mime == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return _decode_base64(data)
        if mime.startswith("multipart"):
            result = _extract_body(part)
            if result:
                return result

    return ""


def _decode_base64(data: str) -> str:
    try:
        decoded = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
        return decoded.strip()
    except Exception:
        return ""


def _parse_email(from_header: str) -> str:
    match = re.search(r"<(.+?)>", from_header)
    return match.group(1) if match else from_header.strip()


def _parse_name(from_header: str) -> str:
    match = re.match(r"^([^<]+)<", from_header)
    return match.group(1).strip().strip('"') if match else ""


def _build_raw_message(to: str, subject: str, body: str) -> dict:
    from email.mime.text import MIMEText
    msg = MIMEText(body)
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return {"raw": raw}