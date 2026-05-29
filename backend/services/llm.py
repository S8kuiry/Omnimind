from groq import Groq
from groq import BadRequestError
import re

from config import GROQ_API_KEY, GROQ_MODEL
from services.conversation import (
    is_conversational,
    trim_history,
    CHAT_SYSTEM,
    DOC_SYSTEM_JSON,
)
from services.document_response import (
    DOCUMENT_JSON_SCHEMA_HINT,
    JSON_EXAMPLE_LIST,
    JSON_EXAMPLE_MULTI,
    JSON_EXAMPLE_NARROW,
    JSON_EXAMPLE_SUMMARY,
    resolve_document_display,
    strip_reasoning_blocks,
)

client = Groq(api_key=GROQ_API_KEY)

_SUMMARY_TRIGGERS = (
    "summarize", "summary", "overview", "full document", "whole document",
    "entire document", "break down", "key points", "main points",
)
_LIST_TRIGGERS = ("list ", "list all", "what are the", "enumerate", "bullet")


def _build_context(chunks: list[dict]) -> str:
    parts = [
        f"--- DOCUMENT SEGMENT ---\n"
        f"[Document: {c['source'].replace('.pdf', '')}, Page: {c['page']}]\n"
        f"Content: {c['text']}"
        for c in chunks
    ]
    return "\n\n".join(parts)


def _classify_document_query(question: str) -> str:
    q = question.lower().strip()
    if any(t in q for t in _SUMMARY_TRIGGERS):
        return "full_summary"
    if any(t in q for t in _LIST_TRIGGERS) or (q.startswith("list ") and "?" in q):
        return "list"
    if q.count("?") > 1:
        return "multi_part"
    if re.search(r"\d+\.\s", question):
        return "multi_part"
    if " and " in q and len(q) > 50 and "?" in q:
        return "multi_part"
    return "narrow"


def _json_format_instructions(query_type: str) -> str:
    examples = {
        "narrow": JSON_EXAMPLE_NARROW,
        "list": JSON_EXAMPLE_LIST,
        "multi_part": JSON_EXAMPLE_MULTI,
        "full_summary": JSON_EXAMPLE_SUMMARY,
    }
    hints = {
        "narrow": (
            "Focused question. Use exactly ONE section with \"title\": null. "
            "Put the full answer in body."
        ),
        "list": (
            "User wants a list. Use ONE section with a short title. "
            "Put each entry in items."
        ),
        "multi_part": (
            "Multiple sub-questions. Use ONE section per sub-topic with a clear title and body."
        ),
        "full_summary": (
            "Broad summary. One section per major topic from DOCUMENT CONTEXT (max 8 sections)."
        ),
    }
    example = examples.get(query_type, JSON_EXAMPLE_NARROW)
    hint = hints.get(query_type, hints["narrow"])
    return f"""
Return ONLY valid JSON — no markdown fences, no text before or after.

Schema:
{DOCUMENT_JSON_SCHEMA_HINT}

Structure for this question ({query_type}):
{hint}

Example (format only — do not copy facts):
{example}

JSON rules:
- mode must be "document"
- body and items: plain text only (no ##, no **, no - prefix in strings, no [Source: ...])
- Do not include citations or page numbers — the app adds those automatically
- If unsure, use one section with title null and put the answer in body
"""


def _prompt_qa(question: str, chunks: list[dict], doc_names: list[str] | None = None) -> str:
    context = _build_context(chunks)
    indexed = ", ".join(doc_names) if doc_names else "see segments below"
    query_type = _classify_document_query(question)
    return f"""Read DOCUMENT CONTEXT and answer QUESTION.

Write JSON using ONLY facts from DOCUMENT CONTEXT.
{_json_format_instructions(query_type)}

INDEXED FILES: {indexed}

DOCUMENT CONTEXT:
{context}

QUESTION: {question}"""


