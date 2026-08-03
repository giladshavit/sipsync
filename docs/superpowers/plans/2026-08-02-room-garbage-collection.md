# Room Garbage Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every room-scoped Redis key a TTL that's refreshed on activity and collapsed to a short grace period once a room empties, so abandoned rooms are reclaimed by Redis natively instead of leaking forever.

**Architecture:** A single canonical list of a room's Redis keys backs three things: TTL refresh (on room creation and every WebSocket join/reconnect), a short empty-room TTL (once a cross-worker connection counter hits zero), and the two existing explicit-teardown paths (`handle_end_night`, `_finalize_departure`). The connection counter (`room:{code}:conn_count`) lives in Redis, not in the per-process `self._connections` dict, so it stays correct across multiple Uvicorn workers.

**Tech Stack:** Python 3.12, FastAPI, `redis.asyncio`, `fakeredis` for tests, `pytest` (`asyncio_mode = "auto"`, no `@pytest.mark.asyncio` needed).

## Global Constraints

- Backend package management is `uv` only — never `pip install`, never a `requirements.txt`.
- Do not modify `backend/app/engine/fsm.py`, `backend/app/engine/deck.py`, `backend/app/engine/base.py`, or `backend/app/routers/ws.py` (core engine files, off-limits per CLAUDE.md's mini-game isolation rule — this task doesn't touch mini-games, but stays clear of these files regardless).
- Do not remove, rewrite, or change the behavior of the existing per-player disconnect grace period (`_DISCONNECT_GRACE_MS`, `_disconnect_grace_timeout`) or admin migration grace (`_ADMIN_MIGRATION_GRACE_MS`, `_admin_migration_timeout`) — this task is additive only.
- Never use an in-process Python dict as a substitute for Redis state under multiple Uvicorn workers — this is why connection counting uses a Redis key (`room:{code}:conn_count`), not `self._connections`.
- Python: type-hint everything.
- No commented-out code in commits.

Full design context: `docs/superpowers/specs/2026-08-02-room-garbage-collection-design.md`.

---

## Task 1: TTL constants, canonical key list, and refresh/apply helpers

**Files:**
- Modify: `backend/app/engine/room_service.py:85-97` (insert constants after the existing grace-period constants, insert methods after `_room_lock`)
- Test: Create `backend/tests/test_room_gc.py`

**Interfaces:**
- Produces: `rs_module._ACTIVE_ROOM_TTL_SECONDS: int` (86400), `rs_module._PRACTICE_ROOM_TTL_SECONDS: int` (1800), `rs_module._EMPTY_ROOM_TTL_SECONDS: int` (60), `rs_module._room_redis_keys(code: str) -> tuple[str, ...]` (8 keys), `room_service.refresh_room_ttl(code: str) -> None` (async, public), `room_service._apply_empty_room_ttl(code: str) -> None` (async, private).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_room_gc.py`:

```python
"""
Room Garbage Collection: Redis TTL policy for room-scoped keys, driven by
a cross-worker WebSocket connection counter (room:{code}:conn_count) rather
than the per-process `self._connections` dict — see
docs/superpowers/specs/2026-08-02-room-garbage-collection-design.md.

Strategy mirrors test_min_players_sync.py: patch module-level `redis` in
room_service + the deck singleton's own client with a shared fakeredis,
replace `room_service.broadcast` with a list-capturing stub.
"""
import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "GCCODE"
ADMIN = "admin-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
    monkeypatch.setattr(_svc, "_room_locks", {})
    monkeypatch.setattr(_svc, "_connections", {})

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    return r, captured


def test_room_redis_keys_covers_every_room_scoped_key():
    keys = rs_module._room_redis_keys(CODE)
    assert keys == (
        f"room:{CODE}",
        f"room:{CODE}:players",
        f"room:{CODE}:deck",
        f"room:{CODE}:game_ids",
        f"room:{CODE}:admin_game_ids",
        f"room:{CODE}:game",
        f"room:{CODE}:asked_questions",
        f"room:{CODE}:conn_count",
    )


