import time
from collections import defaultdict
from threading import Lock


class SessionStatsManager:
    def __init__(self) -> None:
        self._auto_reply_timestamps: dict[str, list[float]] = defaultdict(list)
        self._auto_replies_total: dict[str, int] = defaultdict(int)
        self._dropped_total: dict[str, int] = defaultdict(int)
        self._attention_total: dict[str, int] = defaultdict(int)
        self._lock = Lock()

    def _clean_expired_timestamps(self, user_email: str, now: float) -> None:
        one_hour_ago = now - 3600
        self._auto_reply_timestamps[user_email] = [
            t for t in self._auto_reply_timestamps[user_email] if t > one_hour_ago
        ]

    def can_auto_reply(self, user_email: str) -> bool:
        return True

    def record_auto_reply(self, user_email: str) -> None:
        with self._lock:
            now = time.time()
            self._auto_reply_timestamps[user_email].append(now)
            self._auto_replies_total[user_email] += 1

    def record_dropped(self, user_email: str) -> None:
        with self._lock:
            self._dropped_total[user_email] += 1

    def record_attention(self, user_email: str) -> None:
        with self._lock:
            self._attention_total[user_email] += 1

    def get_stats(self, user_email: str, attention_count: int) -> dict:
        with self._lock:
            now = time.time()
            self._clean_expired_timestamps(user_email, now)
            return {
                "current_active_buffer_cards": attention_count,
                "auto_replies_total": self._auto_replies_total[user_email],
                "system_dropped_total": self._dropped_total[user_email],
                "manual_attention_historical_total": self._attention_total[user_email],
                "auto_replies_sent_this_hour": len(self._auto_reply_timestamps[user_email]),
                "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }


session_stats = SessionStatsManager()
