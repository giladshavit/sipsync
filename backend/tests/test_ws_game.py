"""
Tests for GAME_ACTION routing.

Strategy: patch module-level `redis` and `load_game` in room_service + fsm,
replace `room_service.broadcast` with a list-capturing async stub, and reset
the per-room lock dict between tests.
"""
import asyncio
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.base import BaseMiniGame
from app.engine.deck import deck as deck_singleton
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


class _TimedGame(BaseMiniGame):
    """Minimal game with a per-round `timeout_at`, for exercising the
    room_service background timeout task directly (see the stale-task
    regression tests below)."""
    game_id = "test_timed"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {
            "status": "PLAYING",
            "taps": {},
            "clock_offsets": {p["player_id"]: 0 for p in players},
            "timeout_at": 0,
        }

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        if current_state.get("status") != "PLAYING":
            return current_state, False, {}
        new_state = {**current_state, "status": "DONE"}
        return new_state, True, {player_id: {"score_delta": 1}}

    def on_timeout(self, current_state: dict) -> tuple:
        if current_state.get("status") == "DONE":
            return current_state, {}
        return {**current_state, "status": "DONE"}, {"auto": {"score_delta": -1}}


class _QuestionGame(BaseMiniGame):
    """Minimal stand-in for majority.py's no-repeat question pool: reads the
    `asked_questions` set room_service injects, always picks the first
    still-available entry (deterministic, so tests don't need real
    randomness), and sets `reset_question_cycle` once the 2-question pool is
    exhausted — for exercising room_service.handle_tutorial_done's Redis-side
    pool bookkeeping directly."""

    game_id = "test_question"
    tutorial_type = "timed_text"
    tutorial_asset = "test"
    POOL = ["Q1", "Q2"]

    def get_initial_state(self, players: list) -> dict:
        asked = players[0].get("asked_questions", set()) if players else set()
        available = [q for q in self.POOL if q not in asked]
        reset = not available
        pick = (available or self.POOL)[0]
        return {
            "current_question": pick,
            "reset_question_cycle": reset,
            "taps": {},
            "clock_offsets": {p["player_id"]: 0 for p in players},
            "timeout_at": 0,
        }

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        return current_state, False, {}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

CODE = "TSTCD"
PLAYER = "player-uuid-1"
ADMIN = "admin-uuid"

_svc = rs_module.room_service


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    """Replace redis in room_service + fsm with a shared fakeredis; capture broadcasts."""
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)
    # Up Next preview: handle_goto_podium / _summary_timeout now peek the
    # deck via the module-level `deck` singleton, which binds its own real
    # Redis client independent of rs_module's — same reasoning as
    # test_avatar.py/test_late_join.py's own patch of it.
    monkeypatch.setattr(deck_singleton, "_redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(rs_module, "load_game", lambda _: _CountdownGame())

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

    await _svc._handle_game_action(CODE, PLAYER, {})

    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert len(game_state_msgs) == 1
    assert game_state_msgs[0]["state"] == {"remaining": 1}


@pytest.mark.asyncio
async def test_game_action_persists_state_to_redis(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER, {})

    raw = await r.get(f"room:{CODE}:game")
    assert json.loads(raw) == {"remaining": 1}


@pytest.mark.asyncio
async def test_finished_game_outcomes_include_total_score(playing_room, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast

    # Two actions finish the countdown game
    await _svc._handle_game_action(CODE, PLAYER, {})
    await _svc._handle_game_action(CODE, PLAYER, {})

    outcomes_msgs = [m for m in captured if m["type"] == "OUTCOMES"]
    assert len(outcomes_msgs) == 1
    player_outcome = outcomes_msgs[0]["outcomes"][PLAYER]
    assert "total_score" in player_outcome
    assert player_outcome["total_score"] == 15  # 10 base + 5 delta


@pytest.mark.asyncio
async def test_finished_game_persists_updated_score(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER, {})
    await _svc._handle_game_action(CODE, PLAYER, {})

    raw = await r.hget(f"room:{CODE}:players", PLAYER)
    assert json.loads(raw)["score"] == 15


@pytest.mark.asyncio
async def test_finished_game_transitions_fsm_to_personal_summary(playing_room, patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER, {})
    await _svc._handle_game_action(CODE, PLAYER, {})

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

    await _svc._handle_game_action(CODE, PLAYER, {})

    assert not any(m["type"] == "GAME_STATE" for m in captured)


@pytest.mark.asyncio
async def test_concurrent_actions_are_serialised(playing_room, patch_redis_and_broadcast):
    """Two simultaneous GAME_ACTION calls must not interleave state reads/writes."""
    r, _ = patch_redis_and_broadcast

    # Run two actions concurrently; the countdown starts at 2 so both will
    # process — but only the second (serial) one should see remaining==0.
    await asyncio.gather(
        _svc._handle_game_action(CODE, PLAYER, {}),
        _svc._handle_game_action(CODE, PLAYER, {}),
    )

    raw = await r.get(f"room:{CODE}:game")
    # After two serial decrements the counter must be exactly 0, never negative.
    assert json.loads(raw) == {"remaining": 0}


# ---------------------------------------------------------------------------
# _game_timeout: stale background task must not resolve a newer round
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_timeout_task_resolves_its_own_round(patch_redis_and_broadcast, monkeypatch):
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "load_game", lambda _: _TimedGame())

    timeout_at = 1_000
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": ADMIN,
        "active_game": "test_timed",
    })
    await r.hset(f"room:{CODE}:players", PLAYER, json.dumps({
        "display_name": "Alice", "score": 0, "clock_offset": 0,
    }))
    await r.set(f"room:{CODE}:game", json.dumps({
        "status": "PLAYING", "taps": {}, "clock_offsets": {PLAYER: 0}, "timeout_at": timeout_at,
    }))

    await _svc._game_timeout(CODE, timeout_at)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PERSONAL_SUMMARY
    assert any(m["type"] == "OUTCOMES" for m in captured)


