"""
Auto-reply policy — LLM triage drives decisions, not hardcoded brand lists.

Only universal technical rules are hardcoded (non-replyable addresses, system mail).
"""

import re

from config import settings
from services.stats_email import OMNIMIND_NOTIFICATION_MARKERS

# Technical: cannot reply to these — never show in attention queue
_SYSTEM_SENDERS = ("mailer-daemon", "postmaster", "mail-daemon", "mail delivery subsystem")
_SYSTEM_FROM_NAMES = (
    "mail delivery subsystem",
    "mail delivery",
    "mailer-daemon",
    "postmaster",
)
_NOREPLY_MARKERS = ("noreply", "no-reply", "donotreply", "do-not-reply")

_DELIVERY_FAILURE_RE = re.compile(
    r"delivery\s+status|undeliverable|mail\s+delivery|returned\s+mail|address\s+not\s+found|\b550\b|delivery\s+status\s+notification",
    re.I,
)
_DELIVERY_FAILURE_SUBJECT_RE = re.compile(
    r"delivery\s+status\s+notification|undelivered\s+mail|mail\s+delivery\s+failed|returned\s+mail",
    re.I,
)

# Job / recruiting — block auto-reply only when content clearly indicates apply/hire intent.
# Domains alone are NOT enough (avoids blocking all LinkedIn mail).

_JOB_STRONG_RE = re.compile(
    r"job\s+(?:opening|opportunity|offer|alert|posting|application|position)\b"
    r"|(?:we'?re|we are)\s+hiring\b"
    r"|hiring\s+for\s+(?:a\s+)?(?:role|position|engineer|developer|analyst|manager|intern)"
    r"|(?:apply|application)\s+(?:now|here|today|link|via|online|on\s+our)"
    r"|(?:invited?\s+to\s+apply|please\s+apply|submit\s+your\s+(?:cv|resume|application))"
    r"|(?:interview|screening)\s+(?:invite|invitation|scheduled|request|slot|call)"
    r"|(?:shortlisted|selected)\s+for\s+(?:the\s+)?(?:role|position|interview|next\s+round)"
    r"|(?:talent|hiring|recruitment)\s+(?:team|partner|specialist|@)"
    r"|(?:campus|off-?campus)\s+(?:hire|hiring|placement|drive)"
    r"|(?:ctc|call\s+letter|offer\s+letter)\b"
    r"|(?:view|see)\s+(?:this\s+)?(?:job|opening|role)\s+(?:at|on)\b"
    r"|(?:found|matched|recommended)\s+(?:a\s+)?job\s+(?:for|matching)\b",
    re.I,
)

# Job-board senders — flag only together with job-like subject/snippet
_JOB_BOARD_HINT_RE = re.compile(
    r"\b(?:job|role|opening|position|hire|hiring|apply|application|interview|recruiter|vacancy|ctc)\b",
    re.I,
)

_JOB_BOARD_SENDERS = (
    "jobs.linkedin.com",
    "jobalerts.linkedin.com",
    "e.linkedin.com",
    "notifications.naukri.com",
    "jobalerts.naukri.com",
    "info@naukri.com",
    "jobalerts.indeed.com",
    "indeedemail.com",
    "glassdoor.com",
    "wellfound.com",
    "angel.co",
    "greenhouse.io",
    "lever.co",
    "workday.com",
    "myworkday.com",
    "smartrecruiters.com",
    "ashbyhq.com",
    "jobvite.com",
    "icims.com",
    "bamboohr.com",
    "recruitee.com",
    "teamtailor.com",
    "cutshortlist.com",
    "hirist.com",
    "instahyre.com",
    "foundit.in",
    "monster.com",
    "shine.com",
    "timesjobs.com",
    "internshala.com",
    "unstop.com",
    "superset.co",
    "mettl.com",
    "getmettl.com",
    "hackerrank.com",
    "careers.",
    "talent@",
    "recruiting@",
    "hiring@",
)


def is_replyable_address(from_address: str) -> bool:
    """False when SMTP cannot deliver a human reply to this sender."""
    addr = (from_address or "").lower()
    if any(s in addr for s in _SYSTEM_SENDERS):
        return False
    return not any(m in addr for m in _NOREPLY_MARKERS)