async def test_refresh_room_ttl_sets_active_ttl_on_a_normal_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN, "practice": "0"})
    await r.hset(f"room:{CODE}:players", mapping={ADMIN: "{}"})

    await _svc.refresh_room_ttl(CODE)

    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS
    assert await r.ttl(f"room:{CODE}:players") == rs_module._ACTIVE_ROOM_TTL_SECONDS
    # A key that doesn't exist yet for this room — EXPIRE on it is a no-op,
    # not an error.
    assert await r.ttl(f"room:{CODE}:asked_questions") == -2


async def test_refresh_room_ttl_sets_the_shorter_practice_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN, "practice": "1"})

    await _svc.refresh_room_ttl(CODE)

    assert await r.ttl(f"room:{CODE}") == rs_module._PRACTICE_ROOM_TTL_SECONDS


async def test_apply_empty_room_ttl_sets_the_grace_period_on_every_key(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={ADMIN: "{}"})
    await r.rpush(f"room:{CODE}:deck", "reflex")

    await _svc._apply_empty_room_ttl(CODE)

    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS
    assert await r.ttl(f"room:{CODE}:players") == rs_module._EMPTY_ROOM_TTL_SECONDS
    assert await r.ttl(f"room:{CODE}:deck") == rs_module._EMPTY_ROOM_TTL_SECONDS
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: FAIL — `AttributeError: module 'app.engine.room_service' has no attribute '_room_redis_keys'` (and similar for the others).

- [ ] **Step 3: Add the constants and `_room_redis_keys` helper**

In `backend/app/engine/room_service.py`, after the existing `_ADMIN_MIGRATION_GRACE_MS = 10_000` line and its blank line (currently line 86), insert:

```python
# Room Garbage Collection: Redis TTL applied to every room-scoped key.
# Refreshed to this value on room creation and on every WebSocket
# HANDSHAKE (join or reconnect) — see refresh_room_ttl, called from
# rooms.create_room and handle_handshake.
_ACTIVE_ROOM_TTL_SECONDS = 86_400

# Practice rooms (solo vs. bots) keep this much shorter ceiling instead —
# refreshed the same way as _ACTIVE_ROOM_TTL_SECONDS, so a *live* practice
# session doesn't expire mid-play, but a room is never promoted from this
# short-lived sandbox lifetime to the full 24h one.
_PRACTICE_ROOM_TTL_SECONDS = 1_800

# Grace period applied to every room-scoped key once the last WebSocket
# connection to the room closes (room:{code}:conn_count reaches 0) — see
# _apply_empty_room_ttl. If nobody reconnects in time, Redis deletes the
# room's keys natively; a reconnect within the window (handle_handshake)
# restores _ACTIVE_ROOM_TTL_SECONDS / _PRACTICE_ROOM_TTL_SECONDS instead.
# This is a backstop for the explicit room-teardown paths below
# (handle_end_night, _finalize_departure) — not a replacement for them.
_EMPTY_ROOM_TTL_SECONDS = 60


def _room_redis_keys(code: str) -> tuple[str, ...]:
    """Every Redis key scoped to a single room. Single source of truth for
    TTL refresh (refresh_room_ttl / _apply_empty_room_ttl) and explicit
    teardown (handle_end_night, _finalize_departure) alike — previously
    each of those listed keys inline and both omitted
    room:{code}:asked_questions, leaking it on every room teardown."""
    return (
        f"room:{code}",
        f"room:{code}:players",
        f"room:{code}:deck",
        f"room:{code}:game_ids",
        f"room:{code}:admin_game_ids",
        f"room:{code}:game",
        f"room:{code}:asked_questions",
        f"room:{code}:conn_count",
    )
```

- [ ] **Step 4: Add the `refresh_room_ttl` and `_apply_empty_room_ttl` methods**

In the same file, inside `class RoomService`, immediately after the `_room_lock` method (currently lines 94-97), insert:

