"""
Regression tests for Late Join: a brand-new player connecting while a round
is already underway (TUTORIAL or PLAYING) is added to the roster immediately
at 0 score, flagged `waiting_for_next_game`, excluded from that round's
initial state (handle_tutorial_done), and promoted back to a full
participant once the round they missed ends (_enrich_scores_and_broadcast).

Strategy mirrors test_ws_game.py: patch module-level `redis` in room_service
+ fsm with a shared fakeredis, replace `room_service.broadcast` with a
list-capturing stub, and reset the per-room lock dict between tests.
"""
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.base import BaseMiniGame
from app.engine.deck import deck
from app.engine.fsm import RoomState

CODE = "TSTCD"
ADMIN = "admin-uuid"
EARLY_PLAYER = "early-player-uuid"
LATE_PLAYER = "late-player-uuid"

_svc = rs_module.room_service


class _RosterRecordingGame(BaseMiniGame):
    """Records exactly which player ids it was initialized with — lets tests
    assert a late joiner was excluded from the round's initial state without
    depending on any particular mini-game's own scoring logic."""
    game_id = "test_roster"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {"player_ids": [p["player_id"] for p in players]}

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        remaining = current_state.get("player_ids", [])
        outcomes = {pid: {"score_delta": 5} for pid in remaining}
        return current_state, True, outcomes


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)
    # handle_handshake's ROOM_STATE snapshot reads the deck via the
    # module-level `deck` singleton directly — it binds its own real Redis
    # client at import time, so it needs patching separately.
    monkeypatch.setattr(deck, "_redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(rs_module, "load_game", lambda _: _RosterRecordingGame())
    monkeypatch.setattr(_svc, "_room_locks", {})
    monkeypatch.setattr(_svc, "_connections", {})

    return r, captured


def _player_json(**overrides) -> str:
    base = {"display_name": "P", "score": 0, "clock_offset": 0, "avatar": None}
    base.update(overrides)
    return json.dumps(base)


class _FakeWebSocket:
    async def send_text(self, _text: str) -> None:
        pass


async def _handshake(r, player_id: str, display_name: str = "New Player") -> dict:
    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": player_id,
        "display_name": display_name,
        "local_ts": 0,
    })
    raw = await r.hget(f"room:{CODE}:players", player_id)
    return json.loads(raw)


@pytest.mark.parametrize("state", [RoomState.TUTORIAL, RoomState.PLAYING])
async def test_new_player_joining_mid_round_is_flagged_waiting(patch_redis_and_broadcast, state):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": state, "admin_id": ADMIN})

    player = await _handshake(r, LATE_PLAYER)

    assert player["waiting_for_next_game"] is True
    assert player["score"] == 0


async def test_new_player_joining_lobby_is_not_flagged_waiting(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.LOBBY, "admin_id": ADMIN})

    player = await _handshake(r, LATE_PLAYER)

    assert player["waiting_for_next_game"] is False


async def test_existing_players_reconnect_mid_playing_is_not_flagged_waiting(patch_redis_and_broadcast):
    """An existing participant (e.g. the admin, reconnecting mid-round per
    Host Migration) must never be retroactively treated as a late joiner
    just because the room happens to be PLAYING right now."""
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PLAYING, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", ADMIN, _player_json(score=15))

    player = await _handshake(r, ADMIN, display_name="Admin")

    assert player["waiting_for_next_game"] is False
    assert player["score"] == 15  # untouched, same reconnect path as before


async def test_reconnect_while_still_waiting_preserves_the_flag(patch_redis_and_broadcast):
    """A late joiner's own screen-transition reconnect (or any reconnect)
    while the round they missed is still going must keep them waiting — it
    must not re-derive the flag fresh from "is state currently mid-round,"
    which would just re-flag them identically, but for the wrong reason and
    fragile against future state changes."""
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={"state": RoomState.PLAYING, "admin_id": ADMIN})
    await r.hset(f"room:{CODE}:players", LATE_PLAYER, _player_json(waiting_for_next_game=True))

    player = await _handshake(r, LATE_PLAYER)

    assert player["waiting_for_next_game"] is True


async def test_late_joiner_excluded_from_the_round_they_joined_mid(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.TUTORIAL,
        "admin_id": ADMIN,
        "active_game": "test_roster",
    })
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(),
        EARLY_PLAYER: _player_json(),
    })
    # Late joiner arrives mid-TUTORIAL, before TUTORIAL_DONE fires.
    await _handshake(r, LATE_PLAYER)

    await _svc.handle_tutorial_done(CODE, ADMIN)

    game_state = json.loads(await r.get(f"room:{CODE}:game"))
    assert sorted(game_state["player_ids"]) == sorted([ADMIN, EARLY_PLAYER])
    assert LATE_PLAYER not in game_state["player_ids"]


async def test_late_joiner_flag_cleared_once_the_round_ends(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.TUTORIAL,
        "admin_id": ADMIN,
        "active_game": "test_roster",
    })
    await r.hset(f"room:{CODE}:players", mapping={
        ADMIN: _player_json(),
        EARLY_PLAYER: _player_json(),
    })
    await _handshake(r, LATE_PLAYER)
    await _svc.handle_tutorial_done(CODE, ADMIN)  # round starts without LATE_PLAYER

    # The round finishes (via _RosterRecordingGame's handle_ws_event, which
    # awards every *participating* player an outcome — LATE_PLAYER was never
    # in player_ids, so never gets one).
    await _svc.handle_game_action(CODE, ADMIN, {})

    late_player_raw = await r.hget(f"room:{CODE}:players", LATE_PLAYER)
    assert json.loads(late_player_raw)["waiting_for_next_game"] is False

    outcomes_msgs = [m for m in captured if m["type"] == "OUTCOMES"]
    assert len(outcomes_msgs) == 1
    assert LATE_PLAYER not in outcomes_msgs[0]["outcomes"]


def test_select_new_admin_prefers_fully_active_over_waiting_or_disconnected():
    players_raw = {
        "waiting": _player_json(connected=True, waiting_for_next_game=True),
        "disconnected": _player_json(connected=False, waiting_for_next_game=False),
        "fully_active": _player_json(connected=True, waiting_for_next_game=False),
    }
    assert rs_module._select_new_admin(players_raw) == "fully_active"


def test_select_new_admin_falls_back_to_connected_waiting_player_if_no_one_else():
    players_raw = {
        "waiting": _player_json(connected=True, waiting_for_next_game=True),
        "disconnected": _player_json(connected=False, waiting_for_next_game=False),
    }
    assert rs_module._select_new_admin(players_raw) == "waiting"