def is_system_drop(
    from_address: str,
    subject: str,
    snippet: str,
    *,
    from_name: str = "",
    body_text: str = "",
) -> bool:
    """
    Mail that must never reach the attention queue.
    Silently mark Processed — no reply attempt.
    """
    addr = (from_address or "").lower()
    name = (from_name or "").lower()
    combined = f"{subject} {snippet} {body_text}"

    if any(marker in name for marker in _SYSTEM_FROM_NAMES):
        return True
    if not is_replyable_address(from_address):
        return True
    if _DELIVERY_FAILURE_SUBJECT_RE.search(subject or ""):
        return True
    if "delivery status" in (subject or "").lower() and "failure" in combined.lower():
        return True
    return bool(_DELIVERY_FAILURE_RE.search(combined))


def is_system_drop_meta(meta: dict) -> bool:
    """Evaluate a Gmail metadata dict or attention card for silent system drop."""
    return is_system_drop(
        meta.get("from_address") or "",
        meta.get("subject") or "",
        meta.get("snippet") or "",
        from_name=meta.get("from_name") or "",
        body_text=meta.get("body_text") or meta.get("summary") or "",
    )


def _email_text_blob(meta: dict) -> str:
    return " ".join(
        str(meta.get(k) or "")
        for k in ("subject", "snippet", "body_text", "summary", "from_name", "from_address")
    )


def is_job_recruiting_meta(meta: dict) -> bool:
    """
    Job offers / apply invites → attention queue, never auto-reply.
    Content-first so routine mail from job sites can still auto-reply when appropriate.
    """
    blob = _email_text_blob(meta)
    if _JOB_STRONG_RE.search(blob):
        return True

    addr = (meta.get("from_address") or "").lower()
    if any(marker in addr for marker in _JOB_BOARD_SENDERS) and _JOB_BOARD_HINT_RE.search(blob):
        return True

    name = (meta.get("from_name") or "").lower()
    if re.search(r"\b(recruiter|talent acquisition|staffing|hr)\b", name, re.I):
        if _JOB_BOARD_HINT_RE.search(blob):
            return True

    return False


def is_omnimind_notification_meta(meta: dict, user_email: str = "") -> bool:
    """
    Self-sent OmniMind stats / daily summary mail — never triage, auto-reply, or queue.
    """
    user = (user_email or "").strip().lower()
    addr = (meta.get("from_address") or "").strip().lower()
    if not user or addr != user:
        return False
    text = " ".join(
        str(meta.get(k) or "")
        for k in ("subject", "snippet", "body_text", "summary")
    ).lower()
    return any(marker.lower() in text for marker in OMNIMIND_NOTIFICATION_MARKERS)


def is_outbound_queue_meta(meta: dict, user_email: str = "") -> bool:
    """Sent mail or the user's own replies must not appear in the attention queue."""
    labels = meta.get("labelIds") or []
    if "SENT" in labels or "DRAFT" in labels:
        return True

    user = (user_email or "").strip().lower()
    addr = (meta.get("from_address") or "").strip().lower()
    if user and addr and addr == user:
        return True

    return False


def apply_triage_overrides(email_meta: dict, triage: dict) -> dict:
    """Hard overrides on LLM triage — job mail always needs manual review."""
    result = dict(triage)
    if is_job_recruiting_meta(email_meta):
        result["needs_manual_review"] = True
        if result.get("priority") == "low":
            result["priority"] = "medium"
    return result


def should_auto_reply(
    email_meta: dict,
    *,
    category: str,
    priority: str,
    needs_manual: bool,
) -> tuple[bool, str]:
    """
    LLM triage + safety gates. Personal and work both eligible when routine.

    Returns (allowed, reason).
    """
    if not settings.auto_send_enabled:
        return False, "auto_send_disabled"

    if not is_replyable_address(email_meta.get("from_address") or ""):
        return False, "non_replyable_sender"

    if is_job_recruiting_meta(email_meta):
        return False, "job_recruiting_requires_attention"

    if needs_manual:
        return False, "needs_manual_review"

    if category in ("spam", "newsletter", "critical"):
        return False, f"category_{category}"

    if category not in ("personal", "work"):
        return False, f"category_{category}"

    if priority == "high" and needs_manual:
        return False, "priority_high_needs_review"

    return True, f"{category}_auto_reply"
