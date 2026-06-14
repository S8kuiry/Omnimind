# email-agent-server/lib/gmail_client.py
import base64
import email
import html
import logging
import re
from email.message import EmailMessage
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

logger = logging.getLogger("gmail_client")

# Cap HTML payload returned to the frontend (keeps detail view fast)
_MAX_BODY_HTML_CHARS = 512_000
_MAX_INLINE_IMAGES = 20
_MAX_INLINE_IMAGE_BYTES = 400_000

# Strip active content while preserving layout, links, and images
_SCRIPT_RE = re.compile(r"<script[^>]*>[\s\S]*?</script>", re.I)
_DANGEROUS_TAG_RE = re.compile(r"</?(?:iframe|object|embed|form|input|button|link|meta|base)[^>]*>", re.I)
_EVENT_ATTR_RE = re.compile(r"\s+on[a-z]+\s*=\s*(['\"]).*?\1", re.I)
_JS_HREF_RE = re.compile(r"href\s*=\s*(['\"])javascript:[^'\"]*\1", re.I)


def _html_to_plain(text: str) -> str:
    """Strip HTML tags and decode entities for readable plain text."""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _sanitize_html_for_display(html_content: str) -> str:
    """Remove scripts and active content; keep images, tables, and links."""
    if not html_content:
        return ""
    cleaned = _SCRIPT_RE.sub("", html_content)
    cleaned = _DANGEROUS_TAG_RE.sub("", cleaned)
    cleaned = _EVENT_ATTR_RE.sub("", cleaned)
    cleaned = _JS_HREF_RE.sub('href="#"', cleaned)
    return cleaned


def _prepare_html_for_viewer(html_content: str) -> str:
    """Sanitize, add lazy-loading to images, normalize cid references."""
    html_content = _sanitize_html_for_display(html_content)
    # Lazy-load remote images — keeps scroll smooth on image-heavy newsletters
    html_content = re.sub(
        r"<img\b",
        '<img loading="lazy" decoding="async"',
        html_content,
        flags=re.I,
    )
    return html_content

def _build_service(creds: Credentials):
    """Internal helper to construct an authorized Gmail API service client stub."""
    return build('gmail', 'v1', credentials=creds)


# ─── PARSING UTILITY ──────────────────────────────────────────────────

def _parse_message_payload(msg_data: dict) -> dict:
    """
    Helper function to safely extract headers, snippet, and clear-text 
    body paragraphs out of a raw Gmail API dictionary response message structure.
    """
    headers = msg_data.get("payload", {}).get("headers", [])
    
    header_map = {h["name"].lower(): h["value"] for h in headers}
    
    # Safely parse the "From" field into a friendly name and clean email address string
    raw_from = header_map.get("from", "")
    from_name, from_address = raw_from, raw_from
    if "<" in raw_from and ">" in raw_from:
        parts = raw_from.split("<")
        from_name = parts[0].strip().replace('"', '')
        from_address = parts[1].replace(">", "").strip()

    # Extract plain and HTML body parts from the payload
    body_text = ""
    body_html = ""
    payload = msg_data.get("payload", {})

    def extract_body_recursive(part):
        nonlocal body_text, body_html
        mime_type = part.get("mimeType", "")
        body_data = part.get("body", {}).get("data", "")

        if body_data:
            decoded_bytes = base64.urlsafe_b64decode(body_data.encode("utf-8"))
            decoded = decoded_bytes.decode("utf-8", errors="ignore")
            if mime_type == "text/plain":
                body_text += decoded
            elif mime_type == "text/html":
                body_html += decoded
        if "parts" in part:
            for sub_part in part["parts"]:
                extract_body_recursive(sub_part)

    extract_body_recursive(payload)

    if not body_text.strip() and body_html.strip():
        body_text = _html_to_plain(body_html)
    elif body_text.strip():
        body_text = html.unescape(body_text)

    # Fallback to snippet if no body part was extracted
    if not body_text.strip():
        body_text = html.unescape(msg_data.get("snippet", ""))

    return {
        "id": msg_data.get("id"),
        "threadId": msg_data.get("threadId"),
        "labelIds": msg_data.get("labelIds", []),
        "snippet": msg_data.get("snippet", ""),
        "subject": header_map.get("subject", "(No Subject)"),
        "date": header_map.get("date", ""),
        "from_name": from_name if from_name else from_address,
        "from_address": from_address,
        "body_text": body_text,
        "body_html": body_html[:_MAX_BODY_HTML_CHARS] if body_html else "",
        "has_html": bool(body_html.strip()),
    }


