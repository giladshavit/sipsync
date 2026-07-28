from typing import Any

import pytest

from app.games import twenty_one
from app.games.twenty_one import TwentyOneGame


class StubRng:
    """Deterministic stand-in for the module RNG: shuffle is a no-op, so
    turn_order always matches input order."""

    def shuffle(self, seq: list) -> None:
        pass


def _players(n: int = 3) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng()
    monkeypatch.setattr(twenty_one, "_rng", rng)
    return rng


@pytest.fixture
def game() -> TwentyOneGame:
    return TwentyOneGame()


def _initial(game: TwentyOneGame, n: int = 3) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def test_initial_state_shape(game: TwentyOneGame) -> None:
    state = _initial(game)
    assert state["status"] == "PLAYING"
    assert state["count"] == 0
    assert state["turn_order"] == ["p0", "p1", "p2"]
    assert state["current_player_id"] == "p0"
    assert state["next_player_id"] == "p1"
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2"}
    assert state["timeout_at"] > state["turn_deadline_at"]


def test_increment_by_non_current_player_is_ignored(game: TwentyOneGame) -> None:
    state = _initial(game)
    new_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "INCREMENT", "amount": 1}, state
    )
    assert new_state == state and not finished and outcomes == {}


@pytest.mark.parametrize("amount", [0, 4, "2", None, 1.5])
def test_increment_invalid_amount_is_ignored(game: TwentyOneGame, amount: Any) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "INCREMENT", "amount": amount}, state
    )
    assert new_state == state and not finished


def test_increment_that_would_exceed_21_is_rejected(game: TwentyOneGame) -> None:
    state = _initial(game)
    state = {**state, "count": 19}
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "INCREMENT", "amount": 3}, state
    )
    assert new_state == state and not finished


def test_valid_increment_advances_turn(game: TwentyOneGame) -> None:
    state = _initial(game)
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "INCREMENT", "amount": 2}, state
    )
    assert not finished and outcomes == {}
    assert new_state["count"] == 2
    assert new_state["current_player_id"] == "p1"
    assert new_state["next_player_id"] == "p2"
    assert new_state["turn_index"] == 1
    assert new_state["last_event"] == {
        "type": "INCREMENT",
        "player_id": "p0",
        "amount": 2,
        "count": 2,
        "reason": "pick",
    }
    assert new_state["turn_deadline_at"] > state["turn_deadline_at"] - 1


def test_turn_cursor_wraps_around_like_a_queue(game: TwentyOneGame) -> None:
    state = _initial(game, n=2)
    state, _, _ = game.handle_ws_event("p0", {"action": "INCREMENT", "amount": 1}, state)
    assert state["current_player_id"] == "p1"
    state, _, _ = game.handle_ws_event("p1", {"action": "INCREMENT", "amount": 1}, state)
    assert state["current_player_id"] == "p0"  # p0 is back at the front of the queue
    assert state["next_player_id"] == "p1"


def test_hitting_exactly_21_ends_the_game_and_loser_pays(game: TwentyOneGame) -> None:
    state = _initial(game)
    state = {**state, "count": 19}
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "INCREMENT", "amount": 2}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    assert new_state["count"] == 21
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -8,
        "reason": "hit_21",
    }
    for pid in ("p1", "p2"):
        assert outcomes[pid] == {
            "result": "WIN",
            "chasers": 0,
            "score_delta": 2,
            "reason": "survived",
        }


def test_expire_before_deadline_is_ignored(game: TwentyOneGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_expire_after_deadline_auto_increments_by_one_for_current_player(
    game: TwentyOneGame,
) -> None:
    state = _initial(game)
    idle = state["current_player_id"]
    state = {**state, "turn_deadline_at": 0}  # deadline long past
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert not finished
    assert new_state["count"] == 1
    assert new_state["last_event"]["reason"] == "timeout"
    assert new_state["last_event"]["player_id"] == idle
    assert new_state["current_player_id"] != idle


def test_expire_that_hits_21_ends_the_game_with_the_idle_player_as_loser(
    game: TwentyOneGame,
) -> None:
    state = _initial(game)
    idle = state["current_player_id"]
    state = {**state, "count": 20, "turn_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert finished
    assert new_state["count"] == 21
    assert outcomes[idle]["result"] == "LOSE"
    assert outcomes[idle]["reason"] == "hit_21"


def test_actions_after_done_are_ignored(game: TwentyOneGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in (
        {"action": "INCREMENT", "amount": 1},
        {"action": "EXPIRE"},
    ):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}


def test_hard_stop_timeout_fast_forwards_to_a_loser(game: TwentyOneGame) -> None:
    state = _initial(game)
    state, _, _ = game.handle_ws_event(
        "p0", {"action": "INCREMENT", "amount": 3}, state
    )
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert new_state["count"] == 21
    results = [o["result"] for o in outcomes.values()]
    assert results.count("LOSE") == 1
    assert results.count("WIN") == len(results) - 1
    loser = next(p for p, o in outcomes.items() if o["result"] == "LOSE")
    assert outcomes[loser]["reason"] == "hit_21"


def test_hard_stop_on_already_done_state_is_a_noop(game: TwentyOneGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    new_state, outcomes = game.on_timeout(state)
    assert new_state == state and outcomes == {}
