import asyncio
import json
import re
import uuid
import os  # Added for environment variable parsing
from contextlib import asynccontextmanager
from fastapi import FastAPI, Form, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.document_parser import extract_text_from_document
from services.chunker import chunk_pages
from services.embedder import embed_texts, embed_query, warmup_local_embeddings
from services.vector_store import (
    store_chunks,
    query_chunks,
    list_user_documents,
    delete_document,
    cleanup_expired_documents,
    get_page_chunks,
    get_all_document_pages,
    resolve_doc_name,
    list_doc_names_in_namespace,
    retrieve_chunks_for_question,
    _coerce_page,
)
from services.llm import (
    get_guidance,
    get_comparison,
    get_analytics,
    stream_answer,
    generate_chat_title,
)
from services.conversation import is_conversational
from services.citations import build_section_sources, build_section_sources_from_json
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


class TitleRequest(BaseModel):
    first_user_message: str
    first_assistant_message: str


# ── Health ─────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "OmniMind API running", "version": "2.0.0"}


@app.post("/title")
def title(req: TitleRequest):
    t = generate_chat_title(req.first_user_message, req.first_assistant_message)
    return {"title": t}


# ── Upload ─────────────────────────────────────────────────────────

def _index_pdf(file_bytes: bytes, doc_name: str, scope: str, job_id: str, filename: str) -> None:
    try:
        UPLOAD_JOBS[job_id] = {**UPLOAD_JOBS.get(job_id, {}), "status": "parsing"}
        pages = extract_text_from_document(file_bytes, filename)
        if not pages:
            UPLOAD_JOBS[job_id] = {"status": "error", "error": "Could not extract text from the document."}
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
    if not file.filename.endswith((".pdf", ".docx")):
        raise HTTPException(400, "Only PDF or DOCX  files accepted")

    file_bytes = await file.read()
    original_filename = file.filename 
    doc_name = file.filename.rsplit(".",1)[0].replace(" ", "_")
    scope = chat_id if chat_id else user_id
    job_id = str(uuid.uuid4())

    UPLOAD_JOBS[job_id] = {"status": "queued", "doc_name": doc_name}
    asyncio.create_task(asyncio.to_thread(_index_pdf, file_bytes, doc_name, scope, job_id, original_filename))

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
        if chunks:
            chunk_payload = [
                {
                    "source": c["source"],
                    "page": c["page"],
                    "snippet": c["text"][:200],
                    "text": c["text"][:800],
                }
                for c in chunks
            ]
            yield f"data: [CHUNKS]{json.dumps(chunk_payload)}\n\n"

        parsed_sections: list[dict] = []
        used_json: list[bool] = []

        full_response = ""
        for token in stream_answer(
            request.question,
            chunks,
            history=request.history or [],
            model=model,
            doc_names=doc_names,
            force_document_mode=force_doc_mode,
            parsed_sections_out=parsed_sections,
            used_json_out=used_json,
        ):
            full_response += token
            yield f"data: {token}\n\n"

        json_document_mode = bool(used_json and used_json[0])

        if not json_document_mode:
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

        if parsed_sections:
            section_sources = build_section_sources_from_json(parsed_sections, chunks)
            if not section_sources:
                section_sources = build_section_sources(full_response, chunks)
        else:
            section_sources = build_section_sources(full_response, chunks)
        if section_sources:
            yield f"data: [SECTION_SOURCES]{json.dumps(section_sources)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


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


@app.get("/document/{doc_name}/full")
async def get_document_full(
    doc_name: str,
    user_id: str,
    chat_id: str = "",
):
    try:
        scope = chat_id if chat_id else user_id
        norm = _normalize_doc_name(doc_name)
        resolved = resolve_doc_name(norm, scope)
        pages = get_all_document_pages(resolved, scope)
        if not pages:
            try:
                available = list_doc_names_in_namespace(scope)
            except Exception as exc:
                print(f"[get_document_full] list docs failed: {exc}")
                available = []
            raise HTTPException(
                404,
                f"No content found for {doc_name} in this chat. "
                f"Indexed documents: {available or 'none — upload PDF in this chat'}",
            )
        parts: list[str] = []
        for pg in pages:
            parts.append(f"— Page {pg['page']} —\n\n{pg['text']}")
        return {
            "doc_name": resolved,
            "pages": pages,
            "text": "\n\n".join(parts),
            "page_count": len(pages),
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[get_document_full] {doc_name} chat={chat_id}: {exc}")
        raise HTTPException(500, f"Failed to load document: {exc}") from exc


# ── Feature endpoints ──────────────────────────────────────────────

@app.get("/guidance/{doc_name}")
async def guidance(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id
    query_vec = embed_query(f"summary overview key points of {doc_name}")
    chunks = query_chunks(query_vec, user_id=scope, top_k=8, source_filter=doc_name)
    if not chunks:
        raise HTTPException(404, f"Document '{doc_name}' not found.")
    report = get_guidance(chunks)
    return {"doc_name": doc_name, "guidance": report}


@app.get("/analytics/{doc_name}")
async def analytics(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id
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

    chunks_a = query_chunks(query_vec, user_id=scope, top_k=4, source_filter=request.doc_a)
    chunks_b = query_chunks(query_vec, user_id=scope, top_k=4, source_filter=request.doc_b)

    if not chunks_a:
        raise HTTPException(404, f"Document '{request.doc_a}' not found.")
    if not chunks_b:
        raise HTTPException(404, f"Document '{request.doc_b}' not found.")

    result = get_comparison(request.question, chunks_a, chunks_b)
    return {"doc_a": request.doc_a, "doc_b": request.doc_b, "comparison": result}


# ── Document management ────────────────────────────────────────────

@app.get("/documents")
def list_documents(user_id: str):
    docs = list_user_documents(user_id)
    return {"documents": docs}


@app.delete("/document/{doc_name}")
def delete_doc(doc_name: str, user_id: str, chat_id: str = ""):
    scope = chat_id if chat_id else user_id
    deleted = delete_document(doc_name, scope)
    if deleted == 0:
        raise HTTPException(404, f"Document '{doc_name}' not found.")
    return {"message": f"Deleted '{doc_name}' successfully", "chunks_removed": deleted}


@app.get("/documents/chat/{chat_id}")
def get_chat_documents(chat_id: str):
    return {"documents": list_doc_names_in_namespace(chat_id)}


# ── Main Entrypoint Execution Configuration ───────────────────────
if __name__ == "__main__":
    import uvicorn
    
    # 1. Checks if an environment variable named 'PORT' exists.
    # 2. Defaults to 8001 if it's absent.
    target_port = int(os.getenv("PORT", 8001))
    
    print(f"📡 Launching OmniMind API on http://0.0.0.0:{target_port}")
    
    # Replace "main:app" with your actual file name if it's named differently (e.g., "api:app")
    uvicorn.run("main:app", host="0.0.0.0", port=target_port, reload=True)