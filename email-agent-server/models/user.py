import logging
import time
from typing import List, Optional

from db.mongodb import get_db, get_collection, is_db_connected

logger = logging.getLogger("models_user")

COLLECTION = "email_agent_users"
_memory_users: dict[str, dict] = {}

DEFAULT_CLEANUP_SETTINGS = {"enabled": True, "older_than_days": 60}



def get_user_collection():
    return get_collection(COLLECTION)


async def find_user_by_email(email: str) -> Optional[dict]:
    if not is_db_connected():
        return _memory_users.get(email)
    return await get_user_collection().find_one({"email": email})


async def find_user(email: str) -> Optional[dict]:
    return await find_user_by_email(email)


async def list_users_with_gmail_tokens() -> List[dict]:
    if not is_db_connected():
        return [u for u in _memory_users.values() if _has_tokens(u)]
    cursor = get_user_collection().find({
        "$or": [
            {"oauth_token.refresh_token": {"$exists": True}},
            {"google_refresh_token": {"$exists": True}},
        ]
    })
    return await cursor.to_list(length=1000)


def _has_tokens(user: dict) -> bool:
    oauth = user.get("oauth_token", {})
    return bool(oauth.get("refresh_token") or user.get("google_refresh_token"))


async def upsert_user(email: str, token_dict: dict, profile: dict) -> dict:
    expires_in = token_dict.get("expires_in", 3600)
    expires_at = time.time() + expires_in

    doc = {
        "email": email,
        "name": profile.get("name"),
        "picture": profile.get("picture"),
        "oauth_token": {
            "access_token": token_dict.get("access_token"),
            "refresh_token": token_dict.get("refresh_token"),
            "expires_at": expires_at,
        },
        "google_access_token": token_dict.get("access_token"),
        "google_refresh_token": token_dict.get("refresh_token"),
        "token_expiry": expires_at,
        "last_sync": int(time.time()),
    }

    if not is_db_connected():
        _memory_users[email] = {**_memory_users.get(email, {}), **doc}
        return doc

    await get_user_collection().update_one({"email": email}, {"$set": doc}, upsert=True)
    return await find_user_by_email(email) or doc


async def clear_user_tokens(email: str) -> None:
    unset = {
        "oauth_token": "",
        "google_access_token": "",
        "google_refresh_token": "",
        "token_expiry": "",
        "gmail_label_attention_id": "",
        "gmail_label_processed_id": "",
        "gmail_history_id": "",
    }
    if not is_db_connected():
        user = _memory_users.get(email)
        if user:
            for key in list(unset):
                user.pop(key, None)
        return
    await get_user_collection().update_one({"email": email}, {"$unset": unset})


async def save_gmail_label_ids(email: str, attention_id: str, processed_id: str) -> bool:
    if not is_db_connected():
        if email in _memory_users:
            _memory_users[email]["gmail_label_attention_id"] = attention_id
            _memory_users[email]["gmail_label_processed_id"] = processed_id
            return True
        return False
    result = await get_user_collection().update_one(
        {"email": email},
        {"$set": {
            "gmail_label_attention_id": attention_id,
            "gmail_label_processed_id": processed_id,
        }},
    )
    return result.modified_count > 0 or result.matched_count > 0


async def update_gmail_history_id(email: str, history_id: str) -> bool:
    if not is_db_connected():
        if email in _memory_users:
            _memory_users[email]["gmail_history_id"] = history_id
            return True
        return False
    result = await get_user_collection().update_one(
        {"email": email},
        {"$set": {"gmail_history_id": history_id}},
    )
    return result.modified_count > 0


# auto cleanup settings
def get_cleanup_settings(user: dict) -> dict:
    settings = user.get("cleanup_settings") or {}
    return {
        "enabled": settings.get("enabled", DEFAULT_CLEANUP_SETTINGS["enabled"]),
        "older_than_days": settings.get("older_than_days", DEFAULT_CLEANUP_SETTINGS["older_than_days"]),
    }


async def update_cleanup_settings(
    email: str,
    enabled: bool | None = None,
    older_than_days: int | None = None,
) -> bool:
    update_fields: dict = {}
    if enabled is not None:
        update_fields["cleanup_settings.enabled"] = enabled
    if older_than_days is not None:
        if not (7 <= older_than_days <= 365):
            raise ValueError("older_than_days must be between 7 and 365")
        update_fields["cleanup_settings.older_than_days"] = older_than_days

    if not update_fields:
        return False

    if not is_db_connected():
        user = _memory_users.get(email)
        if not user:
            return False
        cleanup = user.setdefault("cleanup_settings", {})
        if enabled is not None:
            cleanup["enabled"] = enabled
        if older_than_days is not None:
            cleanup["older_than_days"] = older_than_days
        return True

    result = await get_user_collection().update_one(
        {"email": email},
        {"$set": update_fields},
        upsert=False,
    )
    return result.matched_count > 0


async def update_gmail_watch_state(
    email: str,
    *,
    history_id: str | None = None,
    expiry_ms: int | None = None,
) -> bool:
    """Persist Gmail Push watch metadata on the user document."""
    fields: dict = {}
    if history_id is not None:
        fields["gmail_history_id"] = history_id
    if expiry_ms is not None:
        fields["gmail_watch_expiry_ms"] = expiry_ms
    if not fields:
        return False

    from datetime import datetime, timezone
    fields["gmail_watch_registered_at"] = datetime.now(timezone.utc)

    if not is_db_connected():
        user = _memory_users.get(email)
        if not user:
            return False
        user.update(fields)
        return True

    result = await get_user_collection().update_one(
        {"email": email},
        {"$set": fields},
    )
    return result.modified_count > 0 or result.matched_count > 0
