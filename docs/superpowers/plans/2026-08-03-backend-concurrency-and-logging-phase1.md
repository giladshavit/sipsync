# Backend Concurrency & Logging (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three CRITICAL backend findings from `docs/superpowers/specs/2026-08-03-council-audit-report.md` — a room-mutation lock that doesn't survive multiple Uvicorn workers, a non-atomic deck rebuild, and a pub/sub forwarder that dies silently with zero backend logging anywhere.

**Architecture:** Replace the process-local `asyncio.Lock` cache in `RoomService` with a small Redis-backed distributed lock (`SET NX PX` acquire, `WATCH`/`MULTI` compare-and-delete release — no Lua/EVAL, since the project's `fakeredis` test double doesn't support scripting). Wrap `deck.initialize`'s delete+rpush+rpush in a single `MULTI`/`EXEC` pipeline. Stand up real `logging` module usage backend-wide via one `configure_logging()` call from `main.py`, and turn the pub/sub listener's bare `except Exception: break` into a logged one.

**Tech Stack:** Python 3.12, FastAPI, `redis.asyncio` (redis-py 8.x), `fakeredis` (test double), `pytest` / `pytest-asyncio`.

## Global Constraints

- Backend package management is `uv` only — no new dependency is needed for this plan (redis-py 8.x's `Redis.set(..., nx=True, px=...)` and pipeline/`WATCH` support are already available; no Lua/EVAL, so no `fakeredis[lua]`/`lupa` extra required).
- Do not modify `backend/app/engine/fsm.py` or `backend/app/engine/base.py` at all.
- Do not modify any per-mini-game file under `backend/app/games/`.
- Do not change game state machine (FSM) transition logic or timing/behavior of any mini-game.
- No frontend changes.
- Every existing backend test must still pass; tests that reference the removed `_room_locks` dict attribute must be updated (mechanical only — they exist purely to reset per-test lock state, which a Redis-backed lock no longer needs since each test already gets a fresh `fakeredis` instance).

---

## File Structure

- **Create** `backend/app/redis_lock.py` — the distributed lock primitive. Lives next to `backend/app/redis_client.py` (general Redis infrastructure, not game-engine-specific), so it's reusable outside `RoomService` too.
- **Create** `backend/tests/test_redis_lock.py` — correctness tests for the lock itself (mutual exclusion under real concurrency, safe release, blocking-timeout).
- **Create** `backend/app/logging_config.py` — one `configure_logging()` function, called once from `main.py`.
- **Modify** `backend/app/main.py` — call `configure_logging()` at startup.
- **Modify** `backend/app/engine/room_service.py` — swap `_room_lock` to the new `RedisLock`; wrap `_sync_eligible_games` in it too (closes the audit's CRITICAL #2 TOCTOU on top of the deck-level pipeline fix); add a module logger; turn the pub/sub listener's silent `except Exception: break` into a logged one, and its two adjacent `except Exception: pass` swallows into debug-level logs.
- **Modify** `backend/app/engine/deck.py` — make `initialize`'s delete+rpush+rpush one atomic pipeline.
- **Modify** `backend/tests/test_deck.py` — add an atomicity regression test for `initialize`.
- **Modify** 8 existing test files that monkeypatch the now-removed `_room_locks` attribute: `test_min_players_sync.py`, `test_late_join.py`, `test_custom_question.py`, `test_room_gc.py`, `test_disconnect_admin_migration.py`, `test_total_chasers.py`, `test_avatar.py`, `test_ws_game.py` — delete the one `monkeypatch.setattr(_svc, "_room_locks", {})` line in each.
- **Create** `backend/tests/test_pubsub_listener_logging.py` — regression test that an unexpected exception in the pub/sub loop is logged (not silently swallowed) and that the room can resubscribe afterward.

## Out of Scope (flagging, not fixing, in this phase)

- `handle_set_games`'s own separate (and also non-atomic) `delete`/`rpush` pair for `room:{code}:admin_game_ids` (room_service.py:721-722) has a milder version of the same race, but it's admin-only and not concurrently triggered the way join/leave syncs are — left alone per the Phase 1 scope the user specified (deck.initialize only).
- The rest of the audit's WARNING/NITPICK findings (frontend, other silent failures, score double-counting on timeout races) — separate phases.

---

### Task 1: Redis-backed distributed lock primitive

**Files:**
- Create: `backend/app/redis_lock.py`
- Test: `backend/tests/test_redis_lock.py`

**Interfaces:**
- Produces: `RedisLock(redis_client, name, *, timeout_seconds, blocking_timeout_seconds=None)` — an async context manager (`async with lock:`). `RedisLockError` raised only if `blocking_timeout_seconds` is set and exceeded.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_redis_lock.py
import asyncio

import fakeredis
import pytest

from app.redis_lock import RedisLock, RedisLockError


@pytest.fixture
def fake_redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.mark.asyncio
async def test_two_concurrent_holders_never_overlap(fake_redis):
    in_critical_section = 0
    max_observed_overlap = 0
    completed = 0

    async def worker():
        nonlocal in_critical_section, max_observed_overlap, completed
        async with RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5):
            in_critical_section += 1
            max_observed_overlap = max(max_observed_overlap, in_critical_section)
            await asyncio.sleep(0.05)
            in_critical_section -= 1
            completed += 1

    await asyncio.gather(*(worker() for _ in range(5)))

    assert max_observed_overlap == 1
    assert completed == 5


@pytest.mark.asyncio
async def test_lock_is_released_after_use(fake_redis):
    async with RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5):
        pass

    assert await fake_redis.get("lock:room:TEST") is None


