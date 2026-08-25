"""
Room Garbage Collection: Redis TTL policy for room-scoped keys, driven by
a cross-worker Redis set of currently-registered player_ids
(room:{code}:conns) rather than the per-process `self._connections` dict —
see docs/superpowers/specs/2026-08-02-room-garbage-collection-design.md.

Strategy mirrors test_min_players_sync.py: patch module-level `redis` in
room_service + the deck singleton's own client with a shared fakeredis,
replace `room_service.broadcast` with a list-capturing stub.
"""
import fakeredis
import pytest

import app.engine.room_service as rs_module
import app.routers.rooms as rooms_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState
from app.models.room import CreateRoomRequest

CODE = "GCCODE"
ADMIN = "admin-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)
    monkeypatch.setattr(_svc, "_connections", {})

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    return r, captured


@pytest.fixture(autouse=True)
def _patch_rooms_router_redis(monkeypatch, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    monkeypatch.setattr(rooms_module, "redis", r)


def test_room_redis_keys_covers_every_room_scoped_key():
    keys = rs_module._room_redis_keys(CODE)
    assert keys == (
        f"room:{CODE}",
        f"room:{CODE}:players",
        f"room:{CODE}:deck",
        f"room:{CODE}:game_ids",
        f"room:{CODE}:admin_game_ids",
        f"room:{CODE}:next_game",
        f"room:{CODE}:game",
        f"room:{CODE}:asked_questions",
        f"room:{CODE}:conns",
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


async def test_handshake_adds_to_conns_and_refreshes_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})

    await _join(CODE, ADMIN)

    assert await r.scard(f"room:{CODE}:conns") == 1
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

    assert await r.scard(f"room:{CODE}:conns") == 0
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS


