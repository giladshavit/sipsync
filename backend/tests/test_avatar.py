"""Tests for room-scoped avatar identity: pick_avatar's uniqueness behavior,
and the self-service SET_AVATAR action (room_service.handle_set_avatar)."""
import json

import fakeredis
import pytest

import app.engine.room_service as rs_module
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar
from app.engine.deck import deck as deck_singleton

CODE = "AVATARCD"
PLAYER_A = "player-a"
PLAYER_B = "player-b"

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


def test_pick_avatar_prefers_saved_choice_when_free():
    assert pick_avatar(set(), preferred=AVATAR_POOL[5]) == AVATAR_POOL[5]


def test_pick_avatar_falls_back_when_preferred_is_taken():
    used = {AVATAR_POOL[5]}
    result = pick_avatar(used, preferred=AVATAR_POOL[5])
    assert result != AVATAR_POOL[5]
    assert result in AVATAR_POOL


def test_pick_avatar_falls_back_when_preferred_is_unknown():
    result = pick_avatar(set(), preferred="not-a-real-avatar")
    assert result in AVATAR_POOL


# ---------------------------------------------------------------------------
# handle_handshake — preferred_avatar wired through the join message
# ---------------------------------------------------------------------------

class _FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


@pytest.mark.asyncio
async def test_handshake_assigns_preferred_avatar_when_free(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "LOBBY")

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
        "preferred_avatar": AVATAR_POOL[7],
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["avatar"] == AVATAR_POOL[7]


@pytest.mark.asyncio
async def test_handshake_falls_back_when_preferred_avatar_taken(two_players, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "LOBBY")

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": "player-c",
        "display_name": "Cara",
        "local_ts": 0,
        "preferred_avatar": AVATAR_POOL[0],  # already Alice's
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", "player-c"))
    assert stored["avatar"] != AVATAR_POOL[0]
    assert stored["avatar"] in AVATAR_POOL


@pytest.mark.asyncio
async def test_handshake_reconnect_preserves_existing_avatar_over_preferred(two_players, patch_redis_and_broadcast):
    """A player who already has an avatar in this room (reconnect) keeps it,
    even if their saved preference now points somewhere else — the room
    avatar, once assigned, is stable for the room's lifetime."""
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "LOBBY")

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
        "preferred_avatar": AVATAR_POOL[9],
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["avatar"] == AVATAR_POOL[0]  # unchanged from two_players fixture


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
