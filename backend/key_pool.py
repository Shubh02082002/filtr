import time
import itertools
from threading import Lock

class NoAvailableKeyError(Exception):
    pass

class KeyPoolManager:
    def __init__(self):
        self._pools = {}
        self._locks = {}

    def register(self, provider: str, keys: list[str]):
        self._pools[provider] = [
            {"key": k, "cooldown_until": 0, "call_count": 0}
            for k in keys
        ]
        self._locks[provider] = Lock()

    def get_key(self, provider: str) -> str:
        with self._locks[provider]:
            now = time.time()
            available = [k for k in self._pools[provider] if now >= k["cooldown_until"]]
            if not available:
                raise NoAvailableKeyError(f"All {provider} keys are cooling down. Try in 60s.")
            # Pick least recently used (lowest call_count among available)
            chosen = min(available, key=lambda k: k["call_count"])
            chosen["call_count"] += 1
            return chosen["key"]

    def mark_429(self, provider: str, key: str):
        with self._locks[provider]:
            for k in self._pools[provider]:
                if k["key"] == key:
                    k["cooldown_until"] = time.time() + 65
                    break

    def status(self, provider: str) -> list:
        now = time.time()
        return [
            {
                "key_prefix": k["key"][:8],
                "available": now >= k["cooldown_until"],
                "call_count": k["call_count"]
            }
            for k in self._pools[provider]
        ]

# Singleton — initialised in main.py
key_pool = KeyPoolManager()