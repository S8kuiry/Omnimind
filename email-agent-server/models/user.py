# OAuth tokens, preferences, linked by email
from db.mongodb import get_collection, is_db_connected
import time

# TEMP: in-memory only while connect_db() is commented in main.py
_memory_users: dict[str, dict] = {}


def get_user_collection():
    """Helper to fetch the MongoDB collection."""
    return get_collection("email_agent_users")


async def find_user(email: str) -> dict | None:
    """Find a user by their email address."""
    if not is_db_connected():
        return _memory_users.get(email)

    collection = get_user_collection()
    user = await collection.find_one({"email": email})
    return user


async def upsert_user(email: str, token_dict: dict, profile: dict) -> dict:
    """
    Insert a new user or update an existing user's OAuth tokens.
    Calculates absolute token expiry times dynamically.
    """
    expires_in = token_dict.get("expires_in", 3600)
    token_expiry = int(time.time()) + expires_in

    update_doc = {
        "email": email,
        "name": profile.get("name"),
        "picture": profile.get("picture"),
        "google_access_token": token_dict.get("access_token"),
        "token_expiry": token_expiry,
        "last_sync": int(time.time())
    }

    if token_dict.get("refresh_token"):
        update_doc["google_refresh_token"] = token_dict.get("refresh_token")
    elif not is_db_connected() and email in _memory_users:
        existing_refresh = _memory_users[email].get("google_refresh_token")
        if existing_refresh:
            update_doc["google_refresh_token"] = existing_refresh

    if not is_db_connected():
        _memory_users[email] = {**_memory_users.get(email, {}), **update_doc}
        return update_doc

    collection = get_user_collection()
    await collection.update_one(
        {"email": email},
        {"$set": update_doc},
        upsert=True
    )

    return update_doc


async def clear_user_tokens(email: str) -> None:
    """Remove OAuth tokens for a user (used on revoke)."""
    if not is_db_connected():
        user = _memory_users.get(email)
        if not user:
            return
        user.pop("google_access_token", None)
        user.pop("google_refresh_token", None)
        user.pop("token_expiry", None)
        return

    collection = get_user_collection()
    await collection.update_one(
        {"email": email},
        {
            "$unset": {
                "google_access_token": "",
                "google_refresh_token": "",
                "token_expiry": "",
            }
        },
    )
