"""
Regression tests for Host Migration on an admin's disconnect.

A disconnected player is normally left alone for the full
_DISCONNECT_GRACE_MS (see handle_disconnect / _disconnect_grace_timeout) —
but nearly every room-progressing action (ADMIN_START, TUTORIAL_DONE,
SET_GAMES, NEXT_ROUND, ...) is admin-gated, so a disconnected admin can't
make the room wait out that full grace period. handle_disconnect instead
spawns _admin_migration_timeout as a fire-and-forget asyncio.create_task,
which waits only _ADMIN_MIGRATION_GRACE_MS before handing the room to
someone else — short enough to keep the room from freezing, but long enough
to absorb an ordinary screen-transition reconnect or a brief mobile-network
micro-drop (every round transition closes and reopens each client's own
socket, including the admin's, so a zero-delay reassignment reassigns admin
on essentially every round — this was a real regression, see
test_admin_reconnect_within_buffer_prevents_reassignment below).

Strategy mirrors test_ws_game.py: patch module-level `redis` with fakeredis,
replace `room_service.broadcast` with a list-capturing stub, and reset the
per-room lock/connection dicts between tests. _ADMIN_MIGRATION_GRACE_MS is
patched to 0 by default; since handle_disconnect only *spawns* the migration
task rather than awaiting it, tests still need to yield back to the event
loop (see _drain_pending_tasks) before the spawned task has actually run.
The interleaving test below overrides the grace period to a small nonzero
value so it can race a simulated reconnect against the real buffer.
"""
import asyncio
import json

import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck
from app.engine.fsm import RoomState

CODE = "TSTCD"
ADMIN = "admin-uuid"
OTHER_A = "player-a-uuid"
OTHER_B = "player-b-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    # _broadcast_new_admin_snapshot reads the deck via the module-level `deck`
    # singleton directly (not room_service's own `redis` reference) — it
    # binds its own real Redis client at import time, so it needs patching
    # separately or ROOM_STATE broadcasts here would hit a live connection.
    monkeypatch.setattr(deck, "_redis", r)
    # No need to actually wait out the admin-migration buffer in most tests.
    monkeypatch.setattr(rs_module, "_ADMIN_MIGRATION_GRACE_MS", 0)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(_svc, "_connections", {})

    return r, captured


def _player_json(**overrides) -> str:
    base = {"display_name": "P", "score": 0, "clock_offset": 0, "avatar": None}
    base.update(overrides)
    return json.dumps(base)


async def _drain_pending_tasks() -> None:
    """handle_disconnect only *spawns* _admin_migration_timeout via
    asyncio.create_task now — it no longer awaits it — so it returns before
    that task has run. With _ADMIN_MIGRATION_GRACE_MS patched to 0, the
    task's own asyncio.sleep(0.0) plus its handful of awaited redis calls
    each just need one event-loop tick to progress; a few yields is enough
    to let it run to completion."""
    for _ in range(10):
        await asyncio.sleep(0)


async def test_admin_disconnect_promotes_a_connected_player_after_the_buffer(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.TUTORIAL, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(display_name="Admin", score=5),
        OTHER_A: _player_json(display_name="Other"),
    })
    fake_ws = object()
    _svc._connections[CODE] = {ADMIN: fake_ws}

    await _svc.handle_disconnect(CODE, ADMIN, fake_ws)
    await _drain_pending_tasks()

    # Host migrated — no waiting for the full 60s grace period.
    assert await r.hget(f"room:{CODE}", "admin_id") == OTHER_A

    # The ex-admin's own player record survives, marked disconnected, not deleted.
    ex_admin_raw = await r.hget(f"room:{CODE}:players", ADMIN)
    assert ex_admin_raw is not None
    ex_admin = json.loads(ex_admin_raw)
    assert ex_admin["connected"] is False
    assert ex_admin["score"] == 5

    types = [m["type"] for m in captured]
    assert "PLAYER_DISCONNECTED" in types
    room_state_msgs = [m for m in captured if m["type"] == "ROOM_STATE"]
    assert len(room_state_msgs) == 1
    assert room_state_msgs[0]["admin_id"] == OTHER_A


