# email-agent-server/services/attention_cache.py
import time
from typing import Dict, Any, List, Optional
from threading import Lock
from config import settings

class AttentionCache:
    def __init__(self):
        # List Cache Structure: { user_id: {"expires_at": float, "data": List[dict]} }
        self._list_cache: Dict[str, Dict[str, Any]] = {}
        # Analysis Cache Structure: { message_id: {"expires_at": float, "data": dict} }
        self._analyze_cache: Dict[str, Dict[str, Any]] = {}
        # Detail view cache — full HTML body, lazy-loaded on open
        self._detail_cache: Dict[str, Dict[str, Any]] = {}
        # Thread-safe primitive
        self._lock = Lock()

    # ─── LIST CACHE OPERATIONAL CONTROLS ──────────────────────────────

    def get_emails(self, user_id: str) -> Optional[List[dict]]:
        """Returns the cached list of Attention emails if the entry exists and hasn't expired."""
        with self._lock:
            entry = self._list_cache.get(user_id)
            if entry and entry["expires_at"] > time.time():
                return entry["data"]
            return None

    def get_emails_even_expired(self, user_id: str) -> Optional[List[dict]]:
        """Resilient Fallback: Returns historical snapshots regardless of expiration if Gmail is down."""
        with self._lock:
            entry = self._list_cache.get(user_id)
            return entry["data"] if entry else None

    def set_emails(self, user_id: str, data: List[dict]):
        """Caches the user's Attention list with a standard 5-minute TTL."""
        with self._lock:
            self._list_cache[user_id] = {
                "expires_at": time.time() + settings.attention_cache_ttl_seconds,
                "data": data
            }

    # ─── LAZY ANALYSIS CACHE OPERATIONAL CONTROLS ─────────────────────

    def get_analysis(self, message_id: str) -> Optional[dict]:
        """Fetches heavy structural LLM summary artifacts from cache memory."""
        with self._lock:
            entry = self._analyze_cache.get(message_id)
            if entry and entry["expires_at"] > time.time():
                return entry["data"]
            return None

    def set_analysis(self, message_id: str, data: dict):
        """Caches deep summaries for 1 hour to prevent redundant LLM token expenditures."""
        with self._lock:
            self._analyze_cache[message_id] = {
                "expires_at": time.time() + settings.analyze_cache_ttl_seconds,
                "data": data
            }

    # ─── DETAIL VIEW CACHE (lazy HTML + images) ───────────────────────

    def get_detail(self, message_id: str) -> Optional[dict]:
        with self._lock:
            entry = self._detail_cache.get(message_id)
            if entry and entry["expires_at"] > time.time():
                return entry["data"]
            return None

    def set_detail(self, message_id: str, data: dict):
        with self._lock:
            self._detail_cache[message_id] = {
                "expires_at": time.time() + settings.analyze_cache_ttl_seconds,
                "data": data,
            }

    # ─── STATE MUTATION CLEANUP CONTROLS ──────────────────────────────

    def invalidate_list(self, user_id: str):
        """Drop cached attention list so the next fetch pulls fresh Gmail data."""
        with self._lock:
            self._list_cache.pop(user_id, None)

    def invalidate_email(self, user_id: str, message_id: str):
        """
        Cleanses cache entries immediately following an explicit mutative user action 
        (like dismissing an email or sending a reply) to keep the UI perfectly synchronized.
        """
        with self._lock:
            # 1. Update list cache structure dynamically
            if user_id in self._list_cache:
                self._list_cache[user_id]["data"] = [
                    msg for msg in self._list_cache[user_id]["data"] if msg.get("id") != message_id
                ]
            # 2. Hard purge analysis details block
            if message_id in self._analyze_cache:
                del self._analyze_cache[message_id]
            self._detail_cache.pop(message_id, None)

attention_cache = AttentionCache()