@pytest.mark.asyncio
async def test_release_does_not_delete_a_lock_it_no_longer_owns(fake_redis):
    lock = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await lock.acquire()

    # Simulate the lock's TTL expiring and someone else acquiring it before
    # our (delayed) release() call runs.
    await fake_redis.set("lock:room:TEST", "someone-elses-token")

    await lock.release()

    assert await fake_redis.get("lock:room:TEST") == "someone-elses-token"


@pytest.mark.asyncio
async def test_release_is_a_no_op_if_never_acquired(fake_redis):
    lock = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await lock.release()  # must not raise


@pytest.mark.asyncio
async def test_blocking_timeout_raises_instead_of_hanging_forever(fake_redis):
    holder = RedisLock(fake_redis, "lock:room:TEST", timeout_seconds=5)
    await holder.acquire()

    contender = RedisLock(
        fake_redis, "lock:room:TEST", timeout_seconds=5, blocking_timeout_seconds=0.2
    )
    with pytest.raises(RedisLockError):
        await contender.acquire()

    await holder.release()


@pytest.mark.asyncio
async def test_a_crashed_holders_lock_expires_and_becomes_acquirable(fake_redis):
    # timeout_seconds is the lock's own Redis TTL, not a Python-side timer —
    # simulate a crashed holder by setting the key with a near-zero TTL
    # directly instead of waiting out a real timeout in the test.
    await fake_redis.set("lock:room:TEST", "dead-holders-token", px=10)
    await asyncio.sleep(0.05)

    contender = RedisLock(
        fake_redis, "lock:room:TEST", timeout_seconds=5, blocking_timeout_seconds=1
    )
    async with contender:
        assert await fake_redis.get("lock:room:TEST") is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_redis_lock.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.redis_lock'`

- [ ] **Step 3: Write the implementation**

```python
# backend/app/redis_lock.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_redis_lock.py -v`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/redis_lock.py backend/tests/test_redis_lock.py
git commit -m "feat: add Redis-backed distributed lock primitive"
```

---

### Task 2: Swap RoomService's process-local lock for the Redis-backed one

**Files:**
- Modify: `backend/app/engine/room_service.py:1-19` (imports), `:127-136` (`__init__`/`_room_lock`), `:498-526` (`_sync_eligible_games`)
- Modify: `backend/tests/test_min_players_sync.py`, `test_late_join.py`, `test_custom_question.py`, `test_room_gc.py`, `test_disconnect_admin_migration.py`, `test_total_chasers.py`, `test_avatar.py`, `test_ws_game.py`

**Interfaces:**
- Consumes: `RedisLock` from Task 1 (`app/redis_lock.py`).
- Produces: `RoomService._room_lock(code: str) -> RedisLock` (same call signature and `async with` usage as before — every existing call site in `room_service.py` is unchanged).

- [ ] **Step 1: Update imports and remove the per-process lock cache**

In `backend/app/engine/room_service.py`, change the top of the file:

```python
import asyncio
import json
import random
import time

import redis.exceptions as redis_exceptions
from fastapi import WebSocket

from app.engine import bot_engine, fsm
from app.engine.deck import deck
from app.engine.eligibility import count_active_players, resolve_effective_games
from app.engine.fsm import RoomState
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.models.room import normalize_game_ids
from app.redis_client import redis
```

to:

```python
import asyncio
import json
import logging
import random
import time

