import time
from unittest.mock import patch

from app.games.strong_point import (
    StrongPointGame,
    _compute_outcomes,
    _ACTIVATE_DELAY_MS,
    _GROW_MS,
    _TIMEOUT_MS,
)

GAME = StrongPointGame()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAR_FUTURE = int(time.time() * 1000) + 60_000  # timeout 60s away — disabled
PAST = int(time.time() * 1000) - 1_000          # timeout already fired

ACTIVATE_AT = int(time.time() * 1000) + 5_000   # zone activates 5 s from now


def _state(
    activate_at: int = ACTIVATE_AT,
    clock_offsets: dict | None = None,
    taps: dict | None = None,
    timeout_at: int = FAR_FUTURE,
) -> dict:
    return {
        "status": "PENDING",
        "activate_at": activate_at,
        "target": {"nx": 0.5, "ny": 0.5},
        "target_diameter_px": 40,
        "grow_duration_ms": _GROW_MS,
        "taps": taps or {},
        "clock_offsets": clock_offsets or {"p1": 0, "p2": 0},
        "timeout_at": timeout_at,
    }


def _click(local_ts: int) -> dict:
    return {"action": "CLICK", "local_ts": local_ts}


def _miss() -> dict:
    return {"action": "MISS"}


# ---------------------------------------------------------------------------
# get_initial_state
# ---------------------------------------------------------------------------

def test_initial_state_structure():
    players = [
        {"player_id": "p1", "clock_offset": 100},
        {"player_id": "p2", "clock_offset": -50},
    ]
    with patch("app.games.strong_point.time") as mock_time:
        mock_time.time.return_value = 1_000.0
        state = GAME.get_initial_state(players)

    now_ms = 1_000_000
    assert state["activate_at"] == now_ms + _ACTIVATE_DELAY_MS
    assert state["status"] == "PENDING"
    assert state["taps"] == {}
    assert state["clock_offsets"] == {"p1": 100, "p2": -50}
    assert state["timeout_at"] == state["activate_at"] + _TIMEOUT_MS
    assert 0.0 <= state["target"]["nx"] <= 1.0
    assert 0.0 <= state["target"]["ny"] <= 1.0
    assert state["target_diameter_px"] == 40
    assert state["grow_duration_ms"] == _GROW_MS


# ---------------------------------------------------------------------------
# handle_ws_event — MISS
# ---------------------------------------------------------------------------

def test_miss_gives_lose():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    new_state, finished, outcomes = GAME.handle_ws_event("p1", _miss(), state)
    assert new_state["taps"]["p1"] == "missed"
    assert not finished  # p2 hasn't reported yet


def test_miss_outcome_is_lose_with_flat_penalty():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    state_after_p1, _, _ = GAME.handle_ws_event("p1", _miss(), state)
    _, finished, outcomes = GAME.handle_ws_event(
        "p2", _click(ACTIVATE_AT + 300), state_after_p1
    )

    assert finished
    assert outcomes["p1"]["result"] == "LOSE"
    assert outcomes["p1"]["chasers"] == 1
    assert outcomes["p1"]["score_delta"] == -10
    assert outcomes["p1"]["reason"] == "missed"


# ---------------------------------------------------------------------------
# handle_ws_event — early CLICK
# ---------------------------------------------------------------------------

def test_early_click_gives_lose():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    new_state, _, _ = GAME.handle_ws_event(
        "p1", _click(ACTIVATE_AT - 1_000), state
    )
    assert new_state["taps"]["p1"] == "early"


def test_early_click_outcome_is_lose_with_flat_penalty():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    state_after_p1, _, _ = GAME.handle_ws_event(
        "p1", _click(ACTIVATE_AT - 500), state
    )
    _, finished, outcomes = GAME.handle_ws_event(
        "p2", _click(ACTIVATE_AT + 300), state_after_p1
    )

    assert finished
    assert outcomes["p1"]["result"] == "LOSE"
    assert outcomes["p1"]["chasers"] == 1
    assert outcomes["p1"]["score_delta"] == -10
    assert outcomes["p1"]["reason"] == "early_tap"


# ---------------------------------------------------------------------------
# handle_ws_event — valid clicks
# ---------------------------------------------------------------------------

def test_slowest_valid_clicker_loses():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT + 200), state)
    _, finished, outcomes = GAME.handle_ws_event(
        "p2", _click(ACTIVATE_AT + 1_500), s1
    )

    assert finished
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["reason"] == "slowest"


def test_slowest_gets_flat_one_chaser_and_minus_ten():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT + 200), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _click(ACTIVATE_AT + 1_500), s1)

    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p2"]["score_delta"] == -10


