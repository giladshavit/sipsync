"""
Tests for GAME_ACTION routing in ws.py.

Strategy: patch module-level `redis` references in ws and fsm to a shared
fakeredis instance, replace `broadcast` with a list-capturing async stub,
and inject a concrete test game via `load_game`.
"""
import asyncio
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.routers.ws as ws_module
from app.engine.base import BaseMiniGame
from app.engine.fsm import RoomState


# ---------------------------------------------------------------------------
# Minimal concrete game for testing
# ---------------------------------------------------------------------------

class _CountdownGame(BaseMiniGame):
    """Finishes after `countdown` actions; each finish awards score_delta=5."""
    game_id = "test_countdown"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {"remaining": 2}

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        remaining = current_state["remaining"] - 1
        new_state = {"remaining": remaining}
        is_finished = remaining <= 0
        outcomes = {player_id: {"score_delta": 5}} if is_finished else {}
        return new_state, is_finished, outcomes


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

CODE = "TSTCD"
PLAYER = "player-uuid-1"
ADMIN = "admin-uuid"


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    """Replace redis in ws + fsm with a shared fakeredis; capture broadcasts."""
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(ws_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(ws_module, "broadcast", _mock_broadcast)
    monkeypatch.setattr(ws_module, "load_game", lambda _: _CountdownGame())
    monkeypatch.setattr(ws_module, "_room_locks", {})

    return r, captured


@pytest.fixture
async def playing_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": ADMIN,
        "active_game": "test_countdown",
    })
    await r.hset(f"room:{CODE}:players", PLAYER, json.dumps({
        "display_name": "Alice",
        "score": 10,
        "clock_offset": 0,
    }))
    await r.set(f"room:{CODE}:game", json.dumps({"remaining": 2}))
    return r


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_game_action_broadcasts_updated_state(playing_room, patch_redis_and_broadcast):
    _, captured = patch_redis_and_broadcast

    await ws_module._handle_game_action(CODE, PLAYER, {})

    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert len(game_state_msgs) == 1
    assert game_state_msgs[0]["state"] == {"remaining": 1}


@pytest.mark.asyncio
async def test_game_action_persists_state_to_redis(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await ws_module._handle_game_action(CODE, PLAYER, {})

    raw = await r.get(f"room:{CODE}:game")
    assert json.loads(raw) == {"remaining": 1}


@pytest.mark.asyncio
async def test_finished_game_outcomes_include_total_score(playing_room, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast

    # Two actions finish the countdown game
    await ws_module._handle_game_action(CODE, PLAYER, {})
    await ws_module._handle_game_action(CODE, PLAYER, {})

    outcomes_msgs = [m for m in captured if m["type"] == "OUTCOMES"]
    assert len(outcomes_msgs) == 1
    player_outcome = outcomes_msgs[0]["outcomes"][PLAYER]
    assert "total_score" in player_outcome
    assert player_outcome["total_score"] == 15  # 10 base + 5 delta


@pytest.mark.asyncio
async def test_finished_game_persists_updated_score(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await ws_module._handle_game_action(CODE, PLAYER, {})
    await ws_module._handle_game_action(CODE, PLAYER, {})

    raw = await r.hget(f"room:{CODE}:players", PLAYER)
    assert json.loads(raw)["score"] == 15


@pytest.mark.asyncio
async def test_finished_game_transitions_fsm_to_personal_summary(playing_room, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast

    await ws_module._handle_game_action(CODE, PLAYER, {})
    await ws_module._handle_game_action(CODE, PLAYER, {})

    state = await r.hget(f"room:{CODE}", "state")
    assert state == RoomState.PERSONAL_SUMMARY

    fsm_msgs = [m for m in captured if m["type"] == "FSM_TRANSITION"]
    assert any(m["new_state"] == RoomState.PERSONAL_SUMMARY for m in fsm_msgs)


@pytest.mark.asyncio
async def test_game_action_ignored_when_not_playing(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.LOBBY,
        "admin_id": ADMIN,
    })

    await ws_module._handle_game_action(CODE, PLAYER, {})

    assert not any(m["type"] == "GAME_STATE" for m in captured)


@pytest.mark.asyncio
async def test_concurrent_actions_are_serialised(playing_room, patch_redis_and_broadcast):
    """Two simultaneous GAME_ACTION calls must not interleave state reads/writes."""
    r, _ = patch_redis_and_broadcast

    # Run two actions concurrently; the countdown starts at 2 so both will
    # process — but only the second (serial) one should see remaining==0.
    await asyncio.gather(
        ws_module._handle_game_action(CODE, PLAYER, {}),
        ws_module._handle_game_action(CODE, PLAYER, {}),
    )

    raw = await r.get(f"room:{CODE}:game")
    # After two serial decrements the counter must be exactly 0, never negative.
    assert json.loads(raw) == {"remaining": 0}