def _prompt_guidance(chunks: list[dict]) -> str:
    context = _build_context(chunks)
    return f"""You are an expert document analyst. Analyse the document segments below and produce a structured intelligence report.

### CONTEXT :
{context}

### DELIVER EXACTLY THIS STRUCTURE (use these exact headings):

**SUMMARY**
One paragraph summary of what this document is about.

**KEY OBLIGATIONS**
Bullet list of what the reader is required to do.

**RISKS & WARNINGS**
Bullet list of anything flagged as a risk, penalty, or warning.

**IMPORTANT DEADLINES**
Bullet list of any dates, timeframes, or deadlines mentioned.

**ACTIONS REQUIRED**
Bullet list of concrete next steps the reader should take.

**SUGGESTED QUESTIONS**
5 smart questions a user might want to ask about this document."""


def _prompt_comparison(question: str, chunks_a: list[dict], chunks_b: list[dict]) -> str:
    context_a = _build_context(chunks_a)
    context_b = _build_context(chunks_b)
    return f"""You are a document comparison specialist. Compare the two documents below precisely.

### DOCUMENT A:
{context_a}

### DOCUMENT B:
{context_b}

### COMPARISON REQUEST:
{question}

### DELIVER EXACTLY THIS STRUCTURE:

**SIMILARITIES**
What both documents agree on or share.

**DIFFERENCES**
Point-by-point differences between the two.

**CONTRADICTIONS**
Anything Document A says that Document B contradicts, or vice versa.

**VERDICT**
Which document is more detailed / comprehensive on the topic asked, and why.

Cite every point inline immediately after the sentence, format: [Source: doc_name, Page N]."""


def _prompt_analytics(chunks: list[dict]) -> str:
    context = _build_context(chunks)
    return f"""You are a document intelligence engine. Analyse the document below and extract structured metadata.

### CONTEXT:
{context}

### DELIVER EXACTLY THIS JSON (no markdown, raw JSON only):
{{
  "document_type": "e.g. Resume / Contract / Research Paper / Report",
  "main_topics": ["topic1", "topic2", "topic3"],
  "tone": "e.g. Formal / Technical / Legal / Casual",
  "key_entities": ["person or org names found"],
  "estimated_purpose": "one sentence on what this document is for",
  "complexity_level": "Basic / Intermediate / Advanced"
}}"""


def _response_format_for_model(model: str) -> dict | None:
    m = (model or "").lower()
    if "gpt-oss" in m:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": "document_response",
                "schema": {
                    "type": "object",
                    "properties": {
                        "mode": {"type": "string"},
                        "sections": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": ["string", "null"]},
                                    "body": {"type": "string"},
                                    "items": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["body", "items"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["mode", "sections"],
                    "additionalProperties": False,
                },
            },
        }
    return {"type": "json_object"}


def _complete_chat(*, model: str, messages: list, temperature: float, max_tokens: int) -> str:
    fmt = _response_format_for_model(model)
    if fmt:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
                response_format=fmt,
            )
            return (resp.choices[0].message.content or "").strip()
        except BadRequestError:
            pass
        except Exception as exc:
            err = str(exc).lower()
            if "json" not in err and "response_format" not in err and "schema" not in err:
                raise

    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=False,
    )
    return (resp.choices[0].message.content or "").strip()


def _stream_text_preserving_layout(text: str):
    if not text:
        return
    i = 0
    n = len(text)
    while i < n:
        nl = text.find("\n", i)
        if nl == -1:
            line = text[i:]
            i = n
        else:
            line = text[i:nl]
            i = nl + 1
        if line.strip():
            words = line.split(" ")
            for j, word in enumerate(words):
                if word:
                    yield word + (" " if j < len(words) - 1 else "")
        yield "\n"


def get_guidance(chunks: list[dict]) -> str:
    prompt = _prompt_guidance(chunks)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1500,
    )
    return response.choices[0].message.content


