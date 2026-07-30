"""
Tests for the Custom Question flow (majority/minority only): the admin hands
a connected player the pen instead of drawing a random question from the
deck pool — see room_service.handle_start_custom_question /
handle_submit_custom_question and fsm.RoomState.CUSTOM_QUESTION_INPUT.

Strategy mirrors test_ws_game.py: patch module-level `redis` in room_service
+ fsm + deck with a shared fakeredis, capture broadcasts, reset the per-room
lock dict. Unlike test_ws_game.py, `load_game` is left untouched so
"majority"/"minority" resolve to the real MajorityGame/MinorityGame classes.
"""
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.deck import deck as deck_singleton
from app.engine.fsm import RoomState

CODE = "CUSTQ1"
ADMIN = "admin-uuid"
WRITER = "writer-uuid"
OTHER = "other-uuid"

_svc = rs_module.room_service


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
    monkeypatch.setattr(_svc, "_room_locks", {})

    return r, captured


async def _seed_tutorial_room(r, game_id: str = "majority") -> None:
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.TUTORIAL,
        "admin_id": ADMIN,
        "active_game": game_id,
    })
    for pid, name in ((ADMIN, "Admin"), (WRITER, "Writer"), (OTHER, "Other")):
        await r.hset(f"room:{CODE}:players", pid, json.dumps({
            "display_name": name,
            "score": 0,
            "clock_offset": 0,
            "connected": True,
        }))


# ---------------------------------------------------------------------------
# handle_start_custom_question
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_start_custom_question_transitions_and_broadcasts_writer(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)

    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.CUSTOM_QUESTION_INPUT
    assert await r.hget(f"room:{CODE}", "custom_question_writer_id") == WRITER

    msgs = [m for m in captured if m["type"] == "FSM_TRANSITION"]
    assert len(msgs) == 1
    assert msgs[0]["new_state"] == RoomState.CUSTOM_QUESTION_INPUT
    assert msgs[0]["writer_id"] == WRITER


@pytest.mark.asyncio
async def test_start_custom_question_rejects_non_admin(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)

    await _svc.handle_start_custom_question(CODE, OTHER, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


@pytest.mark.asyncio
async def test_start_custom_question_rejects_wrong_room_state(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)
    await r.hset(f"room:{CODE}", "state", RoomState.LOBBY)

    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.LOBBY
    assert not captured


@pytest.mark.asyncio
async def test_start_custom_question_rejects_non_majority_game(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r, game_id="roulette")

    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


@pytest.mark.asyncio
async def test_start_custom_question_rejects_unknown_writer(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)

    await _svc.handle_start_custom_question(CODE, ADMIN, "nobody")

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


@pytest.mark.asyncio
async def test_start_custom_question_rejects_late_joining_writer(patch_redis_and_broadcast):
    """A player still waiting_for_next_game is parked on waiting.tsx for the
    rest of this round and can never reach the writer's input screen —
    picking them would strand the room in CUSTOM_QUESTION_INPUT forever."""
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)
    await r.hset(f"room:{CODE}:players", WRITER, json.dumps({
        "display_name": "Writer", "score": 0, "clock_offset": 0,
        "connected": True, "waiting_for_next_game": True,
    }))

    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


@pytest.mark.asyncio
async def test_start_custom_question_rejects_disconnected_writer(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)
    await r.hset(f"room:{CODE}:players", WRITER, json.dumps({
        "display_name": "Writer", "score": 0, "clock_offset": 0, "connected": False,
    }))

    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


# ---------------------------------------------------------------------------
# handle_submit_custom_question
# ---------------------------------------------------------------------------

async def _advance_to_custom_input(r) -> None:
    await _seed_tutorial_room(r)
    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)


@pytest.mark.asyncio
async def test_submit_custom_question_injects_data_and_starts_round(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _advance_to_custom_input(r)

    await _svc.handle_submit_custom_question(CODE, WRITER, {
        "question": "Beach or mountains?",
        "option_a": "Beach",
        "option_b": "Mountains",
    })

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PLAYING
    assert await r.hget(f"room:{CODE}", "custom_question_writer_id") is None

    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert len(game_state_msgs) == 1
    state = game_state_msgs[0]["state"]
    assert state["current_question"] == "Beach or mountains?"
    assert state["option_a"] == "Beach"
    assert state["option_b"] == "Mountains"

    fsm_msgs = [m for m in captured if m["type"] == "FSM_TRANSITION"]
    assert any(m["new_state"] == RoomState.PLAYING for m in fsm_msgs)


@pytest.mark.asyncio
async def test_submit_custom_question_rejects_non_writer(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _advance_to_custom_input(r)
    captured.clear()

    await _svc.handle_submit_custom_question(CODE, OTHER, {
        "question": "Q", "option_a": "A", "option_b": "B",
    })

    assert await r.hget(f"room:{CODE}", "state") == RoomState.CUSTOM_QUESTION_INPUT
    assert not captured


@pytest.mark.asyncio
async def test_submit_custom_question_rejects_wrong_room_state(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r)  # never transitioned to CUSTOM_QUESTION_INPUT

    await _svc.handle_submit_custom_question(CODE, WRITER, {
        "question": "Q", "option_a": "A", "option_b": "B",
    })

    assert await r.hget(f"room:{CODE}", "state") == RoomState.TUTORIAL
    assert not captured


@pytest.mark.asyncio
async def test_submit_custom_question_rejects_incomplete_data(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _advance_to_custom_input(r)
    captured.clear()

    await _svc.handle_submit_custom_question(CODE, WRITER, {
        "question": "  ", "option_a": "A", "option_b": "B",
    })

    assert await r.hget(f"room:{CODE}", "state") == RoomState.CUSTOM_QUESTION_INPUT
    assert not captured


@pytest.mark.asyncio
async def test_submit_custom_question_works_for_minority_game(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await _seed_tutorial_room(r, game_id="minority")
    await _svc.handle_start_custom_question(CODE, ADMIN, WRITER)

    await _svc.handle_submit_custom_question(CODE, WRITER, {
        "question": "Cats or dogs?", "option_a": "Cats", "option_b": "Dogs",
    })

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PLAYING
    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert game_state_msgs[-1]["state"]["mode"] == "AGAINST"


# ---------------------------------------------------------------------------
# _build_room_state_payload: reconnecting mid-input needs writer_id
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_room_state_payload_includes_writer_id_during_custom_question_input(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await _advance_to_custom_input(r)

    payload = await _svc._build_room_state_payload(CODE, ADMIN)

    assert payload["state"] == RoomState.CUSTOM_QUESTION_INPUT
    assert payload["writer_id"] == WRITER


@pytest.mark.asyncio
async def test_room_state_payload_omits_writer_id_outside_custom_question_input(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await _seed_tutorial_room(r)

    payload = await _svc._build_room_state_payload(CODE, ADMIN)

    assert "writer_id" not in payload