async def test_disconnect_with_others_still_connected_leaves_the_active_ttl_alone(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    OTHER = "player-b-uuid"
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws_admin = await _join(CODE, ADMIN)
    await _join(CODE, OTHER)

    await _svc.handle_disconnect(CODE, ADMIN, ws_admin)

    assert await r.scard(f"room:{CODE}:conns") == 1
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_reconnect_within_the_window_restores_the_active_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws = await _join(CODE, ADMIN)
    await _svc.handle_disconnect(CODE, ADMIN, ws)
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS

    await _join(CODE, ADMIN)

    assert await r.scard(f"room:{CODE}:conns") == 1
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_leave_room_decrements_and_can_trigger_the_empty_room_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    OTHER = "player-b-uuid"
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws_admin = await _join(CODE, ADMIN)
    await _join(CODE, OTHER)

    # Admin disconnects (conns 2→1, handle_disconnect does not call
    # _finalize_departure so room is not cleaned up)
    await _svc.handle_disconnect(CODE, ADMIN, ws_admin)

    # Non-admin player leaves while as last connection (conns 1→0,
    # _apply_empty_room_ttl called inside handle_leave; _finalize_departure
    # returns early since OTHER is not admin_id, so empty TTL survives)
    await _svc.handle_leave(CODE, OTHER)

    assert await r.scard(f"room:{CODE}:conns") == 0
    assert await r.ttl(f"room:{CODE}") == rs_module._EMPTY_ROOM_TTL_SECONDS


async def test_end_night_deletes_asked_questions_and_conns_too(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await r.sadd(f"room:{CODE}:asked_questions", "some question")

    await _svc.handle_end_night(CODE, ADMIN)

    for key in rs_module._room_redis_keys(CODE):
        assert await r.exists(key) == 0, key


async def test_end_night_deletes_the_stored_up_next_card(patch_redis_and_broadcast):
    """Up Next is stored room state now (room:{code}:next_game), so it has to
    be torn down with the rest of the room rather than outliving it."""
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await r.set(f"room:{CODE}:next_game", "reflex")

    await _svc.handle_end_night(CODE, ADMIN)

    assert await r.exists(f"room:{CODE}:next_game") == 0


async def test_refresh_room_ttl_covers_the_stored_up_next_card(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN, "practice": "0"})
    await r.set(f"room:{CODE}:next_game", "reflex")

    await _svc.refresh_room_ttl(CODE)

    assert await r.ttl(f"room:{CODE}:next_game") == rs_module._ACTIVE_ROOM_TTL_SECONDS


async def test_host_leaving_an_empty_room_deletes_asked_questions_and_conns_too(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await _join(CODE, ADMIN)
    await r.sadd(f"room:{CODE}:asked_questions", "some question")

    await _svc.handle_leave(CODE, ADMIN)

    for key in rs_module._room_redis_keys(CODE):
        assert await r.exists(key) == 0, key


# ============================================================================
# Final Review Fix Tests: SADD/SREM/SCARD replacing the raw INCR/DECR
# counter — regression coverage for the two bugs the counter design had.
# ============================================================================


async def test_disconnect_for_a_never_handshaked_room_does_not_apply_empty_room_ttl(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    # Simulate a room that existed in Redis before this feature shipped:
    # room hash + players hash present, but room:{CODE}:conns was never
    # created because handle_handshake (which SADDs to it) never ran for
    # this player under the pre-feature code. self._connections is seeded
    # directly too, bypassing handle_handshake/_join, so the identity check
    # in handle_disconnect still treats this websocket as the live
    # connection and the code reaches the SREM/SCARD check we're testing.
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", mapping={ADMIN: "{}"})
    ws = _FakeWebSocket()
    _svc._connections[CODE] = {ADMIN: ws}

    await _svc.handle_disconnect(CODE, ADMIN, ws)

    # room:{CODE}:conns was never populated for this player, so SREM
    # returns 0 (falsy) — the empty-room TTL must not fire off that false
    # signal. The room's TTL is left completely untouched (no TTL was ever
    # set on it in this test, so it should still be -1, definitely not the
    # 60s empty-room grace period).
    assert await r.scard(f"room:{CODE}:conns") == 0
    assert await r.ttl(f"room:{CODE}") == -1


async def test_screen_transition_double_handshake_does_not_inflate_conns(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    ws1 = await _join(CODE, ADMIN)
    # Simulates a screen transition's new HANDSHAKE registering before the
    # old socket's disconnect is detected by the server — an ordering the
    # codebase does not guarantee either way (see _admin_migration_timeout's
    # docstring). SADD's idempotency must keep the set at size 1, not 2.
    ws2 = await _join(CODE, ADMIN)

    assert await r.scard(f"room:{CODE}:conns") == 1

    # The now-stale first socket's disconnect fires later. self._connections
    # holds ws2 for this player_id, so the identity check in
    # handle_disconnect skips it entirely — conns must still show the
    # player as present.
    await _svc.handle_disconnect(CODE, ADMIN, ws1)

    assert await r.scard(f"room:{CODE}:conns") == 1
    assert await r.ttl(f"room:{CODE}") == rs_module._ACTIVE_ROOM_TTL_SECONDS
    assert _svc._connections[CODE][ADMIN] is ws2


# ============================================================================
# Task 4 Tests: Verify create_room applies TTL to all room-scoped keys
# ============================================================================


async def test_create_room_sets_ttl_on_every_key_including_deck_and_admin_game_ids(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    resp = await rooms_module.create_room(
        CreateRoomRequest(admin_id=ADMIN, game_ids=["reflex"])
    )

    # In non-practice mode, these keys are never created by create_room
    never_created = {
        f"room:{resp.code}:asked_questions",
        f"room:{resp.code}:conns",
        f"room:{resp.code}:game",
        f"room:{resp.code}:players",
    }
    for key in rs_module._room_redis_keys(resp.code):
        if key in never_created:
            assert await r.ttl(key) == -2, key  # never created — EXPIRE on it was a no-op
        else:
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
