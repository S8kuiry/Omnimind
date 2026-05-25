from groq import Groq
from config import GROQ_API_KEY, GROQ_MODEL
from services.conversation import (
    is_conversational,
    trim_history,
    CHAT_SYSTEM,
    DOC_SYSTEM,
)

client = Groq(api_key=GROQ_API_KEY)

# ── Prompt builders ────────────────────────────────────────────────

def _build_context(chunks: list[dict]) -> str:
    parts = [
        f"--- DOCUMENT SEGMENT ---\n"
        f"[Document: {c['source']}, Page: {c['page']}]\n"
        f"Content: {c['text']}"
        for c in chunks
    ]
    return "\n\n".join(parts)


# def _prompt_qa(question: str, chunks: list[dict]) -> str:
#     """
#     Standard Q&A — your upgraded prompt, kept exactly as you wrote it.
#     Used for all regular chat questions.
#     """
#     context = _build_context(chunks)
#     return f"""You are a High-Performance AI Document Analyst. Your goal is to provide accurate, cited, and context-aware responses.

# ### MANDATORY PROTOCOLS: 
# 1. **Source Awareness:** Multiple segments from the SAME filename are parts of ONE document — do NOT treat them as separate documents.
# 2. **Task Adaptation:**
#    - Specific fact → direct answer with citation.
#    - Comparison asked → contrast the documents involved.
#    - Multiple files but question about one → focus on relevant file, ignore others.
# 3. **Citation Format:** Every statement must cite its source: "The candidate knows React [Source: dev_resume.pdf, Page 2]."
# 4. **Null Rule:** If not in context, say: "Based on the provided documents, I cannot find information regarding [X]." Do NOT use outside knowledge.

# ### CONTEXT : 
# {context}

# ### USER QUESTION : 
# {question}

# ### STRUCTURED ANALYSIS: """

def _wants_full_resume_summary(question: str) -> bool:
    """Only use the full resume outline when the user asked for a broad profile summary."""
    q = question.lower()
    triggers = (
        "full resume",
        "entire resume",
        "whole cv",
        "summarize my resume",
        "summarize the resume",
        "resume summary",
        "overview of my resume",
        "profile summary",
        "break down my resume",
        "structure my resume",
    )
    if any(t in q for t in triggers):
        return True
    if "resume" in q and any(w in q for w in ("summarize", "summary", "overview", "review all")):
        return len(q) > 40
    return False


def _prompt_qa(question: str, chunks: list[dict], doc_names: list[str] | None = None) -> str:
    context = _build_context(chunks)
    indexed = ", ".join(doc_names) if doc_names else "see segments below"
    format_block = ""
    if _wants_full_resume_summary(question):
        format_block = """
### FORMAT (full resume summary):
Use `## Contact`, `## Education`, `## Experience`, `## Projects`, `## Technical Skills` — ONLY facts from the document. Skip empty sections.
Each section = `## Heading` then `- **Label:** value` bullets (one per line). Projects get `- **Name** — summary` plus `- detail` sub-bullets.
"""
    else:
        format_block = """
### FORMAT (targeted question):
- Use `##` matching the topic asked only. Do NOT dump Contact/Education/Experience/Projects unless asked.
- Bullets: `- **Label:** value` on separate lines. No broken `**` or `* *` markers.
"""

    return f"""Answer using ONLY the DOCUMENT CONTEXT below.

### GROUNDING:
1. Document context is the only source of truth — no training data.
2. Do not invent projects, stacks, or features not in the context.
3. Segments with the same filename are ONE document.
4. Do NOT write `[Source: ...]` — citations are added per section by the app.

### MARKDOWN (strict):
- `##` per section; `- **Label:** value` bullets; never `**Label:***value` or glued lines like `151- **`.
- Tech/stacks: comma-separated after one label bullet.

### INDEXED FILES:
{indexed}
{format_block}

### DOCUMENT CONTEXT:
{context}

### QUESTION:
{question}

### ANSWER:"""


def _prompt_guidance(chunks: list[dict]) -> str:
    """
    Auto-generates insights from a document without a user question.
    Runs automatically after a PDF is indexed.
    Returns: key obligations, risks, deadlines, actions, suggested questions.
    """
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
    """
    Compares two documents against each other.
    chunks_a = from document A, chunks_b = from document B.
    """
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

Cite every point with [Source: filename, Page X]."""


def _prompt_analytics(chunks: list[dict]) -> str:
    """
    Extracts structured metadata from a document:
    topics, tone, document type, key entities.
    """
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




def get_guidance(chunks: list[dict]) -> str:
    """Auto-insight report — used by /guidance endpoint."""
    prompt = _prompt_guidance(chunks)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=1500
    )
    return response.choices[0].message.content


def get_comparison(question: str, chunks_a: list[dict], chunks_b: list[dict]) -> str:
    """Document comparison — used by /compare endpoint."""
    prompt = _prompt_comparison(question, chunks_a, chunks_b)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=2048
    )
    return response.choices[0].message.content


def get_analytics(chunks: list[dict]) -> str:
    """Structured metadata extraction — used by /analytics endpoint."""
    prompt = _prompt_analytics(chunks)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,   # zero temp — we want consistent JSON
        max_tokens=512
    )
    return response.choices[0].message.content



def stream_answer(
    question: str,
    chunks: list[dict],
    history: list[dict] = [],
    model: str = GROQ_MODEL,
    *,
    doc_names: list[str] | None = None,
    force_document_mode: bool = False,
):
    conversational = is_conversational(question) and not force_document_mode
    trimmed = trim_history(history, max_messages=8, max_chars=600)

    # Social turns: chat mode — no document dump, minimal history
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
    elif chunks or force_document_mode:
        system = DOC_SYSTEM
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
    else:
        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        for msg in trimmed:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        temperature = 0.7

    kwargs: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": 120 if conversational else 2048,
        "stream": True,
    }
    stream = client.chat.completions.create(**kwargs)
    for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token