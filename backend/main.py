import asyncio
import json
import re
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Form, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.pdf_parser import extract_text_from_pdf
from services.chunker import chunk_pages
from services.embedder import embed_texts, embed_query, warmup_local_embeddings
from services.vector_store import (
    store_chunks,
    query_chunks,
    list_user_documents,
    delete_document,
    cleanup_expired_documents,
    get_page_chunks,
    resolve_doc_name,
    list_doc_names_in_namespace,
    retrieve_chunks_for_question,
    _coerce_page,
)
from services.llm import (
     get_guidance,
    get_comparison, get_analytics, stream_answer
)
from services.conversation import is_conversational
from config import TOP_K_RESULTS, GROQ_MODEL, ALLOWED_MODELS


# ── Startup: run TTL cleanup when server boots ─────────────────────

UPLOAD_JOBS: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # runs once on startup — cleans up any stale docs from last session
    summary = cleanup_expired_documents()
    print(f"[Startup cleanup] {summary}")
    await asyncio.to_thread(warmup_local_embeddings)
    yield
    # shutdown logic here if needed later


app = FastAPI(title="OmniMind API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows every single domain
    allow_credentials=True, 
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────

class QueryRequest(BaseModel):
    question: str
    user_id: str
    chat_id: str | None = None   # which chat session
    source_type: str = "pdf"
    history: list[dict] = []
    model: str | None = None
    has_documents: bool = False
    document_names: list[str] = []


def _resolve_model(model: str | None) -> str:
    if model and model in ALLOWED_MODELS:
        return model
    return GROQ_MODEL


def _normalize_doc_name(name: str) -> str:
    """Match Pinecone source field (upload strips .pdf and spaces)."""
    return name.strip().replace(".pdf", "").replace(" ", "_")


class CompareRequest(BaseModel):
    question: str
    user_id: str
    chat_id: str = ""
    doc_a: str
    doc_b: str


# ── Health ─────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "OmniMind API running", "version": "2.0.0"}


# ── Upload ─────────────────────────────────────────────────────────

def _index_pdf(file_bytes: bytes, doc_name: str, scope: str, job_id: str) -> None:
    try:
        UPLOAD_JOBS[job_id] = {**UPLOAD_JOBS.get(job_id, {}), "status": "parsing"}
        pages = extract_text_from_pdf(file_bytes)
        if not pages:
            UPLOAD_JOBS[job_id] = {"status": "error", "error": "Could not extract text from PDF."}
            return

        UPLOAD_JOBS[job_id]["status"] = "embedding"
        chunks = chunk_pages(pages)
        embeddings = embed_texts([c["text"] for c in chunks])

        UPLOAD_JOBS[job_id]["status"] = "storing"
        stored = store_chunks(chunks, embeddings, doc_name, scope)

        UPLOAD_JOBS[job_id] = {
            "status": "ready",
            "doc_name": doc_name,
            "pages_processed": len(pages),
            "chunks_stored": stored,
            "message": f"Indexed {doc_name}",
        }
    except Exception as exc:
        UPLOAD_JOBS[job_id] = {"status": "error", "error": str(exc)}


@app.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    user_id: str = Form("anonymous"),
    chat_id: str = Form(""),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")

    file_bytes = await file.read()
    doc_name = file.filename.replace(".pdf", "").replace(" ", "_")
    scope = chat_id if chat_id else user_id
    job_id = str(uuid.uuid4())

    UPLOAD_JOBS[job_id] = {"status": "queued", "doc_name": doc_name}
    asyncio.create_task(asyncio.to_thread(_index_pdf, file_bytes, doc_name, scope, job_id))

    return {
        "status": "processing",
        "job_id": job_id,
        "doc_name": doc_name,
        "message": f"Indexing {file.filename}…",
    }


@app.get("/upload/status/{job_id}")
def upload_status(job_id: str):
    job = UPLOAD_JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Upload job not found")
    return job





@app.post("/stream")
async def stream(request: QueryRequest):
    scope = request.chat_id or request.user_id
    doc_names = request.document_names or []
    if request.has_documents and not doc_names:
        doc_names = list_doc_names_in_namespace(scope)

    chunks: list[dict] = []
    conversational = is_conversational(request.question)
    # Keep greetings short — do not force document/RAG mode just because a PDF exists
    force_doc_mode = (bool(doc_names) or request.has_documents) and not conversational
    if not conversational:
        chunks = retrieve_chunks_for_question(
            request.question,
            scope,
            doc_names=doc_names or None,
            top_k=TOP_K_RESULTS,
        )

    model = _resolve_model(request.model)

    def event_generator():
        # 1. Emit retrieved chunks for citation sidebar (client parses [CHUNKS])
        if chunks:
            chunk_payload = [
                {
                    "source": c["source"],
                    "page": c["page"],
                    "snippet": c["text"][:200],
                }
                for c in chunks
            ]
            yield f"data: [CHUNKS]{json.dumps(chunk_payload)}\n\n"

        # 2. Stream LLM tokens (plain text — matches useStream.ts)
        full_response = ""
        for token in stream_answer(
            request.question,
            chunks,
            history=request.history or [],
            model=model,
            doc_names=doc_names,
            force_document_mode=force_doc_mode,
        ):
            full_response += token
            yield f"data: {token}\n\n"

        # 3. Parse [Source: X, Page N] citations from completed response
        pattern = r'\[Source:\s*([^,\]]+),\s*Page[\s:](\d+)\]'
        matches = re.findall(pattern, full_response)
        seen = set()
        sources = []
        for source, page in matches:
            norm = _normalize_doc_name(source.strip())
            key = f"{norm}-{page}"
            if key not in seen:
                seen.add(key)
                sources.append({"source": norm, "page": int(page)})

        if sources:
            yield f"data: [SOURCES]{json.dumps(sources)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

#pdf citation helper
@app.get("/document/{doc_name}/page/{page}")
async def get_document_page(
    doc_name: str,
    page: int,
    user_id: str,
    chat_id: str = "",
    highlight: str = "",
):
    try:
        scope = chat_id if chat_id else user_id
        norm = _normalize_doc_name(doc_name)
        resolved = resolve_doc_name(norm, scope)
        chunks = get_page_chunks(resolved, page, scope)
        if not chunks:
            try:
                available = list_doc_names_in_namespace(scope)
            except Exception as exc:
                print(f"[get_document_page] list docs failed: {exc}")
                available = []
            raise HTTPException(
                404,
                f"No content found for {doc_name} page {page} in this chat. "
                f"Indexed documents: {available or 'none — upload PDF in this chat'}",
            )
        actual_page = _coerce_page(chunks[0].get("page", page)) or page
        return {
            "doc_name": resolved,
            "page": actual_page,
            "text": "\n\n".join(c["text"] for c in chunks),
            "chunks": chunks,
            "highlight": highlight[:2000] if highlight else "",
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[get_document_page] {doc_name} p{page} chat={chat_id}: {exc}")
        raise HTTPException(500, f"Failed to load document page: {exc}") from exc



# ── Feature endpoints ──────────────────────────────────────────────
@app.get("/guidance/{doc_name}")
async def guidance(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id  # ✅ same as upload/stream
    query_vec = embed_query(f"summary overview key points of {doc_name}")
    chunks = query_chunks(query_vec, user_id=scope, top_k=8, source_filter=doc_name)
    if not chunks:
        raise HTTPException(404, f"Document '{doc_name}' not found.")
    report = get_guidance(chunks)
    return {"doc_name": doc_name, "guidance": report}




@app.get("/analytics/{doc_name}")
async def analytics(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id  # ✅ same as upload/stream
    query_vec = embed_query(f"summary overview key points of {doc_name}")
    chunks = query_chunks(query_vec, user_id=scope, top_k=8, source_filter=doc_name)
    if not chunks:
        raise HTTPException(404, f"Document '{doc_name}' not found.")
    report = get_analytics(chunks)
    return {"doc_name": doc_name, "analytics": report}


    

@app.post("/compare")
async def compare(request: CompareRequest):
    scope = request.chat_id if request.chat_id else request.user_id
    query_vec = embed_query(request.question)

    chunks_a = query_chunks(query_vec, user_id=scope,
                            top_k=4, source_filter=request.doc_a)
    chunks_b = query_chunks(query_vec, user_id=scope,
                            top_k=4, source_filter=request.doc_b)

    if not chunks_a:
        raise HTTPException(404, f"Document '{request.doc_a}' not found.")
    if not chunks_b:
        raise HTTPException(404, f"Document '{request.doc_b}' not found.")

    result = get_comparison(request.question, chunks_a, chunks_b)
    return {"doc_a": request.doc_a, "doc_b": request.doc_b, "comparison": result}


# ── Document management ────────────────────────────────────────────

@app.get("/documents")
def list_documents(user_id: str):
    """
    Lists all documents for this user with upload time,
    last accessed time, and days until auto-deletion.
    Next.js uses this to populate the document sidebar.
    """
    docs = list_user_documents(user_id)
    return {"documents": docs}

    

@app.delete("/document/{doc_name}")
def delete_doc(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id  # same logic as upload
    deleted = delete_document(doc_name, scope)
    if deleted == 0:
        raise HTTPException(404, f"Document '{doc_name}' not found.")
    return {"message": f"Deleted '{doc_name}' successfully", "chunks_removed": deleted}



# fetching pdfs from pinecone
@app.get("/documents/chat/{chat_id}")
def get_chat_documents(chat_id: str):
    """Returns all doc names uploaded in this chat's namespace."""
    return {"documents": list_doc_names_in_namespace(chat_id)}

