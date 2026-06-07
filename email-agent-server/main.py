# FastAPI app — email agent server on port 8000

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from db.mongodb import connect_db, close_db, is_db_connected
from routes.auth import router as auth_router
from routes.emails import router as emails_router
from routes.agent import router as agents_router
from routes.cron import router as cron_router
from config import settings
from models.session import ensure_session_indexes
from models.email import ensure_email_indexes
from models.queue import ensure_queue_indexes
from models.event import ensure_event_indexes
from services.consumer import worker_queue_listener

_worker_task: asyncio.Task | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _worker_task
    try:
        await connect_db()
        await ensure_session_indexes()
        await ensure_email_indexes()
        await ensure_queue_indexes()
        await ensure_event_indexes()
        if is_db_connected():
            print("[Startup] MongoDB connected and indexes ensured")
        else:
            print("[Startup] Running without MongoDB — inbox persistence disabled")
    except Exception as exc:
        print(f"[Startup] WARNING: {exc}")

    _worker_task = asyncio.create_task(worker_queue_listener())

    yield

    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    if is_db_connected():
        await close_db()


app = FastAPI(title="Email Agent Server", version="1.0.0", lifespan=lifespan)

_cors_origins = list({
    settings.frontend_url.rstrip("/"),
    "http://localhost:3000",
    "http://127.0.0.1:3000",
})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)

app.include_router(auth_router)
app.include_router(emails_router)
app.include_router(agents_router)
app.include_router(cron_router)


@app.get("/")
async def health():
    return {
        "status": "Email Agent Server is Running",
        "version": "1.0.0",
        "database": "connected" if is_db_connected() else "disconnected",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
