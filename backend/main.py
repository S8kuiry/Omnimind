import json
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, Form, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.pdf_parser import extract_text_from_pdf
from services.chunker import chunk_pages
from services.embedder import embed_texts, embed_query
from services.vector_store import (
    store_chunks, query_chunks,
    list_user_documents, delete_document,
    cleanup_expired_documents
)
from services.llm import (
     get_guidance,
    get_comparison, get_analytics, stream_answer
)
from config import TOP_K_RESULTS


# ── Startup: run TTL cleanup when server boots ─────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # runs once on startup — cleans up any stale docs from last session
    summary = cleanup_expired_documents()
    print(f"[Startup cleanup] {summary}")
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

class CompareRequest(BaseModel):
    question: str
    user_id: str
    doc_a: str
    doc_b: str


# ── Health ─────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "OmniMind API running", "version": "2.0.0"}


# ── Upload ─────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form("anonymous"),
    chat_id: str = Form("")          # scope upload to a specific chat
):
    print("upload debug:", user_id, chat_id)  # 👈 add this

    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")

    file_bytes = await file.read()
    pages = extract_text_from_pdf(file_bytes)
    if not pages:
        raise HTTPException(400, "Could not extract text.")

    chunks = chunk_pages(pages)
    embeddings = embed_texts([c["text"] for c in chunks])
    print(len(embeddings[0]))  # this is your actual dimension

    doc_name = file.filename.replace(".pdf", "").replace(" ", "_")
    
    # use chat_id as the Pinecone namespace so PDF is scoped to this chat
    scope = chat_id if chat_id else user_id
    stored = store_chunks(chunks, embeddings, doc_name, scope)
    background_tasks.add_task(cleanup_expired_documents)

    return {
        "message": f"Indexed {file.filename}",
        "doc_name": doc_name,
        "pages_processed": len(pages),
        "chunks_stored": stored
    }



# @app.post("/stream")
# async def stream(request: QueryRequest):
#     """Streaming Q&A via Server-Sent Events, scoped to user."""
#     query_vec = embed_query(request.question)
#     scope = request.chat_id or request.user_id
#     chunks = query_chunks(query_vec, user_id=scope, top_k=TOP_K_RESULTS)

#     def event_generator():
#         for token in stream_answer(request.question, chunks):  # chunks can be []
#             yield f"data: {token}\n\n"
#         yield "data: [DONE]\n\n"

#     return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/stream")
async def stream(request: QueryRequest):
    query_vec = embed_query(request.question)
    scope = request.chat_id or request.user_id
    chunks = query_chunks(query_vec, user_id=scope, top_k=TOP_K_RESULTS)

    def event_generator():
        full_response = ""
        for token in stream_answer(request.question, chunks):
            full_response += token
            yield f"data: {token}\n\n"
        
        # after streaming done — extract and send sources separately
        pattern = r'\[Source:\s*([^,\]]+),\s*Page\s*(\d+)\]'
        matches = re.findall(pattern, full_response)
        seen = set()
        sources = []
        for source, page in matches:
            key = f"{source}-{page}"
            if key not in seen:
                seen.add(key)
                sources.append({"source": source.strip(), "page": int(page)})
        
        if sources:
            import json
            yield f"data: [SOURCES]{json.dumps(sources)}\n\n"
        
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ── Feature endpoints ──────────────────────────────────────────────

@app.get("/guidance/{doc_name}")
async def guidance(doc_name: str, user_id: str):
    query_vec = embed_query(f"summary overview key points of {doc_name}")
    chunks = query_chunks(query_vec, user_id=user_id, top_k=8,
                          source_filter=doc_name)
    if not chunks:
        raise HTTPException(404, f"Document '{doc_name}' not found.")

    report = get_guidance(chunks)
    return {"doc_name": doc_name, "guidance": report}


@app.get("/analytics/{doc_name}")
async def analytics(doc_name: str, user_id: str):
    query_vec = embed_query(f"main content topics structure of {doc_name}")
    chunks = query_chunks(query_vec, user_id=user_id, top_k=6,
                          source_filter=doc_name)
    if not chunks:
        raise HTTPException(404, f"Document '{doc_name}' not found.")

    raw = get_analytics(chunks)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
        data = json.loads(cleaned)

    return {"doc_name": doc_name, "analytics": data}


@app.post("/compare")
async def compare(request: CompareRequest):
    query_vec = embed_query(request.question)

    chunks_a = query_chunks(query_vec, user_id=request.user_id,
                            top_k=4, source_filter=request.doc_a)
    chunks_b = query_chunks(query_vec, user_id=request.user_id,
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



@app.get("/debug/chunks")
async def debug_chunks(chat_id: str):
    from services.vector_store import _get_index
    index = _get_index()
    stats = index.describe_index_stats()
    namespaces = {k: v.vector_count for k, v in stats.namespaces.items()}
    return {"namespaces": namespaces}