```python
    async def refresh_room_ttl(self, code: str) -> None:
        """Sets every room-scoped Redis key's TTL to the active-room value
        (or the shorter practice-room one) — called on room creation
        (rooms.create_room) and on every HANDSHAKE, i.e. every join or
        reconnect (handle_handshake). EXPIRE on a key that doesn't exist
        yet (e.g. room:{code}:asked_questions before any custom question)
        is a no-op, so this is safe to call unconditionally."""
        is_practice = await redis.hget(f"room:{code}", "practice") == "1"
        ttl = _PRACTICE_ROOM_TTL_SECONDS if is_practice else _ACTIVE_ROOM_TTL_SECONDS
        async with redis.pipeline(transaction=False) as pipe:
            for key in _room_redis_keys(code):
                pipe.expire(key, ttl)
            await pipe.execute()

    async def _apply_empty_room_ttl(self, code: str) -> None:
        """Room Garbage Collection: called once room:{code}:conn_count drops
        to 0 (the last WebSocket connection to the room closed, from either
        handle_disconnect or handle_leave). Gives a departed room
        _EMPTY_ROOM_TTL_SECONDS to be reclaimed by a reconnect
        (refresh_room_ttl) before Redis deletes its keys natively — a
        backstop for handle_end_night / _finalize_departure's own explicit,
        immediate deletes."""
        async with redis.pipeline(transaction=False) as pipe:
            for key in _room_redis_keys(code):
                pipe.expire(key, _EMPTY_ROOM_TTL_SECONDS)
            await pipe.execute()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_room_gc.py
git commit -m "feat: add room TTL constants and refresh/apply helpers"
```

---

## Task 2: Wire the connection counter into handshake, disconnect, and leave

**Files:**
- Modify: `backend/app/engine/room_service.py` (`handle_handshake`, `handle_disconnect`, `handle_leave`)
- Test: `backend/tests/test_room_gc.py` (append)

