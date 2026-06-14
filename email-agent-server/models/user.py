import logging
import time
from typing import List, Optional

from db.mongodb import get_db, get_collection, is_db_connected

logger = logging.getLogger("models_user")

COLLECTION = "email_agent_users"
_memory_users: dict[str, dict] = {}


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
