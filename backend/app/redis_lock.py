"""Distributed lock backed by Redis, safe to use across multiple worker
processes (unlike a per-process asyncio.Lock — see CLAUDE.md's rule against
in-process state substituting for Redis state).

Acquire: SET key token NX PX ttl_ms — atomic, standard Redis idiom.
Release: WATCH key / GET / (if value == our token) MULTI DEL EXEC — a
compare-and-delete done via WATCH/MULTI instead of the more common Lua
EVAL script, because this project's fakeredis test double doesn't support
Lua scripting. If the value no longer matches our token (the lock already
expired and was re-acquired by someone else), release() safely no-ops
rather than deleting a lock we no longer own.

The `timeout_seconds` TTL is the real safety net against a crashed holder:
even if release() is never called, the key expires on its own, so acquire()
can safely block indefinitely (bounded by the TTL in the worst case) rather
than needing its own timeout to avoid a permanent deadlock.
"""

import asyncio
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

_POLL_INTERVAL_SECONDS = 0.05


class RedisLockError(Exception):
    """Raised when a lock can't be acquired within blocking_timeout_seconds."""


class RedisLock:
    def __init__(
        self,
        redis_client: Any,
        name: str,
        *,
        timeout_seconds: float,
        blocking_timeout_seconds: float | None = None,
    ) -> None:
        self._redis = redis_client
        self._name = name
        self._timeout_ms = int(timeout_seconds * 1000)
        self._blocking_timeout_seconds = blocking_timeout_seconds
        self._token: str | None = None

    async def acquire(self) -> None:
        token = uuid.uuid4().hex
        loop = asyncio.get_event_loop()
        deadline = (
            loop.time() + self._blocking_timeout_seconds
            if self._blocking_timeout_seconds is not None
            else None
        )
        while True:
            acquired = await self._redis.set(
                self._name, token, nx=True, px=self._timeout_ms
            )
            if acquired:
                self._token = token
                return
            if deadline is not None and loop.time() >= deadline:
                raise RedisLockError(
                    f"Timed out acquiring lock {self._name!r} after "
                    f"{self._blocking_timeout_seconds}s"
                )
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)

    async def release(self) -> None:
        if self._token is None:
            return
        token, self._token = self._token, None
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                await pipe.watch(self._name)
                current = await pipe.get(self._name)
                if current != token:
                    return  # already expired/reacquired by someone else
                pipe.multi()
                pipe.delete(self._name)
                await pipe.execute()
        except Exception:
            logger.exception("Failed to release Redis lock %r", self._name)

    async def __aenter__(self) -> "RedisLock":
        await self.acquire()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.release()