import redis.exceptions as redis_exceptions
from fastapi import WebSocket

from app.engine import bot_engine, fsm
from app.engine.deck import deck
from app.engine.eligibility import count_active_players, resolve_effective_games
from app.engine.fsm import RoomState
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.models.room import normalize_game_ids
from app.redis_client import redis
from app.redis_lock import RedisLock

logger = logging.getLogger(__name__)
```

- [ ] **Step 2: Replace `__init__`/`_room_lock` with the Redis-backed version**

Find (room_service.py:127-136):

```python
class RoomService:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}
        self._subscriptions: set[str] = set()
        self._room_locks: dict[str, asyncio.Lock] = {}

    def _room_lock(self, code: str) -> asyncio.Lock:
        if code not in self._room_locks:
            self._room_locks[code] = asyncio.Lock()
        return self._room_locks[code]
```

Replace with:

```python
# How long a room's Redis-backed mutation lock is allowed to be held before
# it auto-expires — the safety net against a crashed holder under multiple
# Uvicorn workers (see app/redis_lock.py). Every critical section this lock
# guards is a handful of Redis calls with no external I/O, so this is a
# generous ceiling, not a realistic duration.
_ROOM_LOCK_TIMEOUT_SECONDS = 10.0


class RoomService:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}
        self._subscriptions: set[str] = set()

    def _room_lock(self, code: str) -> RedisLock:
        """Cross-worker room mutation lock (see CLAUDE.md: 'Do not use
        in-process Python dicts as a substitute for Redis state — it will
        break under multiple Uvicorn workers.'). A fresh RedisLock is
        constructed per acquisition — its actual state lives in Redis, not
        in this object, so there's nothing to cache per room code the way
        the old per-process asyncio.Lock needed to be."""
        return RedisLock(redis, f"lock:room:{code}", timeout_seconds=_ROOM_LOCK_TIMEOUT_SECONDS)
```

- [ ] **Step 3: Close the audit's CRITICAL #2 TOCTOU by locking `_sync_eligible_games`**

Find (room_service.py:498-526):

```python
    async def _sync_eligible_games(self, code: str, active_player_count: int) -> None:
        """Keeps the room's *effective* game_ids (the deck.py list actually
        used to shuffle/pop rounds, and what every client's GamesSheet reads
        as "selected") in step with the admin's real intent as the room's
        active headcount changes.

        The admin's actual choice is tracked separately in
        room:{code}:admin_game_ids, untouched by this method — that's what
        lets a game pruned out here because the room shrank come back on its
        own once enough players return, instead of the admin having to
        reselect it by hand. Triggered from handle_handshake (a join can
        grow the room back past a floor) and _finalize_departure (a
        permanent leave/grace-period expiry can shrink it below one).
        handle_set_games writes admin_game_ids itself and recomputes the
        effective list inline rather than calling this, since an explicit
        admin edit should always reshuffle/broadcast even when the effective
        set happens not to change — see that method."""
        admin_ids = await redis.lrange(f"room:{code}:admin_game_ids", 0, -1)
        if not admin_ids:
            return  # room hasn't had its games set yet

        current_ids = await deck.get_game_ids(code)
        new_ids = resolve_effective_games(admin_ids, active_player_count, fallback=admin_ids)

        if new_ids == current_ids:
            return  # no actual change — don't reshuffle the deck or broadcast for nothing

        await deck.initialize(code, new_ids)
        await self.broadcast(code, {"type": "GAME_IDS_UPDATED", "game_ids": new_ids})
