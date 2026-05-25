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

def _prompt_qa(question: str, chunks: list[dict]) -> str:
    context = _build_context(chunks)
    return f"""You are an expert document analyst. Answer using ONLY the document context below, with clear, modern markdown — like Claude or Notion, not a plain essay.

### CONTENT RULES:
1. **One document per filename.** Segments from the same file are one doc — never label them "Document 1 / 2".
2. **Citations** are added automatically by the app — do NOT write `[Source: ...]` in the answer text.
3. If something is not in the documents, say so briefly — do not invent facts.
4. **No filler openings** — never start with "Based on the provided document context" or "It seems you're…". Start with a useful one-line takeaway, then structure.

### FORMATTING (required — broken markdown will break the UI):
- **Resume / profile questions:** Use exactly these `##` sections in order: `## Overview`, `## Technical Skills`, `## Projects`, `## Experience`, `## Education`. Put skills in ONE `## Technical Skills` section with grouped `- **Category:** item, item` bullets (max 5 groups). Do NOT create a separate `###` per skill.
- **Other questions:** `##` main sections + `###` subsections only when the answer has 3+ distinct parts.
- **Lists:** One item per line: `- **Label:** short detail` (under 15 words per bullet). NEVER inline `* item * item` on one line.
- **Paragraphs:** Max 2 sentences; blank line between sections.
- **Emphasis:** Bold **technologies**, **roles**, **companies**, and **metrics**.
- **Tips:** When giving advice, use a blockquote: `> **Tip:** …`
- **Links:** If the document contains URLs, use `[label](url)`. Do not invent links.
- **Dividers:** Use `---` between major sections on long answers (resume summaries, guides).
- **No HTML** (<br>, <ul>). No XML/thinking tags. No single giant paragraph for a full resume review.
- For how-tos: numbered steps with `###` per step, not walls of text.

### DOCUMENT CONTEXT:
{context}

### QUESTION:
{question}

### ANSWER (markdown, structured):"""


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



def stream_answer(question: str, chunks: list[dict], history: list[dict] = [], model: str = GROQ_MODEL):
    conversational = is_conversational(question)
    trimmed = trim_history(history, max_messages=8, max_chars=600)

    # Social turns: chat mode — no document dump, minimal history
    if conversational:
        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        for msg in trimmed[-4:]:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        temperature = 0.6
    elif chunks:
        messages = [{"role": "system", "content": DOC_SYSTEM}]
        for msg in trimmed:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": _prompt_qa(question, chunks)})
        temperature = 0.15
    else:
        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        for msg in trimmed:
            messages.append({"role": msg["role"], "content": msg["content"]})
        messages.append({"role": "user", "content": question})
        temperature = 0.7

    stream = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=2048,
        stream=True
    )
    for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token