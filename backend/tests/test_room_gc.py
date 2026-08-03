"""Tests for room garbage collection: TTL-based cleanup of abandoned rooms."""
import json

import fakeredis
import pytest

import app.engine.room_service as rs_module
import app.routers.rooms as rooms_module
from app.engine.deck import deck as deck_singleton
from app.models.room import CreateRoomRequest

ADMIN = "admin-uuid-for-tests"


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(rooms_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    svc = rs_module.room_service
    monkeypatch.setattr(svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(svc, "_room_locks", {})
    return r, captured


async def test_create_room_sets_ttl_on_every_key_including_deck_and_admin_game_ids(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    resp = await rooms_module.create_room(
        CreateRoomRequest(admin_id=ADMIN, game_ids=["reflex"])
    )

    # In non-practice mode, these keys are never created by create_room
    never_created = {
        f"room:{resp.code}:asked_questions",
        f"room:{resp.code}:conn_count",
        f"room:{resp.code}:game",
        f"room:{resp.code}:players",
    }
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