```

Replace with (same docstring, body wrapped in the room lock, broadcast moved after release to match this file's existing lock-then-broadcast pattern elsewhere):

```python
    async def _sync_eligible_games(self, code: str, active_player_count: int) -> None:
        """Keeps the room's *effective* game_ids (the deck.py list actually
        used to shuffle/pop rounds, and what every client's GamesSheet reads
        as "selected") in step with the admin's real intent as the room's
        active headcount changes.

        The admin's actual choice is tracked separately in
        room:{code}:admin_game_ids, untouched by this method — that's what
        lets a game pruned out here because the room shrank come back on its
        own once enough players return, instead of the admin having to
        reselect it by hand. Triggered from handle_handshake (a join can
        grow the room back past a floor) and _finalize_departure (a
        permanent leave/grace-period expiry can shrink it below one).
        handle_set_games writes admin_game_ids itself and recomputes the
        effective list inline rather than calling this, since an explicit
        admin edit should always reshuffle/broadcast even when the effective
        set happens not to change — see that method.

        Runs under the room lock: two joins landing in the same instant
        (possibly on different workers) must not both read the same stale
        current_ids and each call deck.initialize with a different
        new_ids — the second write would silently discard the first."""
        new_ids: list[str] | None = None
        async with self._room_lock(code):
            admin_ids = await redis.lrange(f"room:{code}:admin_game_ids", 0, -1)
            if not admin_ids:
                return  # room hasn't had its games set yet

            current_ids = await deck.get_game_ids(code)
            new_ids = resolve_effective_games(admin_ids, active_player_count, fallback=admin_ids)

            if new_ids == current_ids:
                return  # no actual change — don't reshuffle the deck or broadcast for nothing

            await deck.initialize(code, new_ids)

        await self.broadcast(code, {"type": "GAME_IDS_UPDATED", "game_ids": new_ids})
```

- [ ] **Step 4: Update the 8 test fixtures that reset the now-removed `_room_locks` dict**

In each of these files, delete the single line `monkeypatch.setattr(_svc, "_room_locks", {})` from its fixture (it existed only to reset per-test in-process lock state between tests; a Redis-backed lock has no such state to reset — each test already gets a fresh `fakeredis.FakeAsyncRedis()` instance):

- `backend/tests/test_min_players_sync.py:30`
- `backend/tests/test_late_join.py:65`
- `backend/tests/test_custom_question.py:43`
- `backend/tests/test_room_gc.py:31`
- `backend/tests/test_disconnect_admin_migration.py:63`
- `backend/tests/test_total_chasers.py:67`
- `backend/tests/test_avatar.py:31`
- `backend/tests/test_ws_game.py:130`

For example, in `backend/tests/test_disconnect_admin_migration.py`, the fixture currently reads:

```python
    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(_svc, "_room_locks", {})
    monkeypatch.setattr(_svc, "_connections", {})
```

Change to:

```python
    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(_svc, "_connections", {})
```

Apply the same one-line removal in the other 7 files (each has the equivalent `monkeypatch.setattr(_svc, "_room_locks", {})` line in its own `patch_redis_and_broadcast`-style fixture).

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS — every existing test still passes (the lock's external behavior — block until acquired, always released via `async with` — is unchanged; only its cross-worker safety changed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_min_players_sync.py backend/tests/test_late_join.py backend/tests/test_custom_question.py backend/tests/test_room_gc.py backend/tests/test_disconnect_admin_migration.py backend/tests/test_total_chasers.py backend/tests/test_avatar.py backend/tests/test_ws_game.py
git commit -m "fix: replace per-process room lock with cross-worker Redis lock"
```

---

### Task 3: Make `deck.initialize` atomic

**Files:**
- Modify: `backend/app/engine/deck.py:27-40`
- Modify: `backend/tests/test_deck.py`

**Interfaces:**
- No signature change — `Deck.initialize(room_code: str, game_ids: list[str]) -> None` behaves identically from the caller's perspective, just atomically now.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_deck.py` (after the existing `test_initialize_overwrites_previous_deck`):

```python
@pytest.mark.asyncio
async def test_initialize_never_leaves_game_ids_and_deck_out_of_sync(fake_redis):
    """Regression test for the Council Audit Report's CRITICAL #2: the old
    implementation did `delete` then two separate `rpush` calls with no
    pipeline, so a crash (or, in production, an interleaved concurrent call)
    between them could leave room:{code}:game_ids populated while
    room:{code}:deck was still empty (or vice versa). Asserting both keys
    always have the same length after initialize() is a proxy for "the
    three writes landed as one atomic unit"."""
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("ATOMIC", ["game_a", "game_b", "game_c"])

    game_ids = await fake_redis.lrange("room:ATOMIC:game_ids", 0, -1)
    shuffled_deck = await fake_redis.lrange("room:ATOMIC:deck", 0, -1)

    assert sorted(game_ids) == ["game_a", "game_b", "game_c"]
    assert sorted(shuffled_deck) == ["game_a", "game_b", "game_c"]


@pytest.mark.asyncio
async def test_initialize_with_empty_game_ids_deletes_both_keys(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("EMPTIED", ["game_a"])
    await deck.initialize("EMPTIED", [])

    assert await fake_redis.exists("room:EMPTIED:game_ids") == 0
    assert await fake_redis.exists("room:EMPTIED:deck") == 0
```