def test_fastest_valid_clicker_wins():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT + 100), state)
    _, _, outcomes = GAME.handle_ws_event("p2", _click(ACTIVATE_AT + 900), s1)

    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p1"]["chasers"] == 0
    assert outcomes["p1"]["score_delta"] == 10


def test_clock_offset_applied_to_true_ts():
    # p1 has clock_offset=+200 ms (client clock is 200 ms ahead of server)
    # p1 sends local_ts = activate_at - 100; true_ts = activate_at + 100 → valid
    state = _state(clock_offsets={"p1": 200, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT - 100), state)
    assert s1["taps"]["p1"] != "early"


def test_game_not_finished_until_all_report():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    _, finished, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT + 200), state)
    assert not finished


def test_duplicate_report_ignored():
    state = _state(clock_offsets={"p1": 0, "p2": 0})
    s1, _, _ = GAME.handle_ws_event("p1", _click(ACTIVATE_AT + 200), state)
    s2, finished, _ = GAME.handle_ws_event("p1", _miss(), s1)
    # first report wins; tap count should still be 1, game not done
    assert len(s2["taps"]) == 1
    assert s2["taps"]["p1"] != "missed"
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

def test_timeout_finishes_game_on_next_report():
    # timeout_at is in the past → any report should end the game
    state = _state(clock_offsets={"p1": 0, "p2": 0}, timeout_at=PAST)
    _, finished, outcomes = GAME.handle_ws_event(
        "p1", _click(ACTIVATE_AT + 300), state
    )
    assert finished
    # p2 never reported → flat timeout penalty
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["reason"] == "timed_out"
    assert outcomes["p2"]["score_delta"] == -10
    # p1 made the only valid click → automatic win
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p1"]["reason"] == "only_valid"
    assert outcomes["p1"]["score_delta"] == 10


def test_on_timeout_direct_call():
    taps = {"p1": ACTIVATE_AT + 500}
    state = _state(clock_offsets={"p1": 0, "p2": 0}, taps=taps)
    new_state, outcomes = GAME.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p2"]["reason"] == "timed_out"
    assert outcomes["p1"]["result"] == "WIN"


# ---------------------------------------------------------------------------
# _compute_outcomes unit tests
# ---------------------------------------------------------------------------

def test_compute_outcomes_all_missed():
    taps = {"p1": "missed", "p2": "missed"}
    outcomes = _compute_outcomes(taps, ACTIVATE_AT, {"p1": 0, "p2": 0})
    assert all(o["result"] == "LOSE" for o in outcomes.values())
    assert all(o["score_delta"] == -10 for o in outcomes.values())


def test_compute_outcomes_uniform_score_distribution():
    taps = {
        "p1": ACTIVATE_AT + 1_000,
        "p2": ACTIVATE_AT + 2_000,
        "p3": ACTIVATE_AT + 1_500,
    }
    outcomes = _compute_outcomes(taps, ACTIVATE_AT, {"p1": 0, "p2": 0, "p3": 0})
    # Scores spread evenly by reaction time: fastest +10, middle 0, slowest -10
    assert outcomes["p1"]["score_delta"] == 10
    assert outcomes["p3"]["score_delta"] == 0
    assert outcomes["p2"]["score_delta"] == -10
    # Only the slowest clicker loses and drinks
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p3"]["result"] == "WIN"


def test_compute_outcomes_disqualified_share_last_place():
    # p4 misses, p5 taps early, p6 never reports — all take last place (-10)
    # while the slowest valid clicker keeps their mid-table rank score
    taps = {
        "p1": ACTIVATE_AT + 1_000,
        "p2": ACTIVATE_AT + 2_000,
        "p3": ACTIVATE_AT + 1_500,
        "p4": "missed",
        "p5": "early",
    }
    offsets = {"p1": 0, "p2": 0, "p3": 0, "p4": 0, "p5": 0, "p6": 0}
    outcomes = _compute_outcomes(taps, ACTIVATE_AT, offsets)
    assert outcomes["p4"]["score_delta"] == -10
    assert outcomes["p4"]["reason"] == "missed"
    assert outcomes["p5"]["score_delta"] == -10
    assert outcomes["p5"]["reason"] == "early_tap"
    assert outcomes["p6"]["score_delta"] == -10
    assert outcomes["p6"]["reason"] == "timed_out"
    # 6 players → interval 4: valid clicks rank 1st/2nd/3rd → 10, 6, 2
    assert outcomes["p1"]["score_delta"] == 10
    assert outcomes["p3"]["score_delta"] == 6
    assert outcomes["p2"]["score_delta"] == 2