# ─── ENGINE READ ENDPOINTS ──────────────────────────────────────────

def _paginate_message_ids(
    service,
    *,
    label_ids: list[str] | None = None,
    q: str | None = None,
    max_results: int = 100,
) -> list[dict]:
    """Collect message stubs from Gmail, following nextPageToken until max_results."""
    collected: list[dict] = []
    page_token: str | None = None

    while len(collected) < max_results:
        page_size = min(100, max_results - len(collected))
        kwargs: dict = {"userId": "me", "maxResults": page_size}
        if label_ids:
            kwargs["labelIds"] = label_ids
        if q:
            kwargs["q"] = q
        if page_token:
            kwargs["pageToken"] = page_token

        response = service.users().messages().list(**kwargs).execute()
        collected.extend(response.get("messages", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return collected[:max_results]


def _hydrate_message_metadata(service, msg_id: str, *, full_body: bool = False) -> dict | None:
    try:
        if full_body:
            full_msg = service.users().messages().get(userId="me", id=msg_id).execute()
        else:
            full_msg = service.users().messages().get(
                userId="me",
                id=msg_id,
                format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
        return _parse_message_payload(full_msg)
    except Exception as inner_err:
        logger.error(f"Failed parsing message {msg_id}: {inner_err}")
        return None


def fetch_attention_labeled_emails(
    creds: Credentials,
    attention_label_id: str,
    max_results: int | None = None,
) -> list[dict]:
    """
    Queries Gmail for messages with the OmniMind/Attention label.
    Paginates so the queue is not capped at the first API page.
    """
    from config import settings

    limit = max_results or settings.attention_list_max_results
    service = _build_service(creds)
    try:
        stubs = _paginate_message_ids(
            service,
            label_ids=[attention_label_id],
            max_results=limit,
        )
        hydrated_cards = []
        for msg_stub in stubs:
            parsed = _hydrate_message_metadata(service, msg_stub["id"], full_body=False)
            if parsed:
                hydrated_cards.append(parsed)
        return hydrated_cards
    except Exception as e:
        logger.error(f"Failed to query attention labeled email lists: {str(e)}")
        return []


UNTRIAGED_FILTER = '-label:OmniMind/Processed -label:OmniMind/Attention'


def _hydrate_message_list(service, stubs: list[dict], *, full_body: bool = False) -> list[dict]:
    hydrated_list = []
    for msg in stubs:
        parsed = _hydrate_message_metadata(service, msg["id"], full_body=full_body)
        if parsed:
            hydrated_list.append(parsed)
    return hydrated_list


def _dedupe_by_id(messages: list[dict]) -> list[dict]:
    seen: set[str] = set()
    unique: list[dict] = []
    for msg in messages:
        msg_id = msg.get("id")
        if not msg_id or msg_id in seen:
            continue
        seen.add(msg_id)
        unique.append(msg)
    return unique


def fetch_untriaged_unread(creds: Credentials, max_results: int = 50) -> list[dict]:
    """
    Unread mail not yet labeled by OmniMind. Poller uses this to catch new arrivals fast.
    """
    service = _build_service(creds)
    try:
        q = f"is:unread {UNTRIAGED_FILTER}"
        stubs = _paginate_message_ids(service, q=q, max_results=max_results)
        return _hydrate_message_list(service, stubs, full_body=False)
    except Exception as e:
        logger.error(f"Failed fetching untriaged unread mail: {str(e)}")
        return []


def fetch_unread_metadata(creds: Credentials, max_results: int = 50) -> list[dict]:
    """Backward-compatible alias for the incremental poller."""
    return fetch_untriaged_unread(creds, max_results=max_results)


def fetch_inbox_backlog_for_triage(creds: Credentials, max_results: int | None = None) -> list[dict]:
    """
    Inbox messages not yet triaged (no OmniMind Processed or Attention label).
    Used by manual sync to work through backlog beyond the unread cap.
    """
    from config import settings

    limit = max_results or settings.sync_backlog_max_results
    service = _build_service(creds)
    try:
        # Broader than in:inbox — catches Primary/Social/etc. tabs still in the mailbox.
        q = f"in:anywhere {UNTRIAGED_FILTER} newer_than:90d"
        stubs = _paginate_message_ids(service, q=q, max_results=limit)
        return _hydrate_message_list(service, stubs, full_body=False)
    except Exception as e:
        logger.error(f"Failed fetching inbox backlog for triage: {str(e)}")
        return []


def fetch_messages_for_triage(creds: Credentials, max_results: int | None = None) -> list[dict]:
    """
    Priority order: unread untriaged first (newest arrivals), then older untriaged backlog.
    """
    from config import settings

    limit = max_results or settings.sync_backlog_max_results
    unread_cap = min(50, limit)
    unread = fetch_untriaged_unread(creds, max_results=unread_cap)
    if len(unread) >= limit:
        return unread[:limit]

    backlog = fetch_inbox_backlog_for_triage(creds, max_results=limit)
    return _dedupe_by_id(unread + backlog)[:limit]


def _collect_inline_images(service, message_id: str, payload: dict) -> dict[str, str]:
    """Map Content-ID → data URI for inline images (detail view only, capped)."""
    images: dict[str, str] = {}
    total_bytes = 0

    def walk(part: dict) -> None:
        nonlocal total_bytes
        if len(images) >= _MAX_INLINE_IMAGES:
            return

        headers = {h["name"].lower(): h["value"] for h in part.get("headers", [])}
        cid = headers.get("content-id", "").strip().strip("<>")
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        att_id = body.get("attachmentId")
        body_data = body.get("data", "")

        if mime.startswith("image/"):
            raw: bytes | None = None
            try:
                if body_data:
                    raw = base64.urlsafe_b64decode(body_data.encode("utf-8"))
                elif att_id:
                    att = (
                        service.users()
                        .messages()
                        .attachments()
                        .get(userId="me", messageId=message_id, id=att_id)
                        .execute()
                    )
                    raw = base64.urlsafe_b64decode(att["data"].encode("utf-8"))
            except Exception as err:
                logger.debug(f"Inline image skip: {err}")
                raw = None

            if raw and len(raw) <= _MAX_INLINE_IMAGE_BYTES and total_bytes + len(raw) <= _MAX_INLINE_IMAGE_BYTES * _MAX_INLINE_IMAGES:
                b64 = base64.b64encode(raw).decode("ascii")
                key = cid or att_id or f"img_{len(images)}"
                images[key] = f"data:{mime};base64,{b64}"
                total_bytes += len(raw)

        for sub in part.get("parts", []):
            walk(sub)

    walk(payload)
    return images


def _embed_inline_images(html_content: str, images: dict[str, str]) -> str:
    if not html_content or not images:
        return html_content
    result = html_content
    for cid, data_uri in images.items():
        # Match cid:xxx, cid:<xxx>, and quoted variants in src attributes
        for pattern in (
            f"cid:{cid}",
            f"cid:<{cid}>",
            f"cid:%3C{cid}%3E",
        ):
            result = result.replace(pattern, data_uri)
    return result


def fetch_message_detail(creds: Credentials, message_id: str) -> dict:
    """
    Full message for the detail panel — includes HTML, inline images, plain text.
    Only called lazily when a user opens one email (not during bulk ingest).
    """
    from services.attention_cache import attention_cache

    cached = attention_cache.get_detail(message_id)
    if cached:
        return cached

    service = _build_service(creds)
    full_msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()
    parsed = _parse_message_payload(full_msg)

    body_html = parsed.get("body_html") or ""
    if body_html:
        inline = _collect_inline_images(service, message_id, full_msg.get("payload", {}))
        body_html = _embed_inline_images(body_html, inline)
        parsed["body_html"] = _prepare_html_for_viewer(body_html)[:_MAX_BODY_HTML_CHARS]
        parsed["has_html"] = True

    attention_cache.set_detail(message_id, parsed)
    return parsed


# ─── ENGINE MUTATION ACTIONS ────────────────────────────────────────

def modify_labels(creds: Credentials, message_id: str, add_label_ids: list = None, remove_label_ids: list = None):
    """Applies or clears label IDs from a targeted email message thread."""
    service = _build_service(creds)
    body = {}
    if add_label_ids:
        body["addLabelIds"] = add_label_ids
    if remove_label_ids:
        body["removeLabelIds"] = remove_label_ids
        
    return service.users().messages().modify(userId="me", id=message_id, body=body).execute()


def send_gmail_reply(creds: Credentials, message_id: str, body: str):
    """
    Constructs a valid context reply thread wrapper. Fetches the source metadata 
    to reference Message-ID constraints, preventing split conversation streams.
    """
    service = _build_service(creds)
    
    # 1. Look up parent message properties to anchor the response thread
    parent_msg = service.users().messages().get(userId="me", id=message_id, format="metadata", metadataHeaders=["Message-ID", "Subject", "From"]).execute()
    parent_headers = {h["name"].lower(): h["value"] for h in parent_msg.get("payload", {}).get("headers", [])}
    
    parent_id = parent_headers.get("message-id")
    parent_subject = parent_headers.get("subject", "")
    parent_from = parent_headers.get("from", "")
    thread_id = parent_msg.get("threadId")

    # 2. Package up the structured EmailMessage layout container
    reply = EmailMessage()
    reply.set_content(body)
    
    # Prepend response indicator prefix safely
    if not parent_subject.lower().startswith("re:"):
        reply["Subject"] = f"Re: {parent_subject}"
    else:
        reply["Subject"] = parent_subject
        
    reply["To"] = parent_from
    reply["From"] = "me"
    
    # Establish conversational thread relationships in the mail headers
    if parent_id:
        reply["In-Reply-To"] = parent_id
        reply["References"] = parent_id

    # 3. Transform structure safely into base64url payload blocks
    raw_bytes = reply.as_bytes()
    b64_string = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")
    
    payload = {
        "raw": b64_string,
        "threadId": thread_id
    }
    
    return service.users().messages().send(userId="me", body=payload).execute()


def fetch_old_unread_messages(creds: Credentials, batch_size: int) -> list[str]:
    """Unread messages older than 2 months, excluding Attention-labeled mail."""
    service = _build_service(creds)
    result = service.users().messages().list(
        userId="me",
        q="is:unread older_than:2m -label:OmniMind-Attention",
        maxResults=batch_size,
    ).execute()
    return [m["id"] for m in result.get("messages", [])]


def batch_move_to_trash(creds: Credentials, message_ids: list[str]) -> None:
    if not message_ids:
        return
    service = _build_service(creds)
    service.users().messages().batchTrash(userId="me", body={"ids": message_ids}).execute()








def fetch_today_untriaged_batch(creds, max_results: int = 20) -> list[dict]:
    """
    Fetches today's unread messages that haven't been triaged yet.

    Used by bootstrap_ingest.py on first OAuth connect.
    Query: newer_than:1d + INBOX + UNREAD + not already labeled OmniMind/Processed

    Returns list of message dicts — same shape as fetch_messages_for_triage.
    """
    service = _build_service(creds)
    limit = min(max_results, 20)

    try:
        stubs = _paginate_message_ids(
            service,
            q=f"newer_than:1d is:unread in:inbox {UNTRIAGED_FILTER}",
            max_results=limit,
        )
        return _hydrate_message_list(service, stubs, full_body=False)
    except Exception as e:
        logger.error(f"Failed fetching today's untriaged batch: {e}")
        return []
 
 
def _parse_from_header(from_raw: str) -> tuple[str, str]:
    """Parse 'Name <email>' into (name, email). Already exists in gmail_client.py — don't duplicate."""
    if "<" in from_raw and ">" in from_raw:
        name = from_raw[:from_raw.index("<")].strip().strip('"')
        address = from_raw[from_raw.index("<") + 1: from_raw.index(">")].strip()
        return name, address.lower()
    return "", from_raw.strip().lower()
