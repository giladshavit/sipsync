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
    OTHER = "player-b-uuid"
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await _join(CODE, OTHER)

    # Non-admin player leaves — conn_count decremented but room not dissolved
    # since admin is still present.
    await _svc.handle_leave(CODE, OTHER)

    assert await r.get(f"room:{CODE}:conn_count") == "1"
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS
