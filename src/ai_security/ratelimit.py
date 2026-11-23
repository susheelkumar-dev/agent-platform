"""Token-bucket rate limiting per principal.

The in-memory limiter is per-replica. Behind a load balancer with N replicas
the effective limit is roughly N× the configured value; for strict global
limits implement ``RateLimiter`` on Redis (INCR + EXPIRE or a Lua bucket).
"""

from __future__ import annotations

import time
from typing import Protocol

from ai_core.errors import RateLimitError


class RateLimiter(Protocol):
    async def hit(self, key: str) -> None: ...


class InMemoryRateLimiter:
    def __init__(self, per_minute: int, burst: int) -> None:
        self.rate = per_minute / 60.0
        self.capacity = max(1, burst)
        self.enabled = per_minute > 0
        self._buckets: dict[str, tuple[float, float]] = {}

    async def hit(self, key: str) -> None:
        if not self.enabled:
            return
        now = time.monotonic()
        tokens, last = self._buckets.get(key, (float(self.capacity), now))
        tokens = min(self.capacity, tokens + (now - last) * self.rate)
        if tokens < 1:
            retry_after = (1 - tokens) / self.rate if self.rate else 60
            raise RateLimitError(
                "Rate limit exceeded", details={"retry_after_seconds": round(retry_after, 2), "key": key}
            )
        self._buckets[key] = (tokens - 1, now)
        if len(self._buckets) > 100_000:  # bound memory
            self._buckets.clear()
