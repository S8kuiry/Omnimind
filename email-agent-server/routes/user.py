# GET  /user/preferences
 # PUT  /user/preferences        (digest time, auto-reply toggle)
 from datetime import datetime
from db.mongodb import get_collection


COLLECTION = "email_agent_users"


async def find_user(email: str) -> dict | None:
    col = get_collection(COLLECTION)
    return await col.find_one({"email": email})


async def upsert_user(email: str, token_dict: dict, profile: dict) -> dict:
    col = get_collection(COLLECTION)
    now = datetime.utcnow()
    doc = {
        "email": email,
        "name": profile.get("name", ""),
        "picture": profile.get("picture", ""),
        "google_access_token": token_dict["access_token"],
        "google_refresh_token": token_dict.get("refresh_token"),
        "token_expiry": token_dict.get("expiry"),
        "token_scopes": token_dict.get("scopes", []),
        "last_sync": None,
        "updated_at": now,
    }
    await col.update_one(
        {"email": email},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return await find_user(email)


async def update_tokens(email: str, token_dict: dict):
    col = get_collection(COLLECTION)
    await col.update_one(
        {"email": email},
        {"$set": {
            "google_access_token": token_dict["access_token"],
            "google_refresh_token": token_dict.get("refresh_token"),
            "token_expiry": token_dict.get("expiry"),
            "updated_at": datetime.utcnow(),
        }}
    )


async def update_last_sync(email: str):
    col = get_collection(COLLECTION)
    await col.update_one(
        {"email": email},
        {"$set": {"last_sync": datetime.utcnow()}}
    )