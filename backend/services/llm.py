from groq import Groq
from config import GROQ_API_KEY, GROQ_MODEL

client = Groq(api_key=GROQ_API_KEY)

# ── Prompt builders ────────────────────────────────────────────────

def _build_context(chunks: list[dict]) -> str:
    """Formats retrieved chunks into a labelled context block."""
    parts = [
        f"--- DOCUMENT SEGMENT ---\n"
        f"[Source: {c['source']}, Page: {c['page']}]\n"
        f"Content: {c['text']}"
        for c in chunks
    ]
    return "\n\n".join(parts)


def _prompt_qa(question: str, chunks: list[dict]) -> str:
    """
    Standard Q&A — your upgraded prompt, kept exactly as you wrote it.
    Used for all regular chat questions.
    """
    context = _build_context(chunks)
    return f"""You are a High-Performance AI Document Analyst. Your goal is to provide accurate, cited, and context-aware responses.

### MANDATORY PROTOCOLS:
1. **Source Awareness:** Identify if the context contains one document or multiple. 
2. **Task Adaptation:**
   - Specific fact → direct answer with citation.
   - Comparison asked → contrast the documents involved.
   - Multiple files but question about one → focus on relevant file, ignore others.
3. **Citation Format:** Every statement must cite its source: "The candidate knows React [Source: dev_resume.pdf, Page 2]."
4. **Null Rule:** If not in context, say: "Based on the provided documents, I cannot find information regarding [X]." Do NOT use outside knowledge.

### CONTEXT:
{context}

### USER QUESTION:
{question}

### STRUCTURED ANALYSIS:"""


def _prompt_guidance(chunks: list[dict]) -> str:
    """
    Auto-generates insights from a document without a user question.
    Runs automatically after a PDF is indexed.
    Returns: key obligations, risks, deadlines, actions, suggested questions.
    """
    context = _build_context(chunks)
    return f"""You are an expert document analyst. Analyse the document segments below and produce a structured intelligence report.

### CONTEXT:
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


# ── Public API ─────────────────────────────────────────────────────

# def get_answer(question: str, chunks: list[dict]) -> str:
#     """Standard Q&A — used by /query endpoint."""
#     prompt = _prompt_qa(question, chunks)
#     response = client.chat.completions.create(
#         model=GROQ_MODEL,
#         messages=[{"role": "user", "content": prompt}],
#         temperature=0.1,
#         max_tokens=1024
#     )
#     return response.choices[0].message.content


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


def stream_answer(question: str, chunks: list[dict]):
    """
    Streaming version of get_answer — yields tokens as they arrive.
    Used by /stream endpoint. Next.js reads this as Server-Sent Events.
    """
    # if no chunks — stream general knowledge answer
    if chunks:
        prompt = _prompt_qa(question, chunks)
    else:
        prompt = question  # raw question to Groq

    stream = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1 if chunks else 0.7,
        max_tokens=1024,
        stream=True
    )
    for chunk in stream:
        token = chunk.choices[0].delta.content
        if token:
            yield token


# def get_answer_no_context(question: str) -> str:
#     """Answers from Groq general knowledge when no PDF is uploaded."""
#     response = client.chat.completions.create(
#         model=GROQ_MODEL,
#         messages=[{"role": "user", "content": question}],
#         temperature=0.7,
#         max_tokens=1024
#     )
#     return response.choices[0].message.content