- [ ] **Step 2: Run tests to verify they fail (or pass vacuously) before the change**

Run: `cd backend && uv run pytest tests/test_deck.py -v`
Expected: these two new tests already PASS against the current implementation (it's functionally correct today, just not atomic) — this step is a baseline check, not a red-bar. The real verification is Step 4's full-suite run after the refactor still passing, since atomicity itself isn't observable from a single-threaded test. Confirm no failures before proceeding.

- [ ] **Step 3: Rewrite `initialize` to use a single pipeline transaction**

Find (deck.py:27-40):

```python
    async def initialize(self, room_code: str, game_ids: list[str]) -> None:
        """Persist the game catalogue and push a shuffled deck into Redis."""
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        await self._redis.delete(ids_key, deck_key)
        if not game_ids:
            return

        await self._redis.rpush(ids_key, *game_ids)

        shuffled = game_ids.copy()
        random.shuffle(shuffled)
        await self._redis.rpush(deck_key, *shuffled)
```

Replace with:

```python
    async def initialize(self, room_code: str, game_ids: list[str]) -> None:
        """Persist the game catalogue and push a shuffled deck into Redis,
        as a single atomic MULTI/EXEC transaction — a concurrent reader
        (get_game_ids / peek_next_game / pop_next_game, possibly racing
        from another worker) must never observe game_ids and deck rebuilt
        out of step with each other."""
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        if not game_ids:
            await self._redis.delete(ids_key, deck_key)
            return

        shuffled = game_ids.copy()
        random.shuffle(shuffled)

        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.delete(ids_key, deck_key)
            pipe.rpush(ids_key, *game_ids)
            pipe.rpush(deck_key, *shuffled)
            await pipe.execute()
```

- [ ] **Step 4: Run the full deck test suite**

Run: `cd backend && uv run pytest tests/test_deck.py -v`
Expected: PASS — all existing tests plus the two new ones from Step 1.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS (deck.initialize is used by room_service.py and rooms.py — confirm nothing downstream broke).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/deck.py backend/tests/test_deck.py
git commit -m "fix: make deck.initialize's delete+rpush atomic via pipeline"
```

---

### Task 4: Backend logging — configuration + the silent pub/sub failure

**Files:**
- Create: `backend/app/logging_config.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/engine/room_service.py:233-291` (`_pubsub_listener`)
- Test: `backend/tests/test_pubsub_listener_logging.py`

**Interfaces:**
- Produces: `configure_logging(level: int = logging.INFO) -> None` in `app/logging_config.py`.
- Consumes: the `logger` module-level object added to `room_service.py` in Task 2, Step 1.

- [ ] **Step 1: Write the logging config module**

```python
# backend/app/logging_config.py
"""Backend-wide logging setup. Call once at process startup (see main.py).
Before this, the backend had zero logging anywhere — every exception
caught-and-swallowed in room_service.py (e.g. the pub/sub listener) left no
trace in production. This doesn't change what's caught; it makes what's
already being caught visible."""

import logging
import sys

_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    """Idempotent — logging.basicConfig no-ops if the root logger already
    has a handler, so calling this more than once (e.g. once from main.py,
    once from a test) is safe."""
    logging.basicConfig(level=level, format=_LOG_FORMAT, stream=sys.stdout)
```

- [ ] **Step 2: Wire it into app startup**

Find (`backend/app/main.py`):

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import rooms, ws

app = FastAPI(title="SipSync", version="0.1.0")
```

Replace with:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.logging_config import configure_logging
from app.routers import rooms, ws

configure_logging()

app = FastAPI(title="SipSync", version="0.1.0")
```

- [ ] **Step 3: Turn the pub/sub listener's silent failure into a logged one**

Find (`backend/app/engine/room_service.py`, inside `_pubsub_listener`, the loop body — this is the code as it stands after Task 2's edits, unchanged in this region so far):

```python
                    text: str = msg["data"]
                    for ws in list(self._connections.get(code, {}).values()):
                        try:
                            await ws.send_text(text)
                        except Exception:
                            pass

                except (TimeoutError, redis_exceptions.TimeoutError):
                    await asyncio.sleep(0.1)
                    continue
                except asyncio.CancelledError:
                    break
                except Exception:
                    break
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:
                pass
            self._subscriptions.discard(code)
```

Replace with:

```python
                    text: str = msg["data"]
                    for ws in list(self._connections.get(code, {}).values()):
                        try:
                            await ws.send_text(text)
                        except Exception:
                            logger.debug(
                                "Failed to forward pubsub message to a socket in room %s",
                                code, exc_info=True,
                            )

                except (TimeoutError, redis_exceptions.TimeoutError):
                    await asyncio.sleep(0.1)
                    continue
                except asyncio.CancelledError:
                    break
                except Exception:
                    # Previously silent (bare `except Exception: break`) —
                    # this used to kill this worker's broadcast forwarding
                    # for the room permanently with zero trace anywhere,
                    # since the backend had no logging at all (Council Audit
                    # Report, Silent Failures #1). The `finally` block below
                    # still discards `code` from self._subscriptions, so the
                    # next HANDSHAKE on this worker spawns a fresh listener —
                    # this log is what makes the failure that triggered that
                    # recovery actually visible.
                    logger.exception(
                        "Unexpected error in pubsub listener for room %s; "
                        "forwarding stopped for this worker until the next "
                        "HANDSHAKE respawns it.", code,
                    )
                    break
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:
                logger.debug(
                    "Error cleaning up pubsub subscription for room %s",
                    code, exc_info=True,
                )
            self._subscriptions.discard(code)
```

- [ ] **Step 4: Write the regression test**

```python
# backend/tests/test_pubsub_listener_logging.py
"""Regression test for Council Audit Report Silent Failures #1: an
unexpected exception inside _pubsub_listener must be logged, not silently
swallowed, and the room must remain resubscribable afterward (the listener
removes itself from self._subscriptions in its `finally`, so the next
HANDSHAKE on this worker spawns a fresh one)."""
import logging

import fakeredis
import pytest

import app.engine.room_service as rs_module

CODE = "LOGTEST"
_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(_svc, "_connections", {})
    monkeypatch.setattr(_svc, "_subscriptions", set())
    return r


@pytest.mark.asyncio
async def test_unexpected_pubsub_error_is_logged_not_swallowed(patch_redis, caplog):
    class _ExplodingPubSub:
        async def subscribe(self, channel):
            pass

        async def get_message(self, **kwargs):
            raise RuntimeError("boom")

        async def unsubscribe(self, channel):
            pass

        async def aclose(self):
            pass

    class _ExplodingRedis:
        def pubsub(self):
            return _ExplodingPubSub()

    monkeypatch_redis = _ExplodingRedis()

    import app.engine.room_service as rs
    original_redis = rs.redis
    rs.redis = monkeypatch_redis
    try:
        _svc._subscriptions.add(CODE)
        with caplog.at_level(logging.ERROR, logger="app.engine.room_service"):
            await _svc._pubsub_listener(CODE)
    finally:
        rs.redis = original_redis

    assert CODE not in _svc._subscriptions
    assert any(
        "Unexpected error in pubsub listener" in record.message
        for record in caplog.records
    )
```

- [ ] **Step 5: Run the new test**

Run: `cd backend && uv run pytest tests/test_pubsub_listener_logging.py -v`
Expected: PASS

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS — full suite green.

- [ ] **Step 7: Manual smoke check that logging actually reaches stdout**

Run: `cd backend && uv run uvicorn app.main:app --port 8001 &` then `curl -s localhost:8001/health`, then check the terminal output for a startup log line (or absence of errors) confirming `configure_logging()` ran without raising; stop the server with `kill %1`.
Expected: `{"status":"ok"}` from curl, no traceback from the logging setup itself in the server's stdout.

- [ ] **Step 8: Commit**

```bash
git add backend/app/logging_config.py backend/app/main.py backend/app/engine/room_service.py backend/tests/test_pubsub_listener_logging.py
git commit -m "feat: add backend logging and stop the pubsub listener from failing silently"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1+2 cover audit item "replace asyncio.Lock with Redis-backed lock for all room mutations" (including extending coverage to `_sync_eligible_games`, the exact CRITICAL #2 TOCTOU cited in the report). Task 3 covers "make deck.initialize atomic." Task 4 covers "add logging" and "fix _pubsub_listener's silent exception."
- **Type consistency:** `_room_lock` returns `RedisLock` everywhere it's referenced (Task 2); every existing `async with self._room_lock(code):` call site in `room_service.py` needs no changes since `RedisLock` implements the same `__aenter__`/`__aexit__` protocol as `asyncio.Lock`.
- **No placeholders:** every step has literal, complete code — no "add appropriate handling" left for the implementer to invent.
