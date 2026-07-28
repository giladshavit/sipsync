"""Tests for room-scoped avatar identity: pick_avatar's uniqueness behavior,
and the self-service SET_AVATAR action (room_service.handle_set_avatar)."""
import json

import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar

CODE = "AVATARCD"
PLAYER_A = "player-a"
PLAYER_B = "player-b"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(_svc, "_room_locks", {})
    return r, captured


@pytest.fixture
async def two_players(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 0, "clock_offset": 0, "avatar": AVATAR_POOL[0],
    }))
    await r.hset(f"room:{CODE}:players", PLAYER_B, json.dumps({
        "display_name": "Bob", "score": 0, "clock_offset": 0, "avatar": AVATAR_POOL[1],
    }))
    return r


# ---------------------------------------------------------------------------
# pick_avatar
# ---------------------------------------------------------------------------

def test_pick_avatar_avoids_used():
    used = set(AVATAR_POOL[:-1])  # everyone but the last slot is taken
    assert pick_avatar(used) == AVATAR_POOL[-1]


def test_pick_avatar_returns_pool_member_when_nothing_used():
    assert pick_avatar(set()) in AVATAR_POOL


def test_pick_avatar_falls_back_when_pool_exhausted():
    used = set(AVATAR_POOL)  # every slot taken
    assert pick_avatar(used) in AVATAR_POOL  # duplicate allowed rather than crashing


# ---------------------------------------------------------------------------
# handle_set_avatar
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_avatar_updates_and_broadcasts(two_players, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    new_avatar = AVATAR_POOL[2]

    await _svc.handle_set_avatar(CODE, PLAYER_A, new_avatar)

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["avatar"] == new_avatar
    msgs = [m for m in captured if m["type"] == "PLAYER_AVATAR_CHANGED"]
    assert msgs == [{"type": "PLAYER_AVATAR_CHANGED", "player_id": PLAYER_A, "avatar": new_avatar}]


@pytest.mark.asyncio
async def test_set_avatar_rejects_avatar_taken_by_another_player(two_players, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast

    await _svc.handle_set_avatar(CODE, PLAYER_A, AVATAR_POOL[1])  # Bob's avatar

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["avatar"] == AVATAR_POOL[0]  # unchanged
    assert not any(m["type"] == "PLAYER_AVATAR_CHANGED" for m in captured)


@pytest.mark.asyncio
async def test_set_avatar_allows_reselecting_own_current_avatar(two_players, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_avatar(CODE, PLAYER_A, AVATAR_POOL[0])  # already Alice's own

    assert any(m["type"] == "PLAYER_AVATAR_CHANGED" for m in captured)


@pytest.mark.asyncio
async def test_set_avatar_rejects_unknown_avatar(two_players, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_avatar(CODE, PLAYER_A, "not-a-real-avatar")

    assert not any(m["type"] == "PLAYER_AVATAR_CHANGED" for m in captured)


@pytest.mark.asyncio
async def test_set_avatar_ignored_for_unknown_player(two_players, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_avatar(CODE, "ghost-player", AVATAR_POOL[3])

    assert not any(m["type"] == "PLAYER_AVATAR_CHANGED" for m in captured)


@pytest.mark.asyncio
async def test_set_avatar_ignored_when_player_id_none(two_players, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await _svc.handle_set_avatar(CODE, None, AVATAR_POOL[3])

    assert not any(m["type"] == "PLAYER_AVATAR_CHANGED" for m in captured)