**Interfaces:**
- Consumes: `room_service.refresh_room_ttl(code)`, `room_service._apply_empty_room_ttl(code)` from Task 1.
- Produces: `room:{code}:conn_count` is incremented on every successful HANDSHAKE and decremented exactly once per player removed from `self._connections` (via either `handle_disconnect`'s identity-checked branch or `handle_leave`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_room_gc.py`:

```python
class _FakeWebSocket:
    async def send_text(self, _text: str) -> None:
        pass


async def _join(code: str, player_id: str, ws: "_FakeWebSocket | None" = None) -> _FakeWebSocket:
    ws = ws or _FakeWebSocket()
    await _svc.handle_handshake(code, ws, {
        "player_id": player_id,
        "display_name": player_id,
        "local_ts": 0,
    })
    return ws


async def test_handshake_increments_conn_count_and_refreshes_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})

    await _join(CODE, ADMIN)

    assert await r.get(f"room:{CODE}:conn_count") == "1"
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_handshake_sets_the_practice_ttl_when_the_room_is_practice(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN, "practice": "1"})

    await _join(CODE, ADMIN)

    assert await r.ttl(f"room:{CODE}") == rs_module._PRACTICE_ROOM_TTL_SECONDS


async def test_disconnect_to_zero_sets_the_empty_room_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws = await _join(CODE, ADMIN)

    await _svc.handle_disconnect(CODE, ADMIN, ws)

    assert await r.get(f"room:{CODE}:conn_count") == "0"
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS


async def test_disconnect_with_others_still_connected_leaves_the_active_ttl_alone(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    OTHER = "player-b-uuid"
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws_admin = await _join(CODE, ADMIN)
    await _join(CODE, OTHER)

    await _svc.handle_disconnect(CODE, ADMIN, ws_admin)

    assert await r.get(f"room:{CODE}:conn_count") == "1"
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_reconnect_within_the_window_restores_the_active_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws = await _join(CODE, ADMIN)
    await _svc.handle_disconnect(CODE, ADMIN, ws)
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS

    await _join(CODE, ADMIN)

    assert await r.get(f"room:{CODE}:conn_count") == "1"
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_leave_room_decrements_and_can_trigger_the_empty_room_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)

    await _svc.handle_leave(CODE, ADMIN)

    assert await r.get(f"room:{CODE}:conn_count") == "0"
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: The 4 Task 1 tests still PASS; the 6 new tests FAIL (conn_count stays `None`/unset, TTLs stay at whatever the test set up, since nothing increments/decrements yet).

- [ ] **Step 3: Increment on handshake**

In `backend/app/engine/room_service.py`, `handle_handshake`, find this line (currently line 541):

```python
        self._connections.setdefault(code, {})[player_id] = websocket

        if code not in self._subscriptions:
```

Replace with:

```python
        self._connections.setdefault(code, {})[player_id] = websocket

        # Room Garbage Collection: room:{code}:conn_count is the
        # cross-worker connection count (self._connections above is
        # per-process only) — see refresh_room_ttl / _apply_empty_room_ttl.
        await redis.incr(f"room:{code}:conn_count")
        await self.refresh_room_ttl(code)

        if code not in self._subscriptions:
```

- [ ] **Step 4: Decrement on disconnect**

In the same file, `handle_disconnect`, find:

```python
        if room_conns.get(player_id) is not websocket:
            return
        room_conns.pop(player_id, None)

        disconnected_at = int(time.time() * 1000)
```

Replace with:

```python
        if room_conns.get(player_id) is not websocket:
            return
        room_conns.pop(player_id, None)

        # Room Garbage Collection: this is the same identity-checked
        # "really disconnected, not mid screen-transition" branch the
        # early-return above already guards — count once per genuine drop.
        remaining = await redis.decr(f"room:{code}:conn_count")
        if remaining <= 0:
            await self._apply_empty_room_ttl(code)

        disconnected_at = int(time.time() * 1000)
```

- [ ] **Step 5: Decrement on explicit leave**

In the same file, `handle_leave`, find:

```python
        async with self._room_lock(code):
            await redis.hdel(f"room:{code}:players", player_id)
            self._connections.get(code, {}).pop(player_id, None)

        await self._finalize_departure(code, player_id)
```

Replace with:

```python
        async with self._room_lock(code):
            await redis.hdel(f"room:{code}:players", player_id)
            self._connections.get(code, {}).pop(player_id, None)

            # Room Garbage Collection: mirrors the decrement in
            # handle_disconnect — this is the other place a player is
            # actually removed from self._connections.
            remaining = await redis.decr(f"room:{code}:conn_count")
            if remaining <= 0:
                await self._apply_empty_room_ttl(code)

        await self._finalize_departure(code, player_id)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: PASS (10 tests)

- [ ] **Step 7: Run the full backend test suite to check for regressions**

Run: `cd backend && .venv/bin/pytest -v`
Expected: PASS — in particular, `test_disconnect_admin_migration.py` and `test_min_players_sync.py`, which call `handle_handshake`/`handle_disconnect`/`handle_leave` directly, must still pass unchanged (they patch the same `rs_module.redis` fakeredis instance the new `INCR`/`DECR`/`EXPIRE` calls will hit).

- [ ] **Step 8: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_room_gc.py
git commit -m "feat: track room connection count and drive TTL from it"
```

---

## Task 3: Consolidate explicit room teardown onto the canonical key list

**Files:**
- Modify: `backend/app/engine/room_service.py` (`handle_end_night`, `_finalize_departure`)
- Test: `backend/tests/test_room_gc.py` (append)

**Interfaces:**
- Consumes: `rs_module._room_redis_keys(code)` from Task 1.
- Produces: no new interface — `handle_end_night` and `_finalize_departure`'s empty-room branch now delete `room:{code}:asked_questions` and `room:{code}:conn_count` too, closing the pre-existing leak on both paths.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_room_gc.py`:

```python
async def test_end_night_deletes_asked_questions_and_conn_count_too(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await r.sadd(f"room:{CODE}:asked_questions", "some question")

    await _svc.handle_end_night(CODE, ADMIN)

    for key in rs_module._room_redis_keys(CODE):
        assert await r.exists(key) == 0, key


async def test_host_leaving_an_empty_room_deletes_asked_questions_and_conn_count_too(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await r.sadd(f"room:{CODE}:asked_questions", "some question")

    await _svc.handle_leave(CODE, ADMIN)

    for key in rs_module._room_redis_keys(CODE):
        assert await r.exists(key) == 0, key
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: Both new tests FAIL — `room:{CODE}:asked_questions` still exists after teardown (the `conn_count` key, at 0 with a 60s TTL from Task 2's decrement, may already happen to be gone or present depending on fakeredis TTL rounding; the `asked_questions` assertion is the one that reliably fails here).

- [ ] **Step 3: Update `handle_end_night`**

In `backend/app/engine/room_service.py`, find:

```python
        await redis.delete(
            f"room:{code}",
            f"room:{code}:players",
            f"room:{code}:deck",
            f"room:{code}:game_ids",
            f"room:{code}:admin_game_ids",
            f"room:{code}:game",
        )
        await self.broadcast(code, {"type": "ROOM_DISSOLVED"})
```

Replace with:

```python
        await redis.delete(*_room_redis_keys(code))
        await self.broadcast(code, {"type": "ROOM_DISSOLVED"})
```

- [ ] **Step 4: Update `_finalize_departure`'s empty-room branch**

In the same file, find:

```python
        players_raw = await redis.hgetall(f"room:{code}:players")
        if not players_raw:
            # Host left an empty room — nothing to hand over, clean up
            await redis.delete(
                f"room:{code}",
                f"room:{code}:players",
                f"room:{code}:deck",
                f"room:{code}:game_ids",
                f"room:{code}:admin_game_ids",
                f"room:{code}:game",
            )
            return
```

Replace with:

```python
        players_raw = await redis.hgetall(f"room:{code}:players")
        if not players_raw:
            # Host left an empty room — nothing to hand over, clean up
            await redis.delete(*_room_redis_keys(code))
            return
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: PASS (12 tests)

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `cd backend && .venv/bin/pytest -v`
Expected: PASS — in particular `test_disconnect_admin_migration.py::test_sole_admin_disconnect_does_not_reassign` and any test exercising `handle_end_night` or a host leaving an empty room.

- [ ] **Step 7: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_room_gc.py
git commit -m "fix: include asked_questions and conn_count in room teardown deletes"
```

---

## Task 4: TTL the room's keys at creation time

**Files:**
- Modify: `backend/app/routers/rooms.py`
- Test: `backend/tests/test_room_gc.py` (append)

**Interfaces:**
- Consumes: `room_service.refresh_room_ttl(code)` from Task 1.
- Produces: no new interface — `rooms.create_room` no longer defines its own `_ROOM_TTL_SECONDS`/`_PRACTICE_TTL_SECONDS` or calls `redis.expire` directly; every room-scoped key (including `deck`, `game_ids`, `admin_game_ids`, and practice-bot `players` entries, none of which previously had any TTL) gets one.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_room_gc.py`:

```python
import app.routers.rooms as rooms_module
from app.models.room import CreateRoomRequest


@pytest.fixture(autouse=True)
def _patch_rooms_router_redis(monkeypatch, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    monkeypatch.setattr(rooms_module, "redis", r)


async def test_create_room_sets_ttl_on_every_key_including_deck_and_admin_game_ids(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    resp = await rooms_module.create_room(
        CreateRoomRequest(admin_id=ADMIN, game_ids=["reflex"])
    )

    never_created = {f"room:{resp.code}:asked_questions", f"room:{resp.code}:conn_count"}
    for key in rs_module._room_redis_keys(resp.code):
        if key in never_created:
            continue
        assert await r.ttl(key) == rs_module._ACTIVE_ROOM_TTL_SECONDS, key


async def test_create_room_sets_the_shorter_practice_ttl_and_ttls_the_bot_players(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    resp = await rooms_module.create_room(
        CreateRoomRequest(admin_id=ADMIN, game_ids=["reflex"], practice=True)
    )

    assert await r.ttl(f"room:{resp.code}") == rs_module._PRACTICE_ROOM_TTL_SECONDS
    # Practice rooms seed bot players at creation — this key previously had
    # no TTL at all until a human's own HANDSHAKE happened to set one.
    assert await r.ttl(f"room:{resp.code}:players") == rs_module._PRACTICE_ROOM_TTL_SECONDS
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: FAIL — `room:{code}:deck`, `room:{code}:game_ids`, `room:{code}:admin_game_ids` currently get no TTL at all (`ttl == -1`), so the first assertion mismatches on one of those keys.

- [ ] **Step 3: Update `rooms.py`**

Read the full current file at `backend/app/routers/rooms.py` first. Replace its contents with:

```python
import json
import secrets
import string
import uuid

from fastapi import APIRouter, HTTPException

from app.engine import bot_engine
from app.engine.deck import deck
from app.engine.room_service import room_service
from app.models.room import CreateRoomRequest, CreateRoomResponse, RoomInfoResponse
from app.redis_client import redis

router = APIRouter(prefix="/rooms", tags=["rooms"])

_CODE_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "").replace("1", "")
_CODE_LENGTH = 6
_MAX_RETRIES = 10


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


