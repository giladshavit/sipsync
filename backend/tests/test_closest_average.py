from typing import Any

import pytest

from app.games import closest_average
from app.games.closest_average import ClosestAverageGame


class StubRng:
    """Deterministic stand-in for the module RNG — always returns 42."""

    def randint(self, a: int, b: int) -> int:
        return 42


def _players(n: int = 3) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng()
    monkeypatch.setattr(closest_average, "_rng", rng)
    return rng


@pytest.fixture
def game() -> ClosestAverageGame:
    return ClosestAverageGame()


def _initial(game: ClosestAverageGame, n: int = 3) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def _submit(
    game: ClosestAverageGame, state: dict[str, Any], player_id: str, number: Any
) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
    return game.handle_ws_event(
        player_id, {"action": "SUBMIT_NUMBER", "number": number}, state
    )


def test_initial_state_shape(game: ClosestAverageGame) -> None:
    state = _initial(game)
    assert state["status"] == "PLAYING"
    assert state["numbers"] == {}
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2"}
    assert state["deadline_at"] > 0
    assert state["timeout_at"] > state["deadline_at"]  # grace for a client's own auto-submit


def test_double_submit_is_ignored(game: ClosestAverageGame) -> None:
    state = _initial(game)
    state, _, _ = _submit(game, state, "p0", 10)
    new_state, finished, _ = _submit(game, state, "p0", 90)
    assert new_state == state and not finished
    assert new_state["numbers"]["p0"] == 10


@pytest.mark.parametrize("raw,expected", [(-5, 0), (500, 99), (None, 0), ("nope", 0)])
def test_invalid_or_out_of_range_number_clamps(
    game: ClosestAverageGame, raw: Any, expected: int
) -> None:
    state = _initial(game)
    new_state, _, _ = _submit(game, state, "p0", raw)
    assert new_state["numbers"]["p0"] == expected


def test_normal_round_scores_closest_and_farthest(game: ClosestAverageGame) -> None:
    state = _initial(game)  # p0, p1, p2
    state, finished, _ = _submit(game, state, "p0", 0)
    assert not finished
    state, finished, _ = _submit(game, state, "p1", 50)
    assert not finished
    new_state, finished, outcomes = _submit(game, state, "p2", 99)
    assert finished
    assert new_state["status"] == "DONE"

    # average = 149/3 = 49.667: p1 closest (0.333), p2 middle (49.333),
    # p0 farthest (49.667)
    assert outcomes["p1"] == {
        "result": "WIN",
        "chasers": 0,
        "reason": "closest",
        "score_delta": 10,
        "number": 50,
        "average": 49.7,
        "distance": 0.3,
        "auto_picked": False,
    }
    assert outcomes["p2"] == {
        "result": "SAFE",
        "chasers": 0,
        "reason": "kept_pace",
        "score_delta": 0,
        "number": 99,
        "average": 49.7,
        "distance": 49.3,
        "auto_picked": False,
    }
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 1,
        "reason": "farthest",
        "score_delta": -10,
        "number": 0,
        "average": 49.7,
        "distance": 49.7,
        "auto_picked": False,
    }


def test_tied_farthest_players_share_the_last_place(game: ClosestAverageGame) -> None:
    state = _initial(game)
    state, _, _ = _submit(game, state, "p0", 10)
    state, _, _ = _submit(game, state, "p1", 50)
    new_state, finished, outcomes = _submit(game, state, "p2", 90)
    assert finished
    assert outcomes["p1"]["result"] == "WIN"
    assert outcomes["p0"]["result"] == "LOSE"
    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p0"]["score_delta"] == outcomes["p2"]["score_delta"] == 0


def test_two_players_are_always_a_dead_heat(game: ClosestAverageGame) -> None:
    state = _initial(game, n=2)
    state, _, _ = _submit(game, state, "p0", 20)
    new_state, finished, outcomes = _submit(game, state, "p1", 80)
    assert finished
    for pid in ("p0", "p1"):
        assert outcomes[pid]["result"] == "SAFE"
        assert outcomes[pid]["chasers"] == 0
        assert outcomes[pid]["reason"] == "dead_heat"


def test_timeout_auto_fills_missing_players(game: ClosestAverageGame) -> None:
    state = _initial(game)
    state, _, _ = _submit(game, state, "p0", 10)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert new_state["numbers"]["p1"] == 42
    assert new_state["numbers"]["p2"] == 42
    assert outcomes["p1"]["auto_picked"] is True
    assert outcomes["p2"]["auto_picked"] is True
    assert outcomes["p0"]["auto_picked"] is False


def test_timeout_with_nobody_submitted_still_resolves(game: ClosestAverageGame) -> None:
    state = _initial(game)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert set(new_state["numbers"].values()) == {42}
    for pid in ("p0", "p1", "p2"):
        assert outcomes[pid]["auto_picked"] is True
        assert outcomes[pid]["result"] == "SAFE"
        assert outcomes[pid]["reason"] == "dead_heat"

