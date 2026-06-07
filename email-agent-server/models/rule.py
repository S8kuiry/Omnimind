# models/rule.py — user automation rules

from db.mongodb import get_collection, is_db_connected

RULE_COLLECTION = "email_agent_rules"


async def list_rules(email: str) -> list[dict]:
    if not is_db_connected():
        return []

    col = get_collection(RULE_COLLECTION)
    cursor = col.find({"email": email})
    return await cursor.to_list(length=100)
