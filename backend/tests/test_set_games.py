"""Tests for the in-room SET_GAMES action (room_service.handle_set_games) —
lets the admin change a room's game selection after creation, live."""
import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "SETCD"
ADMIN = "admin-uuid"
PLAYER = "player-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    return r, captured


@pytest.fixture
async def lobby_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})
    await deck_singleton.initialize(CODE, ["reflex", "tap_race", "roulette"])
    return r


@pytest.mark.asyncio
async def test_admin_can_update_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, ["roulette", "reflex"])

    assert await deck_singleton.get_game_ids(CODE) == ["roulette", "reflex"]
    msgs = [m for m in captured if m["type"] == "GAME_IDS_UPDATED"]
    assert len(msgs) == 1
    assert msgs[0]["game_ids"] == ["roulette", "reflex"]


@pytest.mark.asyncio
async def test_non_admin_cannot_update_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, PLAYER, ["roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_ignored_outside_lobby(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PLAYING, "admin_id": ADMIN})
    await deck_singleton.initialize(CODE, ["reflex"])

    await _svc.handle_set_games(CODE, ADMIN, ["roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_rejects_unknown_game_id(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, ["not_a_real_game"])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_rejects_empty_selection(lobby_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_games(CODE, ADMIN, [])

    assert await deck_singleton.get_game_ids(CODE) == ["reflex", "tap_race", "roulette"]
    assert not any(m["type"] == "GAME_IDS_UPDATED" for m in captured)


@pytest.mark.asyncio
async def test_dedupes_preserving_order(lobby_room, patch_redis_and_broadcast):
    await _svc.handle_set_games(CODE, ADMIN, ["roulette", "reflex", "roulette"])

    assert await deck_singleton.get_game_ids(CODE) == ["roulette", "reflex"]
