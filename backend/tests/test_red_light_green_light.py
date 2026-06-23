import math
import time
from unittest.mock import patch

import pytest

from app.games.red_light_green_light import (
    RedLightGreenLight,
    _compute_outcomes,
    _GREEN_MAX_MS,
    _GREEN_MIN_MS,
    _RED_TAP_CHASERS,
    _TIMEOUT_MS,
)

GAME = RedLightGreenLight()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAR_FUTURE = int(time.time() * 1000) + 60_000  # timeout 60s away — disabled
PAST = int(time.time() * 1000) - 1_000          # timeout already fired

EXECUTE_AT = int(time.time() * 1000) + 5_000    # green light 5 s from now


def _state(
    execute_at: int = EXECUTE_AT,
    clock_offsets: dict | None = None,
    taps: dict | None = None,
    timeout_at: int = FAR_FUTURE,
) -> dict:
    return {
        "execute_at": execute_at,
        "status": "RED",
        "taps": taps or {},
        "clock_offsets": clock_offsets or {"p1": 0, "p2": 0},
        "timeout_at": timeout_at,
    }


def _tap(player_id: str, local_ts: int) -> dict:
    return {"action": "tap", "local_ts": local_ts}


# ---------------------------------------------------------------------------
# get_initial_state
# ---------------------------------------------------------------------------

def test_initial_state_structure():
    players = [
        {"player_id": "p1", "clock_offset": 100},
        {"player_id": "p2", "clock_offset": -50},
    ]
    with patch("app.games.red_light_green_light.time") as mock_time:
        mock_time.time.return_value = 1_000.0
        state = GAME.get_initial_state(players)

    now_ms = 1_000_000
    assert _GREEN_MIN_MS <= state["execute_at"] - now_ms <= _GREEN_MAX_MS
    assert state["status"] == "RED"
    assert state["taps"] == {}
    assert state["clock_offsets"] == {"p1": 100, "p2": -50}
    assert state["timeout_at"] == state["execute_at"] + _TIMEOUT_MS


# ---------------------------------------------------------------------------
# handle_ws_event — red tap
# ---------------------------------------------------------------------------

def test_red_tap_gives_lose():
    state = _state(execute_at=EXECUTE_AT, clock_offsets={"p1": 0, "p2": 0})
    # p1 taps 1 s before green light
    new_state, finished, outcomes = GAME.handle_ws_event(
        "p1", _tap("p1", EXECUTE_AT - 1_000), state
    )
    assert new_state["taps"]["p1"] == "red"
    # game not done yet — p2 hasn't tapped
    assert not finished


def test_red_tap_outcome_is_lose_with_large_penalty():
    # Both players tap; p1 taps red, p2 taps valid → game ends after p2
    state = _state(execute_at=EXECUTE_AT, clock_offsets={"p1": 0, "p2": 0})
    state_after_p1, _, _ = GAME.handle_ws_event(
        "p1", _tap("p1", EXECUTE_AT - 500), state
    )
    _, finished, outcomes = GAME.handle_ws_event(
        "p2", _tap("p2", EXECUTE_AT + 300), state_after_p1
    )

    assert finished
    assert outcomes["p1"]["result"] == "LOSE"
    assert outcomes["p1"]["chasers"] == _RED_TAP_CHASERS
    assert outcomes["p1"]["reason"] == "early_tap"


# ---------------------------------------------------------------------------
# handle_ws_event — valid taps
# ---------------------------------------------------------------------------

def test_slowest_valid_tapper_loses():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 200), state)
    _, finished, outcomes = GAME.handle_ws_event(
        "p2", _tap("p2", EXECUTE_AT + 1_500), s1
    )

    assert finished
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["reason"] == "slowest"


def test_slowest_chasers_formula():
    # 1_500 ms delta → ceil(1500 / 500) = 3 chasers
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 200), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _tap("p2", EXECUTE_AT + 1_500), s1)

    assert outcomes["p2"]["chasers"] == 3


def test_fastest_valid_tapper_wins():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 100), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _tap("p2", EXECUTE_AT + 900), s1)

    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p1"]["chasers"] == 0


def test_clock_offset_applied_to_true_ts():
    # p1 has clock_offset=+200 ms (client clock is 200 ms ahead of server)
    # p1 sends local_ts = execute_at - 100; true_ts = execute_at + 100 → valid tap
    state = _state(clock_offsets={"p1": 200, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT - 100), state)
    assert s1["taps"]["p1"] != "red"


def test_game_not_finished_until_all_tap():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    new_state, finished, _ = GAME.handle_ws_event(
        "p1", _tap("p1", EXECUTE_AT + 200), state
    )
    assert not finished


def test_duplicate_tap_ignored():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 200), state)
    s2, finished, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 500), s1)
    # tap count should still be 1, game not done
    assert len(s2["taps"]) == 1
    assert not finished


def test_unknown_action_is_noop():
    state = _state()
    new_state, finished, outcomes = GAME.handle_ws_event(
        "p1", {"action": "shrug"}, state
    )
    assert new_state is state
    assert not finished
    assert outcomes == {}


# ---------------------------------------------------------------------------
# Timeout
# ---------------------------------------------------------------------------

def test_timeout_finishes_game_on_next_tap():
    # timeout_at is in the past → any tap should end the game
    state = _state(clock_offsets={"p1": 0, "p2": 0}, timeout_at=PAST)
    _, finished, outcomes = GAME.handle_ws_event(
        "p1", _tap("p1", EXECUTE_AT + 300), state
    )
    assert finished
    # p2 never tapped → gets max penalty
    assert outcomes["p2"]["result"] == "LOSE"


# ---------------------------------------------------------------------------
# _compute_outcomes unit tests
# ---------------------------------------------------------------------------

def test_compute_outcomes_all_red():
    taps = {"p1": "red", "p2": "red"}
    outcomes = _compute_outcomes(taps, EXECUTE_AT, {"p1": 0, "p2": 0})
    assert all(o["result"] == "LOSE" for o in outcomes.values())


def test_compute_outcomes_score_delta_matches_chasers():
    taps = {"p1": EXECUTE_AT + 1_000, "p2": EXECUTE_AT + 2_000}
    outcomes = _compute_outcomes(taps, EXECUTE_AT, {"p1": 0, "p2": 0})
    for pid, o in outcomes.items():
        assert o["score_delta"] == o["chasers"]
