import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.mongodb import connect_db, close_db
from routes.auth import router as auth_router
from routes.emails import router as emails_router
from routes.agent import router as agent_router
from routes.cron import router as cron_router
from routes.webhooks import router as webhooks_router
from models.seen import ensure_indexes as seen_indexes
from models.metrics_daily import ensure_indexes as metrics_indexes
from models.event import ensure_indexes as event_indexes
from services.ingest_scheduler import start_ingest_scheduler
from config import settings

logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Connect to MongoDB
    await connect_db()

    # 2. Ensure all indexes (safe to run every startup — MongoDB is idempotent)
    await seen_indexes()
    await metrics_indexes()
    await event_indexes()
    logger.info("[main] All indexes ensured")

    # 3. Start 15-min ingest scheduler as background daemon
    # Runs immediately on startup, then every ingest_interval_seconds (900s)
    scheduler_task = asyncio.create_task(start_ingest_scheduler())
    logger.info("[main] Ingest scheduler started")

    print("[main] Phase 2 ready")
    yield

    # Shutdown — cancel scheduler cleanly
    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        logger.info("[main] Ingest scheduler stopped")

    await close_db()


app = FastAPI(
    title="Email Agent API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(emails_router)
app.include_router(agent_router)
app.include_router(cron_router)
app.include_router(webhooks_router)


# ── Health ─────────────────────────────────────────────────────────
@app.get("/")
async def health():
    return {
        "status": "Email Agent API running",
        "version": "2.0.0",
        "phase": 2,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)