@pytest.mark.asyncio
async def test_stale_timeout_task_does_not_resolve_a_newer_round(
    patch_redis_and_broadcast, monkeypatch
):
    """Regression: a background timeout task scheduled for round 1 must not
    force-finish round 2 if it wakes up after round 2 has already started —
    this is what made coin_flip appear to 'auto-guess' for players before
    its 20 s vote window ended."""
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "load_game", lambda _: _TimedGame())

    round1_timeout_at = 1_000
    round2_timeout_at = 2_000

    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": ADMIN,
        "active_game": "test_timed",
    })
    await r.hset(f"room:{CODE}:players", PLAYER, json.dumps({
        "display_name": "Alice", "score": 0, "clock_offset": 0,
    }))
    # Round 2 is already live by the time round 1's stale task wakes up
    round2_state = {
        "status": "PLAYING",
        "taps": {},
        "clock_offsets": {PLAYER: 0},
        "timeout_at": round2_timeout_at,
    }
    await r.set(f"room:{CODE}:game", json.dumps(round2_state))

    await _svc._game_timeout(CODE, round1_timeout_at)

    # Round 2 must be completely untouched: still PLAYING, state unchanged,
    # and nothing broadcast on its behalf
    assert await r.hget(f"room:{CODE}", "state") == RoomState.PLAYING
    raw = await r.get(f"room:{CODE}:game")
    assert json.loads(raw) == round2_state
    assert not any(m["type"] == "OUTCOMES" for m in captured)
    assert not any(m["type"] == "GAME_STATE" for m in captured)


# ---------------------------------------------------------------------------
# handle_goto_podium: any player (not just admin) can advance the room
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_goto_podium_from_non_admin_player_advances_the_room(patch_redis_and_broadcast):
    """Regression for the original bug: the transition must not depend on
    specifically the admin's client — any player's signal is enough."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PERSONAL_SUMMARY,
        "admin_id": ADMIN,
    })

    await _svc.handle_goto_podium(CODE, PLAYER)  # PLAYER is not ADMIN

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PODIUM
    fsm_msgs = [m for m in captured if m["type"] == "FSM_TRANSITION"]
    assert any(m["new_state"] == RoomState.PODIUM for m in fsm_msgs)


@pytest.mark.asyncio
async def test_second_goto_podium_call_is_a_harmless_noop(patch_redis_and_broadcast):
    """Every client sends this once its own local lock expires — the first
    one to arrive wins, the rest must not error or double-broadcast."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PERSONAL_SUMMARY,
        "admin_id": ADMIN,
    })

    await _svc.handle_goto_podium(CODE, ADMIN)
    await _svc.handle_goto_podium(CODE, PLAYER)  # arrives after the room already moved on

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PODIUM
    podium_msgs = [m for m in captured if m.get("new_state") == RoomState.PODIUM]
    assert len(podium_msgs) == 1


