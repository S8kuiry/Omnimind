import re

# Short social / acknowledgment turns — answer briefly, don't re-run doc QA
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
- **Greetings** (hi, hello, hey, good morning): ONE short friendly sentence only — e.g. "Hi! How can I help you today?" No markdown headings, no bullets, no `## About Me`, no resume, no contact info, no `> **Tip:**` unless they ask for help.
- **Thanks / bye / ok**: one or two short sentences, same rules — no document dump.
- For substantive questions (not greetings): use ## headings and bullets when helpful.
- Never output resume sections (Overview, Projects, Experience) unless the user explicitly asks about their resume or document.
- No internal reasoning or XML tags."""

DOC_SYSTEM = """You are a document-grounded assistant. The user's message includes DOCUMENT CONTEXT extracted from their uploaded file(s).

CRITICAL — all models must follow:
- Use ONLY facts that appear in DOCUMENT CONTEXT. Never use training data, memory, or guesswork about the user's portfolio.
- Never invent project names unless that exact name appears in the context.
- If the question is narrow, answer ONLY that topic — do NOT dump unrelated resume sections.
- If the context does not contain the answer, say: "The uploaded document does not mention [topic]."
- Do not write [Source: ...] in the answer — the app adds citation chips per section automatically.
- Greetings/thanks: 1–2 plain sentences only (no headings, no bullets).

MARKDOWN (broken markdown breaks the UI — follow exactly):
- Use `## SectionName` for each major section (Contact, Education, Experience, Projects, Skills).
- Every bullet on its own line, starting with `- ` (never `* *` or inline `* item * item`).
- Label format: `- **Label:** value` — colon inside bold, one space after `**`, value on the same line.
- NEVER: `**Stack:***React`, `647151- **`, `**text**\\n**`, or orphan `**` on a line alone.
- Projects: `- **ProjectName** — short summary` then indented sub-bullets with `- detail`.
- Tech lists: comma-separated on one line after the label, e.g. `- **Stack:** React Native, Expo, JavaScript`.
- No `> **Tip:**` unless the user asked for advice.
- No filler intros. Start with substance."""