async def test_admin_migration_mid_game_preserves_active_round(patch_redis_and_broadcast):
    """Regression: the ROOM_STATE broadcast announcing the new admin used to
    omit active_game (and every other field beyond state/admin_id/players/
    game_ids) — since the frontend replaces its entire snapshot wholesale on
    ROOM_STATE rather than merging, that silently reset every other client's
    activeGameId to undefined and dropped them into a "no active game"
    fallback, breaking the round for everyone still playing."""
    r, captured = patch_redis_and_broadcast
    game_state = {"remaining": 2}
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": ADMIN,
        "active_game": "test_countdown",
    })
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(display_name="Admin"),
        OTHER_A: _player_json(display_name="Other"),
    })
    await r.set(f"room:{CODE}:game", json.dumps(game_state))
    fake_ws = object()
    _svc._connections[CODE] = {ADMIN: fake_ws}

    await _svc.handle_disconnect(CODE, ADMIN, fake_ws)
    await _drain_pending_tasks()

    room_state_msgs = [m for m in captured if m["type"] == "ROOM_STATE"]
    assert len(room_state_msgs) == 1
    assert room_state_msgs[0]["active_game"] == "test_countdown"
    assert room_state_msgs[0]["state"] == RoomState.PLAYING
    assert room_state_msgs[0]["game_ids"] == []
    assert room_state_msgs[0]["practice"] is False

    # The live round itself must also survive — ROOM_STATE never carries
    # gameState, so a companion GAME_STATE re-broadcast is required or every
    # other client's in-progress round data vanishes along with it.
    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert len(game_state_msgs) == 1
    assert game_state_msgs[0]["game_id"] == "test_countdown"
    assert game_state_msgs[0]["state"] == game_state


async def test_admin_reconnect_within_buffer_prevents_reassignment(patch_redis_and_broadcast, monkeypatch):
    """The actual regression: every round transition (game -> summary ->
    podium -> tutorial -> game) closes and reopens each client's own socket,
    including the admin's — the routine reconnect that follows must NOT be
    treated as a real departure. Simulates that reconnect landing mid-buffer
    (exactly like a normal HANDSHAKE would) and asserts no reassignment
    happens."""
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "_ADMIN_MIGRATION_GRACE_MS", 50)
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(),
        OTHER_A: _player_json(),
    })
    fake_ws = object()
    _svc._connections[CODE] = {ADMIN: fake_ws}

    # handle_disconnect itself now returns immediately — it only *spawns*
    # _admin_migration_timeout, it no longer blocks on it — so simulating
    # the reconnect right after is exactly the real scenario: a completely
    # separate HANDSHAKE call landing while that task is still asleep.
    await _svc.handle_disconnect(CODE, ADMIN, fake_ws)

    # Simulate the reconnect landing mid-buffer, same as handle_handshake would.
    admin_raw = json.loads(await r.hget(f"room:{CODE}:players", ADMIN))
    admin_raw["connected"] = True
    admin_raw["disconnected_at"] = None
    await r.hset(f"room:{CODE}:players", ADMIN, json.dumps(admin_raw))

    # Let the spawned task run its full course — comfortably longer than
    # the real 50ms buffer it's asleep for.
    await asyncio.sleep(0.1)

    assert await r.hget(f"room:{CODE}", "admin_id") == ADMIN
    assert all(m["type"] != "ROOM_STATE" for m in captured)


async def test_admin_disconnect_prefers_a_connected_candidate_over_a_ghost(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(),
        # Already mid-grace-period from an earlier drop of their own.
        OTHER_A: _player_json(connected=False, disconnected_at=1),
        OTHER_B: _player_json(connected=True),
    })
    fake_ws = object()
    _svc._connections[CODE] = {ADMIN: fake_ws}

    await _svc.handle_disconnect(CODE, ADMIN, fake_ws)
    await _drain_pending_tasks()

    # Only OTHER_B is actually present — must not hand the room to a ghost.
    assert await r.hget(f"room:{CODE}", "admin_id") == OTHER_B


async def test_sole_admin_disconnect_does_not_reassign(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={ADMIN: _player_json()})
    fake_ws = object()
    _svc._connections[CODE] = {ADMIN: fake_ws}

    await _svc.handle_disconnect(CODE, ADMIN, fake_ws)
    await _drain_pending_tasks()

    # Nobody else to hand off to — admin_id stays put, no ROOM_STATE broadcast.
    assert await r.hget(f"room:{CODE}", "admin_id") == ADMIN
    assert all(m["type"] != "ROOM_STATE" for m in captured)


async def test_non_admin_disconnect_does_not_trigger_reassignment(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(),
        OTHER_A: _player_json(),
    })
    fake_ws = object()
    _svc._connections[CODE] = {OTHER_A: fake_ws}

    await _svc.handle_disconnect(CODE, OTHER_A, fake_ws)

    assert await r.hget(f"room:{CODE}", "admin_id") == ADMIN
    assert all(m["type"] != "ROOM_STATE" for m in captured)