# ---------------------------------------------------------------------------
# _summary_timeout: generous last-resort safety net for PERSONAL_SUMMARY ->
# PODIUM, only relevant if every client fails to send GOTO_PODIUM
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_summary_timeout_advances_to_podium(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PERSONAL_SUMMARY,
        "admin_id": ADMIN,
    })

    await _svc._summary_timeout(CODE, safety_net_at=1_000)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.PODIUM
    fsm_msgs = [m for m in captured if m["type"] == "FSM_TRANSITION"]
    assert any(m["new_state"] == RoomState.PODIUM for m in fsm_msgs)


@pytest.mark.asyncio
async def test_summary_timeout_noop_if_room_already_moved_on(patch_redis_and_broadcast):
    """Regression, same shape as the stale game-timeout case above: if the
    room already left PERSONAL_SUMMARY (via a client's GOTO_PODIUM, or
    dissolution) before this task's sleep elapsed, it must not force a
    transition."""
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.LOBBY,
        "admin_id": ADMIN,
    })

    await _svc._summary_timeout(CODE, safety_net_at=1_000)

    assert await r.hget(f"room:{CODE}", "state") == RoomState.LOBBY
    assert not any(m["type"] == "FSM_TRANSITION" for m in captured)
    assert not any(m["type"] == "GAME_STATE" for m in captured)


# ---------------------------------------------------------------------------
# handle_tutorial_done: per-room no-repeat question pool. _QuestionGame
# (POOL = ["Q1", "Q2"]) always picks the first still-available entry, so
# these tests exercise room_service's Redis-side bookkeeping directly rather
# than randomness — the actual selection logic is majority.py's own concern,
# already covered in test_majority.py / test_minority.py.
# ---------------------------------------------------------------------------

async def _start_tutorial_room(r) -> None:
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.TUTORIAL,
        "admin_id": ADMIN,
        "active_game": "test_question",
    })
    await r.hset(f"room:{CODE}:players", PLAYER, json.dumps({
        "display_name": "Alice",
        "score": 0,
        "clock_offset": 0,
    }))


@pytest.mark.asyncio
async def test_first_round_records_its_question_in_the_room_pool(
    patch_redis_and_broadcast, monkeypatch
):
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "load_game", lambda _: _QuestionGame())
    await _start_tutorial_room(r)

    await _svc.handle_tutorial_done(CODE, ADMIN)

    game_state_msgs = [m for m in captured if m["type"] == "GAME_STATE"]
    assert len(game_state_msgs) == 1
    state = game_state_msgs[0]["state"]
    assert state["current_question"] == "Q1"
    # Internal signal must never leak into the persisted/broadcast state
    assert "reset_question_cycle" not in state
    assert await r.smembers(f"room:{CODE}:asked_questions") == {"Q1"}


@pytest.mark.asyncio
async def test_second_round_in_the_same_room_excludes_the_first_question(
    patch_redis_and_broadcast, monkeypatch
):
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "load_game", lambda _: _QuestionGame())
    await _start_tutorial_room(r)

    await _svc.handle_tutorial_done(CODE, ADMIN)  # round 1 -> "Q1"
    await r.hset(f"room:{CODE}", "state", RoomState.TUTORIAL)  # simulate NEXT_ROUND's re-entry
    captured.clear()
    await _svc.handle_tutorial_done(CODE, ADMIN)  # round 2

    state = [m for m in captured if m["type"] == "GAME_STATE"][0]["state"]
    assert state["current_question"] == "Q2"
    assert await r.smembers(f"room:{CODE}:asked_questions") == {"Q1", "Q2"}


@pytest.mark.asyncio
async def test_pool_exhaustion_resets_the_room_cycle(
    patch_redis_and_broadcast, monkeypatch
):
    r, captured = patch_redis_and_broadcast
    monkeypatch.setattr(rs_module, "load_game", lambda _: _QuestionGame())
    await _start_tutorial_room(r)

    await _svc.handle_tutorial_done(CODE, ADMIN)  # round 1 -> "Q1"
    await r.hset(f"room:{CODE}", "state", RoomState.TUTORIAL)
    await _svc.handle_tutorial_done(CODE, ADMIN)  # round 2 -> "Q2", pool now exhausted

    await r.hset(f"room:{CODE}", "state", RoomState.TUTORIAL)
    captured.clear()
    await _svc.handle_tutorial_done(CODE, ADMIN)  # round 3 -> fresh cycle

    state = [m for m in captured if m["type"] == "GAME_STATE"][0]["state"]
    # Fresh cycle: the pool was cleared and this round's own pick re-seeds it
    assert state["current_question"] == "Q1"
    assert await r.smembers(f"room:{CODE}:asked_questions") == {"Q1"}
