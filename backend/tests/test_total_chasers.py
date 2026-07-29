"""Tests for the cumulative total_chasers counter: persisted per player in
room:{code}:players, initialized/preserved across handshakes, and
accumulated (alongside score) every time a round's outcomes are enriched."""
import json

import fakeredis
import pytest

import app.engine.bot_engine as bot_engine_module
import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.avatar_pool import AVATAR_POOL
from app.engine.base import BaseMiniGame
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "TOTCD"
PLAYER_A = "player-a"

_svc = rs_module.room_service


class _FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


class _ChaserGame(BaseMiniGame):
    """Finishes on the first action, awarding the acting player 3 chasers
    and 5 points — a minimal stand-in for a real mini-game's outcome shape."""
    game_id = "test_chaser_game"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {"done": False}

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        return {"done": True}, True, {player_id: {"score_delta": 5, "chasers": 3}}


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)
    monkeypatch.setattr(deck_singleton, "_redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(rs_module, "load_game", lambda _: _ChaserGame())
    monkeypatch.setattr(_svc, "_room_locks", {})
    return r, captured


# ── handle_handshake ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_handshake_initializes_total_chasers_to_zero(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "LOBBY")

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 0


@pytest.mark.asyncio
async def test_handshake_preserves_existing_total_chasers_on_reconnect(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "PLAYING")
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 5, "total_chasers": 7,
        "clock_offset": 0, "avatar": AVATAR_POOL[0],
    }))

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 7


@pytest.mark.asyncio
async def test_handshake_broadcasts_total_chasers_in_player_joined(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "PLAYING")
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 5, "total_chasers": 7,
        "clock_offset": 0, "avatar": AVATAR_POOL[0],
    }))

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    joined_msgs = [m for m in captured if m["type"] == "PLAYER_JOINED"]
    assert joined_msgs[-1]["total_chasers"] == 7


# ── bot_engine ───────────────────────────────────────────────────────────

def test_bot_records_include_total_chasers():
    """Verify bot records built by build_bot_player_records include
    total_chasers=0 for parity with real players."""
    records = bot_engine_module.build_bot_player_records(2, set())
    assert len(records) == 2
    for bot_id, record in records.items():
        assert record["total_chasers"] == 0
        assert record["score"] == 0
        assert record["is_bot"] is True


# ── _enrich_scores_and_broadcast (via _handle_game_action) ──────────────

@pytest.fixture
async def playing_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": PLAYER_A,
        "active_game": "test_chaser_game",
    })
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 10, "total_chasers": 4, "clock_offset": 0,
    }))
    await r.set(f"room:{CODE}:game", json.dumps({"done": False}))
    return r


@pytest.mark.asyncio
async def test_finished_round_accumulates_total_chasers(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER_A, {})

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 7  # 4 base + 3 this round
    assert stored["score"] == 15  # 10 base + 5 delta — unaffected by the new field


@pytest.mark.asyncio
async def test_outcomes_broadcast_does_not_expose_total_chasers(playing_room, patch_redis_and_broadcast):
    """total_chasers accumulates silently server-side — the OUTCOMES payload
    (per-round data only) must keep its existing shape."""
    _, captured = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER_A, {})

    outcomes_msgs = [m for m in captured if m["type"] == "OUTCOMES"]
    player_outcome = outcomes_msgs[0]["outcomes"][PLAYER_A]
    assert "total_chasers" not in player_outcome
    assert player_outcome["total_score"] == 15