def get_comparison(question: str, chunks_a: list[dict], chunks_b: list[dict]) -> str:
    prompt = _prompt_comparison(question, chunks_a, chunks_b)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=2048,
    )
    return response.choices[0].message.content


def get_analytics(chunks: list[dict]) -> str:
    prompt = _prompt_analytics(chunks)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=512,
    )
    return response.choices[0].message.content


def generate_chat_title(first_user_message: str, first_assistant_message: str) -> str:
    user = (first_user_message or "").strip()
    assistant = (first_assistant_message or "").strip()
    prompt = f"""Create a short chat title (3-7 words) for this conversation.
Return ONLY the title as plain text.
Do not include quotes, punctuation at the end, markdown, bullets, or code.

User: {user}
Assistant: {assistant}
"""
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=24,
    )
    title = (response.choices[0].message.content or "").strip()
    title = title.replace('"', "").replace("'", "").strip()
    title = title.splitlines()[0].strip()
    if not title:
        return "General Conversation"
    if title.lower() in {"new chat", "chat", "conversation"}:
        return "General Conversation"
    if len(title) > 60:
        title = title[:60].rstrip()
    return title


def stream_answer(
    question: str,
    chunks: list[dict],
    history: list[dict] = [],
    model: str = GROQ_MODEL,
    *,
    doc_names: list[str] | None = None,
    force_document_mode: bool = False,
    parsed_sections_out: list | None = None,
    used_json_out: list | None = None,
):
    conversational = is_conversational(question) and not force_document_mode
    trimmed = trim_history(history, max_messages=8, max_chars=600)
    use_json_mode = bool(chunks) and not conversational
    query_type = _classify_document_query(question) if (chunks or force_document_mode) else "narrow"

    if conversational:
        greet_system = (
            CHAT_SYSTEM
            + "\n\nThe user sent a greeting or very short message. "
            "Reply in plain text, max 2 sentences. Forbidden: ## headings, bullet lists, Tips, resume data."
        )
        messages = [{"role": "system", "content": greet_system}]
        for msg in trimmed[-2:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        temperature = 0.4
        max_tokens = 120
    elif chunks or force_document_mode:
        system = DOC_SYSTEM_JSON
        if doc_names:
            system += f"\n\nActive uploaded files: {', '.join(doc_names)}."
        if force_document_mode and not chunks:
            system += (
                "\n\nNo text segments were retrieved, but the user has files in this chat. "
                "Tell them you cannot read the document right now and ask them to re-upload — "
                "do not answer from general knowledge."
            )
        messages = [{"role": "system", "content": system}]
        for msg in trimmed:
            messages.append({"role": msg["role"], "content": msg["content"]})
        user_content = (
            _prompt_qa(question, chunks, doc_names)
            if chunks
            else f"QUESTION: {question}\n\n(No document segments retrieved.)"
        )
        messages.append({"role": "user", "content": user_content})
        temperature = 0.1
        max_tokens = 8192 if query_type in ("multi_part", "full_summary", "list") else 2048
    else:
        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        for msg in trimmed:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        numbered_qs = len(re.findall(r"\d+\.\s", question or ""))
        long_chat = len((question or "").strip()) >= 100 or numbered_qs >= 1
        temperature = 0.4 if numbered_qs >= 2 else (0.5 if long_chat else 0.7)
        max_tokens = 8192 if numbered_qs >= 2 else (4096 if long_chat else 2048)

    if use_json_mode:
        raw = _complete_chat(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        raw = strip_reasoning_blocks(raw)
        sections, display, used_json = resolve_document_display(raw, layout=query_type)

        if parsed_sections_out is not None:
            parsed_sections_out.clear()
            parsed_sections_out.extend(sections)

        if used_json_out is not None:
            used_json_out.clear()
            used_json_out.append(used_json)

        if not display and raw.strip():
            display = raw.strip()

        for token in _stream_text_preserving_layout(display):
            yield token
        return

    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token
