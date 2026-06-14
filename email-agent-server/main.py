import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.mongodb import connect_db, close_db, is_db_connected
from models.event import ensure_indexes as event_indexes
from models.metrics_daily import ensure_indexes as metrics_indexes
from models.seen import ensure_indexes as seen_indexes
from routes.agent import router as agent_router
from routes.auth import router as auth_router
from routes.cron import router as cron_router
from routes.emails import router as emails_router
from routes.webhooks import router as webhooks_router
from services.cleanup_engine import start_cleanup_engine
from services.db_retention import start_db_retention_engine
from services.ingest_scheduler import start_ingest_scheduler

logger = logging.getLogger("main")


def _log_startup_config() -> None:
    logger.info(f"[main] Frontend URL: {settings.frontend_url}")
    logger.info(f"[main] Google redirect: {settings.google_redirect_uri}")

    if settings.gmail_push_enabled and settings.gmail_pubsub_topic:
        logger.info(
            f"[main] Gmail Pub/Sub enabled — topic: {settings.gmail_pubsub_topic}"
        )
    elif settings.gmail_push_enabled:
        logger.warning(
            "[main] GMAIL_PUBSUB_TOPIC not set — Gmail push watch will be skipped"
        )
    else:
        logger.info("[main] Gmail push disabled (GMAIL_PUSH_ENABLED=false)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    _log_startup_config()

    await seen_indexes()
    await metrics_indexes()
    await event_indexes()
    logger.info("[main] All indexes ensured")

    scheduler_task = asyncio.create_task(start_ingest_scheduler())
    logger.info("[main] Ingest scheduler started")

    cleanup_task = asyncio.create_task(start_cleanup_engine())
    logger.info("[main] Cleanup engine started")

    retention_task = asyncio.create_task(start_db_retention_engine())
    logger.info("[main] DB retention engine started")

    print("[main] Phase 2 ready")
    yield

    scheduler_task.cancel()
    cleanup_task.cancel()
    retention_task.cancel()

    for task in (scheduler_task, cleanup_task, retention_task):
        try:
            await task
        except asyncio.CancelledError:
            pass

    logger.info("[main] Background engines stopped")
    await close_db()


app = FastAPI(
    title="Email Agent API",
    version="2.0.0",
    lifespan=lifespan,
)


def _cors_origins() -> list[str]:
    origins = {settings.frontend_url, "http://localhost:3000"}
    extra = getattr(settings, "cors_extra_origins", "") or ""
    for origin in extra.split(","):
        origin = origin.strip()
        if origin:
            origins.add(origin)
    return list(origins)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(emails_router)
app.include_router(agent_router)
app.include_router(cron_router)
app.include_router(webhooks_router)


@app.get("/")
async def health():
    return {
        "status": "Email Agent API running",
        "version": "2.0.0",
        "phase": 2,
        "database": "connected" if is_db_connected() else "disconnected",
        "gmail_push": {
            "enabled": settings.gmail_push_enabled,
            "topic_configured": bool((settings.gmail_pubsub_topic or "").strip()),
            "topic": settings.gmail_pubsub_topic or None,
            "webhook": "POST /webhooks/gmail",
        },
        "frontend_url": settings.frontend_url,
        "google_redirect_uri": settings.google_redirect_uri,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.port, reload=True)
