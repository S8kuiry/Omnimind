"""
Auto-reply policy — LLM triage drives decisions, not hardcoded brand lists.

Only universal technical rules are hardcoded (non-replyable addresses, system mail).
"""

import re
from config import settings

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

# Job / recruiting — never auto-reply; always surface to attention first
_JOB_RECRUITING_RE = re.compile(
    r"job\s+(opening|opportunity|offer|alert|posting|application|position|role)"
    r"|(?:we'?re|we are)\s+hiring"
    r"|hiring\s+for"
    r"|(?:apply|application)\s+(?:now|here|today|link|via)"
    r"|(?:invited?\s+to\s+apply|please\s+apply|submit\s+your\s+(?:cv|resume))"
    r"|recruiter|recruitment|talent\s+acquisition|headhunter|staffing"
    r"|interview\s+(?:invite|invitation|scheduled|request|slot)"
    r"|(?:naukri|indeed|glassdoor|linkedin\s+jobs?|wellfound|angelist)"
    r"|placement\s+(?:drive|cell|opportunity)"
    r"|campus\s+(?:hire|hiring|placement)"
    r"|(?:new|exciting)\s+(?:role|opportunity)\s+(?:at|for|with)"
    r"|(?:shortlisted|selected)\s+for\s+(?:the\s+)?(?:role|position|interview)",
    re.I,
)
_JOB_RECRUITING_DOMAINS = (
    "linkedin.com",
    "jobs.linkedin.com",
    "noreply@linkedin.com",
    "naukri.com",
    "info@naukri.com",
    "indeed.com",
    "glassdoor.com",
    "wellfound.com",
    "angel.co",
    "greenhouse.io",
    "lever.co",
    "workday.com",
    "myworkday.com",
    "smartrecruiters.com",
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
    """Job offers, apply links, and recruiter mail must reach the user before any auto-reply."""
    addr = (meta.get("from_address") or "").lower()
    if any(domain in addr for domain in _JOB_RECRUITING_DOMAINS):
        return True
    return bool(_JOB_RECRUITING_RE.search(_email_text_blob(meta)))


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

    if priority == "high":
        return False, "priority_high"

    if category not in ("personal", "work"):
        return False, f"category_{category}"

    return True, f"{category}_auto_reply"
