import time
from unittest.mock import patch


from app.games.reflex import (
    ReflexGame,
    _compute_outcomes,
    _GREEN_MAX_MS,
    _GREEN_MIN_MS,
    _TIMEOUT_MS,
)

GAME = ReflexGame()

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
    with patch("app.games.reflex.time") as mock_time:
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


def test_red_tap_outcome_is_lose_with_flat_penalty():
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
    assert outcomes["p1"]["chasers"] == 1
    assert outcomes["p1"]["score_delta"] == -10
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


def test_slowest_gets_flat_one_chaser_and_minus_ten():
    # Chasers are flat — margin of defeat doesn't matter
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 200), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _tap("p2", EXECUTE_AT + 1_500), s1)

    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p2"]["score_delta"] == -10


def test_fastest_valid_tapper_wins():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _tap("p1", EXECUTE_AT + 100), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _tap("p2", EXECUTE_AT + 900), s1)

    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p1"]["chasers"] == 0
    assert outcomes["p1"]["score_delta"] == 10


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
    # p2 never tapped → flat timeout penalty
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["reason"] == "timed_out"
    assert outcomes["p2"]["score_delta"] == -10
    # p1 made the only valid green tap → automatic win
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p1"]["reason"] == "only_valid"
    assert outcomes["p1"]["score_delta"] == 10


# ---------------------------------------------------------------------------
# _compute_outcomes unit tests
# ---------------------------------------------------------------------------

def test_compute_outcomes_all_red():
    taps = {"p1": "red", "p2": "red"}
    outcomes = _compute_outcomes(taps, EXECUTE_AT, {"p1": 0, "p2": 0})
    assert all(o["result"] == "LOSE" for o in outcomes.values())
    assert all(o["score_delta"] == -10 for o in outcomes.values())


def test_compute_outcomes_uniform_score_distribution():
    taps = {
        "p1": EXECUTE_AT + 1_000,
        "p2": EXECUTE_AT + 2_000,
        "p3": EXECUTE_AT + 1_500,
    }
    outcomes = _compute_outcomes(taps, EXECUTE_AT, {"p1": 0, "p2": 0, "p3": 0})
    # Scores spread evenly by reaction time: fastest +10, middle 0, slowest -10
    assert outcomes["p1"]["score_delta"] == 10
    assert outcomes["p3"]["score_delta"] == 0
    assert outcomes["p2"]["score_delta"] == -10
    # Only the slowest tapper loses and drinks
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p3"]["result"] == "WIN"


def test_compute_outcomes_disqualified_share_last_place():
    # p4 taps red, p5 never taps — both take last place (-10) while the
    # slowest valid tapper keeps their mid-table rank score
    taps = {
        "p1": EXECUTE_AT + 1_000,
        "p2": EXECUTE_AT + 2_000,
        "p3": EXECUTE_AT + 1_500,
        "p4": "red",
    }
    offsets = {"p1": 0, "p2": 0, "p3": 0, "p4": 0, "p5": 0}
    outcomes = _compute_outcomes(taps, EXECUTE_AT, offsets)
    assert outcomes["p4"]["score_delta"] == -10
    assert outcomes["p5"]["score_delta"] == -10
    # 5 players → interval 5: valid taps rank 1st/2nd/3rd → 10, 5, 0
    assert outcomes["p1"]["score_delta"] == 10
    assert outcomes["p3"]["score_delta"] == 5
    assert outcomes["p2"]["score_delta"] == 0
