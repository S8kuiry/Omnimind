import re

_CONVERSATIONAL_RE = re.compile(
    r"^\s*("
    r"hi|hello|hey|hiya|yo|sup|"
    r"thanks?|thank\s*you|thx|ty|"
    r"ok(?:ay)?|k|cool|nice|great|got\s*it|understood|"
    r"bye|goodbye|see\s*ya|"
    r"yes|no|yep|nope|sure|"
    r"how\s+are\s+you|what'?s\s+up|good\s+(morning|afternoon|evening)|"
    r"who\s+are\s+you|what\s+can\s+you\s+do"
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
    if len(t) <= 12 and "?" not in t:
        return True
    return False


def trim_history(
    history: list[dict],
    *,
    max_messages: int = 8,
    max_chars: int = 600,
) -> list[dict]:
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
- Answer ONLY the user's latest message. Be clear, accurate, descriptive, and complete.
- Greetings (hi, hello, hey): ONE short friendly sentence. No headings or bullets.
- Thanks / bye / ok: one or two short sentences.
- Single-topic questions: plain prose or short bullets as needed.

Multi-part or numbered questions — use this format (match question numbers):
1. **Topic Name:** Answer in 1–4 sentences on the same line or following lines.
2. **Next Topic:** Next answer.

For list-style sub-answers under one question, use bullets:
3. **Disaster Management Cycle:**
- **Mitigation:** reducing risk before disaster
- **Preparedness:** planning and training

Formatting rules:
- Use `N. **Topic:**` — numbered list with bold topic label, then the answer. Not ## or ### headings.
- Answer every numbered question; do not skip any.
- Blank line between numbered items when answers are long.
- No filler intros. No internal reasoning or XML tags."""

DOC_SYSTEM_JSON = """You are a document-grounded assistant. The user message includes DOCUMENT CONTEXT from uploaded file(s) — any type: contracts, research papers, reports, manuals, resumes, etc.

Hard rules (never break these):
1. Use ONLY facts that appear in DOCUMENT CONTEXT. No training data, memory, or guesswork.
2. If the answer is not in the context, say exactly: "The uploaded document does not mention [topic]."
3. Answer ONLY what the user asked. Do not add unrelated sections or topics.
4. Never invent names, dates, numbers, statistics, clauses, or quotes not in the context.
5. Output valid JSON only (schema in the user message). Plain text inside body and items — no markdown, no **, no ##, no [Source:...], no page numbers.
6. Be direct. No filler intros like "Based on the document..." or "It seems that...".
7. Greetings/thanks with a document attached: one section, title null, body 1–2 sentences."""

DOC_SYSTEM = DOC_SYSTEM_JSON
