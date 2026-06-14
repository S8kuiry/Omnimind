import asyncio

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings

_client: AsyncIOMotorClient | None = None
_db_connected: bool = False

_ATLAS_HELP = """
[DB] Could not reach MongoDB Atlas. Check:
  1. email-agent-server/.env — MONGODB_URI must be one line with no trailing comments
  2. Atlas → Network Access → Add Current IP Address (or 0.0.0.0/0 for local dev)
  3. Outbound access to *.mongodb.net on port 27017 is allowed on your network
"""


def _reset_dns_resolver(use_public_dns: bool) -> None:
    """Configure dnspython resolver — system DNS first, public DNS as fallback."""
    try:
        import dns.resolver

        if use_public_dns:
            resolver = dns.resolver.Resolver(configure=False)
            resolver.nameservers = ["8.8.8.8", "8.8.4.4", "1.1.1.1"]
            resolver.timeout = 5
            resolver.lifetime = 10
            dns.resolver.default_resolver = resolver
        else:
            dns.resolver.default_resolver = dns.resolver.Resolver()
    except Exception:
        pass


def _client_kwargs() -> dict:
    return {
        "serverSelectionTimeoutMS": 15_000,
        "connectTimeoutMS": 15_000,
        "socketTimeoutMS": 30_000,
        "retryWrites": True,
    }


async def ensure_database_indexes() -> None:
    """Guarantee performance indexes exist after a successful connection."""
    global _client, _db_connected
    if not _db_connected or _client is None:
        return

    try:
        db = _client[settings.mongodb_db_name]
        emails_col = db["emails"]

        await emails_col.create_index(
            [("user_email", 1), ("is_trashed", 1), ("date", -1)],
            name="user_active_email_pagination_idx",
        )

        print("[DB] Production performance query indexes verified successfully.")
    except Exception as e:
        print(f"[DB Error] Failed to generate indexing path keys: {e}")


async def _attempt_connect(use_public_dns: bool) -> bool:
    global _client, _db_connected

    _reset_dns_resolver(use_public_dns)
    client = AsyncIOMotorClient(settings.mongodb_uri, **_client_kwargs())

    try:
        await client.admin.command("ping")
        if _client:
            _client.close()
        _client = client
        _db_connected = True
        dns_label = "public" if use_public_dns else "system"
        print(f"[DB] Connected to MongoDB — database: {settings.mongodb_db_name} ({dns_label} DNS)")
        await ensure_database_indexes()
        return True
    except Exception as exc:
        client.close()
        dns_label = "public" if use_public_dns else "system"
        print(f"[DB] Connection attempt failed ({dns_label} DNS): {exc}")
        return False


async def connect_db() -> None:
    global _client, _db_connected

    if _db_connected:
        return

    dns_strategies = (
        [True, False] if settings.mongodb_use_public_dns else [False, True]
    )

    for use_public_dns in dns_strategies:
        for attempt in range(3):
            if await _attempt_connect(use_public_dns):
                return
            if attempt < 2:
                await asyncio.sleep(2**attempt)

    _client = None
    _db_connected = False
    print(_ATLAS_HELP.strip())


async def start_db_reconnect_loop(interval_seconds: int = 30) -> None:
    """Retry MongoDB connection in the background when startup connect fails."""
    while True:
        await asyncio.sleep(interval_seconds)
        if _db_connected:
            continue
        print("[DB] Retrying MongoDB connection...")
        await connect_db()


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
