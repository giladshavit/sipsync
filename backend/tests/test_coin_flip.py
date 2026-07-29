from typing import Any

import pytest

from app.games import coin_flip
from app.games.coin_flip import CoinFlipGame


class StubRng:
    """Deterministic stand-in for the module RNG.

    choice picks the first element: p0 is always the flipper and the coin
    always lands "heads".
    """

    def choice(self, seq: Any) -> Any:
        return seq[0]


def _players(n: int = 4) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng()
    monkeypatch.setattr(coin_flip, "_rng", rng)
    return rng


@pytest.fixture
def game() -> CoinFlipGame:
    return CoinFlipGame()


def _initial(game: CoinFlipGame, n: int = 4) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def test_initial_state_shape(game: CoinFlipGame) -> None:
    state = _initial(game)
    assert state["status"] == "PLAYING"
    assert state["flipper_id"] == "p0"
    assert state["result"] == "heads"
    assert state["votes"] == {}
    assert state["tally"] is None
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3"}
    assert state["vote_deadline_at"] > 0
    assert state["timeout_at"] > state["vote_deadline_at"]


def test_flipper_vote_is_ignored(game: CoinFlipGame) -> None:
    state = _initial(game)
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "VOTE", "choice": "heads"}, state
    )
    assert new_state == state and not finished and outcomes == {}


def test_unknown_player_vote_is_ignored(game: CoinFlipGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "ghost", {"action": "VOTE", "choice": "heads"}, state
    )
    assert new_state == state and not finished


@pytest.mark.parametrize("choice", ["HEADS", "tree", None, 1, ""])
def test_invalid_choice_is_ignored(game: CoinFlipGame, choice: Any) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": choice}, state
    )
    assert new_state == state and not finished


def test_double_vote_is_ignored(game: CoinFlipGame) -> None:
    state = _initial(game)
    state, _, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "heads"}, state
    )
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "tails"}, state
    )
    assert new_state == state and not finished
    assert new_state["votes"]["p1"] == "heads"


def test_all_votes_in_finishes_with_guesser_scores(game: CoinFlipGame) -> None:
    state = _initial(game)  # coin: heads
    state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "heads"}, state
    )
    assert not finished
    state, finished, _ = game.handle_ws_event(
        "p2", {"action": "VOTE", "choice": "tails"}, state
    )
    assert not finished
    new_state, finished, outcomes = game.handle_ws_event(
        "p3", {"action": "VOTE", "choice": "heads"}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    assert new_state["tally"] == {"correct": 2, "wrong": 1}
    assert outcomes["p1"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 3,
        "reason": "correct",
        "coin_result": "heads",
    }
    assert outcomes["p2"] == {
        "result": "LOSE",
        "chasers": 1,
        "score_delta": -3,
        "reason": "wrong",
        "coin_result": "heads",
    }
    assert outcomes["p3"]["result"] == "WIN"


def test_flipper_scores_plus_one_per_wrong_minus_one_per_correct(
    game: CoinFlipGame,
) -> None:
    # 11 players → 10 guessers: 4 correct, 6 wrong → flipper +2 (the spec's
    # worked example), and 4/10 correct is no majority → no chasers
    state = _initial(game, n=11)
    for i in range(1, 5):
        state, _, _ = game.handle_ws_event(
            f"p{i}", {"action": "VOTE", "choice": "heads"}, state
        )
    outcomes: dict[str, dict[str, Any]] = {}
    for i in range(5, 11):
        state, finished, outcomes = game.handle_ws_event(
            f"p{i}", {"action": "VOTE", "choice": "tails"}, state
        )
    assert finished
    assert outcomes["p0"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 2,
        "reason": "fooled_them",
        "coin_result": "heads",
    }


def test_strict_majority_correct_makes_flipper_drink(game: CoinFlipGame) -> None:
    # 3 guessers, 2 correct → strict majority → flipper drinks 2 chasers
    state = _initial(game)
    for pid, choice in [("p1", "heads"), ("p2", "heads"), ("p3", "tails")]:
        state, finished, outcomes = game.handle_ws_event(
            pid, {"action": "VOTE", "choice": choice}, state
        )
    assert finished
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -1,
        "reason": "called_out",
        "coin_result": "heads",
    }


def test_exact_half_correct_spares_the_flipper(game: CoinFlipGame) -> None:
    # 4 guessers, 2 correct → exactly 50% → no chasers, score 0, SAFE
    state = _initial(game, n=5)
    votes = [("p1", "heads"), ("p2", "heads"), ("p3", "tails"), ("p4", "tails")]
    for pid, choice in votes:
        state, finished, outcomes = game.handle_ws_event(
            pid, {"action": "VOTE", "choice": choice}, state
        )
    assert finished
    assert outcomes["p0"] == {
        "result": "SAFE",
        "chasers": 0,
        "score_delta": 0,
        "reason": "split_room",
        "coin_result": "heads",
    }


def test_non_voter_counts_as_wrong(game: CoinFlipGame) -> None:
    state = _initial(game)  # heads
    state, _, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "heads"}, state
    )
    state, _, _ = game.handle_ws_event(
        "p2", {"action": "VOTE", "choice": "heads"}, state
    )
    # p3 never votes — deadline passes
    state = {**state, "vote_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "EXPIRE"}, state
    )
    assert finished
    assert new_state["tally"] == {"correct": 2, "wrong": 1}
    assert outcomes["p3"] == {
        "result": "LOSE",
        "chasers": 1,
        "score_delta": -3,
        "reason": "no_vote",
        "coin_result": "heads",
    }
    # 2/3 correct is a strict majority — the silent player didn't save p0
    assert outcomes["p0"]["reason"] == "called_out"


def test_expire_before_deadline_is_ignored(game: CoinFlipGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_nobody_votes_flipper_sweeps(game: CoinFlipGame) -> None:
    state = {**_initial(game), "vote_deadline_at": 0}
    _, finished, outcomes = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert finished
    assert outcomes["p0"]["score_delta"] == 3
    assert outcomes["p0"]["result"] == "WIN"
    assert outcomes["p0"]["chasers"] == 0
    for pid in ("p1", "p2", "p3"):
        assert outcomes[pid]["reason"] == "no_vote"


def test_hard_stop_timeout_finishes(game: CoinFlipGame) -> None:
    state = _initial(game)
    state, _, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "tails"}, state
    )
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p1"]["reason"] == "wrong"
    assert outcomes["p2"]["reason"] == "no_vote"
    assert outcomes["p0"]["score_delta"] == 3


def test_actions_after_done_are_ignored(game: CoinFlipGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in ({"action": "VOTE", "choice": "heads"}, {"action": "EXPIRE"}):
        new_state, finished, outcomes = game.handle_ws_event("p1", payload, state)
        assert new_state == state and not finished and outcomes == {}
    timeout_state, timeout_outcomes = game.on_timeout(state)
    assert timeout_state == state and timeout_outcomes == {}