@router.post("", response_model=CreateRoomResponse, status_code=201)
async def create_room(body: CreateRoomRequest) -> CreateRoomResponse:
    for _ in range(_MAX_RETRIES):
        code = _generate_code()
        key = f"room:{code}"
        room_id = str(uuid.uuid4())

        created = await redis.hsetnx(key, "state", "LOBBY")
        if created:
            room_fields = {
                "room_id": room_id,
                "admin_id": body.admin_id,
                "state": "LOBBY",
                "practice": "1" if body.practice else "0",
            }
            if body.practice and body.practice_role:
                room_fields["practice_role_hint"] = body.practice_role
            await redis.hset(key, mapping=room_fields)
            await deck.initialize(code, body.game_ids)
            # Minimum Players: the admin's real intent, tracked separately
            # from deck.py's own game_ids so a game later auto-pruned by
            # room_service._sync_eligible_games (e.g. auction, needing more
            # players than join at first) can come back on its own once the
            # room grows past its floor — see handle_set_games/
            # _sync_eligible_games in room_service.py.
            await redis.rpush(f"room:{code}:admin_game_ids", *body.game_ids)

            if body.practice:
                bot_records = bot_engine.build_bot_player_records(
                    bot_engine.bot_headcount(body.game_ids[0]), used_avatars=set()
                )
                if bot_records:
                    await redis.hset(
                        f"room:{code}:players",
                        mapping={bid: json.dumps(rec) for bid, rec in bot_records.items()},
                    )

            # Room Garbage Collection: applied last, after every room-scoped
            # key above has been written — see room_service.refresh_room_ttl.
            await room_service.refresh_room_ttl(code)

            return CreateRoomResponse(
                code=code,
                room_id=room_id,
                share_url=f"sipsync://room/{code}",
            )

    raise HTTPException(status_code=503, detail="Could not allocate a unique room code")


@router.get("/{code}", response_model=RoomInfoResponse)
async def get_room(code: str) -> RoomInfoResponse:
    key = f"room:{code}"
    state = await redis.hget(key, "state")

    if state is None:
        return RoomInfoResponse(exists=False, player_count=0, state=None)

    player_count = await redis.hlen(f"room:{code}:players")
    return RoomInfoResponse(exists=True, player_count=player_count, state=state)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_room_gc.py -v`
Expected: PASS (14 tests)

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd backend && .venv/bin/pytest -v`
Expected: PASS, all files — this is the final task, so this is the full-suite confirmation that nothing else (bot practice room creation, `get_room`, any test constructing a room via `create_room`) regressed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/rooms.py backend/tests/test_room_gc.py
git commit -m "feat: TTL every room-scoped key at creation, not just the room hash"
```
