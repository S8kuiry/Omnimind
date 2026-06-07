"""Agent metrics / audit events — powers /agents/stats dashboards."""

from db.mongodb import get_collection, is_db_connected

EVENT_COLLECTION = "email_agent_events"


class _NoDbEventCollection:
    async def count_documents(self, *args, **kwargs) -> int:
        return 0

    async def insert_one(self, *args, **kwargs):
        return None

    def aggregate(self, pipeline):
        return _NoDbAggregateCursor()


class _NoDbAggregateCursor:
    async def to_list(self, length: int | None = None) -> list:
        return []


async def ensure_event_indexes() -> None:
    if not is_db_connected():
        return
    col = get_event_collection()
    await col.create_index([("email", 1), ("action", 1), ("ts", -1)])
    await col.create_index([("email", 1), ("thread_id", 1)])


def get_event_collection():
    if not is_db_connected():
        return _NoDbEventCollection()
    return get_collection(EVENT_COLLECTION)
