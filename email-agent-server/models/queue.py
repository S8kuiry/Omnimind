"""Staging queue for Gmail ingest before LLM triage."""

from db.mongodb import get_collection, is_db_connected

QUEUE_COLLECTION = "email_agent_queue"


def get_queue_collection():
    return get_collection(QUEUE_COLLECTION)


async def ensure_queue_indexes() -> None:
    if not is_db_connected():
        return
    col = get_queue_collection()
    await col.create_index([("user_email", 1), ("status", 1)])
    await col.create_index(
        [("user_email", 1), ("gmail_message_id", 1)],
        unique=True,
        name="queue_user_msg_unique",
    )
