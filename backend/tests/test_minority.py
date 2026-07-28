from typing import Any

import pytest

from app.games import majority
from app.games.data.majority_questions import MAJORITY_QUESTIONS
from app.games.majority import MinorityGame

# MinorityGame is MajorityGame with `mode = "AGAINST"` overridden — every
# mechanic other than which group wins (vote validation, EXPIRE/timeout,
# double-vote guards, tie coin flip) is inherited unchanged and already
# covered by test_majority.py. This file only exercises what the subclass
# actually changes.


class FirstChoiceRng:
    """Deterministic stand-in for the module RNG — always picks the first
    element, so the question is always MAJORITY_QUESTIONS[0] and
    EXPIRE-defaulted voters always land on "A"."""

    def choice(self, seq: Any) -> Any:
        return seq[0]


def _players(n: int = 4) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> FirstChoiceRng:
    rng = FirstChoiceRng()
    monkeypatch.setattr(majority, "_rng", rng)
    return rng


@pytest.fixture
def game() -> MinorityGame:
    return MinorityGame()


def _initial(game: MinorityGame, n: int = 4) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def _vote_all(
    game: MinorityGame, state: dict[str, Any], picks: dict[str, str]
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    finished = False
    outcomes: dict[str, dict[str, Any]] = {}
    for pid, choice in picks.items():
        state, finished, outcomes = game.handle_ws_event(
            pid, {"action": "VOTE", "choice": choice}, state
        )
    assert finished
    return state, outcomes


def test_identity(game: MinorityGame) -> None:
    assert MinorityGame.game_id == "minority"
    assert MinorityGame.tutorial_asset == "tutorial.minority"


def test_initial_state_mode_is_against(game: MinorityGame) -> None:
    state = _initial(game)
    assert state["mode"] == "AGAINST"
    assert state["current_question"] == MAJORITY_QUESTIONS[0]["question"]
    assert state["option_a"] == MAJORITY_QUESTIONS[0]["option_a"]
    assert state["option_b"] == MAJORITY_QUESTIONS[0]["option_b"]


def test_minority_wins_majority_drinks(game: MinorityGame) -> None:
    state = _initial(game)
    picks = {"p0": "A", "p1": "A", "p2": "A", "p3": "B"}
    final_state, outcomes = _vote_all(game, state, picks)

    assert final_state["tally"] == {"A": 3, "B": 1}
    for pid in ("p0", "p1", "p2"):
        assert outcomes[pid] == {
            "result": "LOSE",
            "chasers": 1,
            "score_delta": -5,
            "reason": "majority",
            "choice": "A",
            "mode": "AGAINST",
            "tie": False,
            "coin_result": None,
            "auto_voted": False,
        }
    assert outcomes["p3"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 5,
        "reason": "minority",
        "choice": "B",
        "mode": "AGAINST",
        "tie": False,
        "coin_result": None,
        "auto_voted": False,
    }


def test_tie_still_flips_a_coin_and_never_touches_score(game: MinorityGame) -> None:
    # FirstChoiceRng always picks the first element of _CHOICES -> "A"
    state = _initial(game, n=2)
    final_state, outcomes = _vote_all(game, state, {"p0": "A", "p1": "B"})

    assert final_state["tie"] is True
    assert final_state["coin_result"] == "A"
    assert outcomes["p0"]["result"] == "LOSE"
    assert outcomes["p0"]["chasers"] == 1
    assert outcomes["p1"]["result"] == "SAFE"
    assert outcomes["p1"]["chasers"] == 0
    for pid in ("p0", "p1"):
        assert outcomes[pid]["score_delta"] == 0
        assert outcomes[pid]["mode"] == "AGAINST"
