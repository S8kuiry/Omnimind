import re

# Short social / acknowledgment turns — answer briefly, don't re-run doc QA
_CONVERSATIONAL_RE = re.compile(
    r"^\s*("
    r"hi|hello|hey|hiya|yo|sup|"
    r"thanks?|thank\s*you|thx|ty|"
    r"ok(?:ay)?|k|cool|nice|great|got\s*it|understood|"
    r"bye|goodbye|see\s*ya|"
    r"yes|no|yep|nope|sure|"
    r"how\s+are\s+you|what'?s\s+up|good\s+(morning|afternoon|evening)"
    r")\s*[!.?]*\s*$",
    re.IGNORECASE,
)


def is_conversational(text: str) -> bool:
    """True for greetings, thanks, and other non-substantive turns."""
    t = (text or "").strip()
    if not t:
        return False
    if len(t) <= 48 and _CONVERSATIONAL_RE.match(t):
        return True
    # Very short messages with no question mark and no doc keywords
    if len(t) <= 12 and "?" not in t:
        return True
    return False


def trim_history(
    history: list[dict],
    *,
    max_messages: int = 8,
    max_chars: int = 600,
) -> list[dict]:
    """Keep recent turns but cap size so old long answers don't dominate context."""
    trimmed: list[dict] = []
    for msg in history[-max_messages:]:
        role = msg.get("role", "user")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if len(content) > max_chars:
            content = content[: max_chars - 3].rstrip() + "..."
        trimmed.append({"role": role, "content": content})
    return trimmed


CHAT_SYSTEM = """You are a helpful assistant in an ongoing conversation.

Rules:
- Answer ONLY the user's latest message. Do not repeat, re-list, or re-answer earlier questions unless they explicitly ask you to.
- For greetings, thanks, or brief acknowledgments: reply naturally in one or two short sentences. Do not bring up prior topics unless the user asks.
- Stay concise unless the user asks for detail.
- Format for readability: use ## / ### headings, short paragraphs, and bullet lists. Avoid wide markdown tables unless the user explicitly asks for a table.
- Never wrap the entire answer in one giant table row. Never put markdown headings inside table cells.
- For how-to guides use ### step headings, short paragraphs, and > Tip: callouts — NOT markdown tables.
- If you must use a table: one row per line, no HTML, no headings inside cells.
- No internal reasoning or XML tags."""

DOC_SYSTEM = """You are a document assistant in an ongoing conversation.

Rules:
- Answer ONLY the user's latest question using the document context in their latest message when present.
- Do not repeat prior answers unless the user asks.
- Greetings/thanks: 1–2 sentences only.
- Do not write [Source: ...] in the answer — the app shows source chips separately.
- Always use rich markdown: ## sections, ### subsections, `-` bullet lists (one item per line), **bold** key terms, `> **Tip:**` callouts, `---` between major sections.
- Never dump skills/projects/experience as one long paragraph or inline `* a * b * c` lists.
- No filler intros ("Based on the provided context…"). Start with substance.
- Tables only when truly tabular; one row per line. No HTML."""
