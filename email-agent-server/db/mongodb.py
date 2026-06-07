from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import ServerSelectionTimeoutError

from config import settings

_client: AsyncIOMotorClient | None = None
_db_connected: bool = False

_ATLAS_HELP = """
[DB] Could not reach MongoDB Atlas. Check:
  1. email-agent-server/.env — MONGODB_URI must be one line with no trailing comments
  2. Atlas → Network Access → Add Current IP Address (or 0.0.0.0/0 for local dev)
  3. Outbound access to *.mongodb.net on port 27017 is allowed on your network
"""


def _configure_dns_resolver() -> None:
    """Use public DNS for Atlas SRV lookups when ISP DNS is flaky (same idea as client/lib/mongo.ts)."""
    if not settings.mongodb_use_public_dns:
        return

    try:
        import dns.resolver

        resolver = dns.resolver.Resolver(configure=False)
        resolver.nameservers = ["8.8.8.8", "8.8.4.4", "1.1.1.1"]
        resolver.timeout = 3
        resolver.lifetime = 6
        dns.resolver.default_resolver = resolver
    except Exception:
        pass


def _client_kwargs() -> dict:
    return {
        "serverSelectionTimeoutMS": 15_000,
        "connectTimeoutMS": 15_000,
        "socketTimeoutMS": 30_000,
        "retryWrites": True,
    }


async def connect_db() -> None:
    global _client, _db_connected

    _configure_dns_resolver()
    _client = AsyncIOMotorClient(settings.mongodb_uri, **_client_kwargs())

    try:
        await _client.admin.command("ping")
        _db_connected = True
        print(f"[DB] Connected to MongoDB — database: {settings.mongodb_db_name}")
    except Exception as exc:
        _client.close()
        _client = None
        _db_connected = False
        print(f"[DB] Connection failed: {exc}")
        print(_ATLAS_HELP.strip())


async def close_db() -> None:
    global _client, _db_connected
    if _client:
        _client.close()
        _client = None
        _db_connected = False
        print("[DB] MongoDB connection closed")


def is_db_connected() -> bool:
    return _db_connected


def get_db() -> AsyncIOMotorDatabase:
    if _client is None:
        raise RuntimeError("Database not connected. Call connect_db() first.")
    return _client[settings.mongodb_db_name]


def get_collection(name: str):
    return get_db()[name]
