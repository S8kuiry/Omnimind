# models/session.py

from db.mongodb import get_collection, is_db_connected
from datetime import datetime, timezone, timedelta
import secrets

SESSION_COLLECTION = "EmailSession"
SESSION_DAYS = 3650  # about 10 years

# TEMP: in-memory only while connect_db() is commented in main.py
_memory_sessions: dict[str, dict] = {}


def get_session_collection():
    return get_collection(SESSION_COLLECTION)


async def ensure_session_indexes():
    if not is_db_connected():
        return
    collection = get_session_collection()
    await collection.create_index("sid", unique=True)
    await collection.create_index("expires_at", expireAfterSeconds=0)


async def create_session(email: str) -> str:
    sid = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=SESSION_DAYS)

    if not is_db_connected():
        _memory_sessions[sid] = {
            "sid": sid,
            "email": email,
            "created_at": now,
            "expires_at": expires_at,
        }
        return sid

    await ensure_session_indexes()
    collection = get_session_collection()
    await collection.insert_one({
        "sid": sid,
        "email": email,
        "created_at": now,
        "expires_at": expires_at,
    })
    return sid


async def get_session(sid: str) -> dict | None:
    if not sid:
        return None

    if not is_db_connected():
        session = _memory_sessions.get(sid)
        if not session:
            return None
        if session["expires_at"] <= datetime.now(timezone.utc):
            _memory_sessions.pop(sid, None)
            return None
        return session

    collection = get_session_collection()
    session = await collection.find_one({
        "sid": sid,
        "expires_at": {"$gt": datetime.now(timezone.utc)}
    })
    return session


async def delete_session(sid: str):
    if not sid:
        return

    if not is_db_connected():
        _memory_sessions.pop(sid, None)
        return

    collection = get_session_collection()
    await collection.delete_one({"sid": sid})


async def delete_sessions_for_email(email: str):
    if not is_db_connected():
        for sid, session in list(_memory_sessions.items()):
            if session.get("email") == email:
                _memory_sessions.pop(sid, None)
        return

    collection = get_session_collection()
    await collection.delete_many({"email": email})
