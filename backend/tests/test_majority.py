from typing import Any

import pytest

from app.games import majority
from app.games.data.majority_questions import MAJORITY_QUESTIONS
from app.games.majority import MajorityGame


class FirstChoiceRng:
    """Deterministic stand-in for the module RNG — always picks the first
    element, so mode is always "FLOW", the question is always
    MAJORITY_QUESTIONS[0], EXPIRE-defaulted voters always land on "A", and a
    tie's coin always lands on "A"."""

    def choice(self, seq: Any) -> Any:
        return seq[0]


class LastChoiceRng:
    """Always picks the last element — used to force a tie's coin onto "B"."""

    def choice(self, seq: Any) -> Any:
        return seq[-1]


def _players(n: int = 4) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


def _players_with_asked(asked: set[str], n: int = 4) -> list[dict[str, Any]]:
    """room_service injects `asked_questions` onto every player dict — only
    the first entry is ever read (see get_initial_state)."""
    players = _players(n)
    players[0]["asked_questions"] = asked
    return players


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> FirstChoiceRng:
    rng = FirstChoiceRng()
    monkeypatch.setattr(majority, "_rng", rng)
    return rng


@pytest.fixture
def game() -> MajorityGame:
    return MajorityGame()


def _initial(game: MajorityGame, n: int = 4) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


# ── Initial state ────────────────────────────────────────────────────────────


def test_initial_state_shape(game: MajorityGame) -> None:
    state = _initial(game)
    assert state["status"] == "PLAYING"
    assert state["mode"] == "FLOW"
    assert state["current_question"] == MAJORITY_QUESTIONS[0]["question"]
    assert state["option_a"] == MAJORITY_QUESTIONS[0]["option_a"]
    assert state["option_b"] == MAJORITY_QUESTIONS[0]["option_b"]
    assert state["votes"] == {}
    assert state["turn_ms"] == 15_000
    assert state["turn_deadline_at"] > 0
    assert state["tally"] is None
    assert state["tie"] is False
    assert state["coin_result"] is None
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3"}
    assert state["timeout_at"] > state["turn_deadline_at"]
    assert state["reset_question_cycle"] is False


# ── No-repeat question pool ──────────────────────────────────────────────────
# room_service persists `asked_questions` per room and injects it back on
# every round; these tests exercise the pure selection logic in isolation
# (the Redis-side bookkeeping itself is covered in test_ws_game.py).


def test_asked_questions_are_excluded_from_the_draw(game: MajorityGame) -> None:
    asked = {MAJORITY_QUESTIONS[0]["question"]}
    state = game.get_initial_state(_players_with_asked(asked))
    # FirstChoiceRng picks index 0 of whatever list it's given — with the
    # pool's own first entry excluded, that's the pool's second entry
    assert state["current_question"] == MAJORITY_QUESTIONS[1]["question"]
    assert state["reset_question_cycle"] is False


def test_fully_exhausted_pool_resets_the_cycle(game: MajorityGame) -> None:
    asked = {q["question"] for q in MAJORITY_QUESTIONS}
    state = game.get_initial_state(_players_with_asked(asked))
    # Nothing left to exclude -> draws from the full pool again
    assert state["current_question"] == MAJORITY_QUESTIONS[0]["question"]
    assert state["reset_question_cycle"] is True


def test_partially_asked_pool_does_not_reset(game: MajorityGame) -> None:
    asked = {q["question"] for q in MAJORITY_QUESTIONS[:-1]}  # all but the last
    state = game.get_initial_state(_players_with_asked(asked))
    assert state["current_question"] == MAJORITY_QUESTIONS[-1]["question"]
    assert state["reset_question_cycle"] is False


# ── VOTE mechanics ───────────────────────────────────────────────────────────


def test_unknown_player_vote_is_ignored(game: MajorityGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "ghost", {"action": "VOTE", "choice": "A"}, state
    )
    assert new_state == state and not finished


@pytest.mark.parametrize("choice", ["C", "a", None, 1, ""])
def test_invalid_choice_is_ignored(game: MajorityGame, choice: Any) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": choice}, state
    )
    assert new_state == state and not finished


def test_double_vote_is_ignored(game: MajorityGame) -> None:
    state = _initial(game)
    state, _, _ = game.handle_ws_event("p1", {"action": "VOTE", "choice": "A"}, state)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "B"}, state
    )
    assert new_state == state and not finished
    assert new_state["votes"]["p1"] == "A"


def test_vote_does_not_finish_until_everyone_has_voted(game: MajorityGame) -> None:
    state = _initial(game)
    state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "VOTE", "choice": "A"}, state
    )
    assert not finished and outcomes == {}
    state, finished, _ = game.handle_ws_event(
        "p1", {"action": "VOTE", "choice": "A"}, state
    )
    assert not finished


def test_actions_after_done_are_ignored(game: MajorityGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in ({"action": "VOTE", "choice": "A"}, {"action": "EXPIRE"}):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}


# ── Scoring: FLOW mode ───────────────────────────────────────────────────────


def _vote_all(
    game: MajorityGame, state: dict[str, Any], picks: dict[str, str]
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    finished = False
    outcomes: dict[str, dict[str, Any]] = {}
    for pid, choice in picks.items():
        state, finished, outcomes = game.handle_ws_event(
            pid, {"action": "VOTE", "choice": choice}, state
        )
    assert finished
    return state, outcomes


def test_flow_mode_majority_wins_minority_drinks(game: MajorityGame) -> None:
    state = _initial(game)  # mode == "FLOW" from the stub rng
    picks = {"p0": "A", "p1": "A", "p2": "A", "p3": "B"}
    final_state, outcomes = _vote_all(game, state, picks)

    assert final_state["status"] == "DONE"
    assert final_state["tie"] is False
    assert final_state["tally"] == {"A": 3, "B": 1}
    assert final_state["majority_choice"] == "A"
    assert final_state["minority_choice"] == "B"

    for pid in ("p0", "p1", "p2"):
        assert outcomes[pid] == {
            "result": "WIN",
            "chasers": 0,
            "score_delta": 5,
            "reason": "majority",
            "choice": "A",
            "mode": "FLOW",
            "tie": False,
            "coin_result": None,
            "auto_voted": False,
        }
    assert outcomes["p3"] == {
        "result": "LOSE",
        "chasers": 1,
        "score_delta": -5,
        "reason": "minority",
        "choice": "B",
        "mode": "FLOW",
        "tie": False,
        "coin_result": None,
        "auto_voted": False,
    }


# ── Scoring: AGAINST mode ────────────────────────────────────────────────────


def test_against_mode_minority_wins_majority_drinks(game: MajorityGame) -> None:
    state = {**_initial(game), "mode": "AGAINST"}
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


# ── Scoring: ties ─────────────────────────────────────────────────────────────


def test_tie_coin_picks_option_a_only_a_voters_drink(game: MajorityGame) -> None:
    # FirstChoiceRng always picks the first element of _CHOICES -> "A"
    state = _initial(game, n=2)
    picks = {"p0": "A", "p1": "B"}
    final_state, outcomes = _vote_all(game, state, picks)

    assert final_state["tie"] is True
    assert final_state["coin_result"] == "A"
    assert final_state["majority_choice"] is None
    assert final_state["minority_choice"] is None
    assert outcomes["p0"]["result"] == "LOSE"
    assert outcomes["p0"]["score_delta"] == 0
    assert outcomes["p0"]["chasers"] == 1
    assert outcomes["p0"]["tie"] is True
    assert outcomes["p0"]["reason"] == "tie_coin"
    assert outcomes["p1"]["result"] == "SAFE"
    assert outcomes["p1"]["score_delta"] == 0
    assert outcomes["p1"]["chasers"] == 0


def test_tie_coin_picks_option_b_only_b_voters_drink(
    game: MajorityGame, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(majority, "_rng", LastChoiceRng())
    state = _initial(game, n=2)
    picks = {"p0": "A", "p1": "B"}
    final_state, outcomes = _vote_all(game, state, picks)

    assert final_state["tie"] is True
    assert final_state["coin_result"] == "B"
    assert outcomes["p0"]["result"] == "SAFE"
    assert outcomes["p0"]["chasers"] == 0
    assert outcomes["p1"]["result"] == "LOSE"
    assert outcomes["p1"]["score_delta"] == 0
    assert outcomes["p1"]["chasers"] == 1


def test_score_is_never_affected_by_a_tie_in_either_mode(game: MajorityGame) -> None:
    for mode in ("FLOW", "AGAINST"):
        state = {**_initial(game, n=2), "mode": mode}
        _, outcomes = _vote_all(game, state, {"p0": "A", "p1": "B"})
        assert all(o["score_delta"] == 0 for o in outcomes.values())


# ── EXPIRE / timeout ─────────────────────────────────────────────────────────


def test_expire_before_deadline_is_ignored(game: MajorityGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_expire_after_deadline_defaults_non_voters(game: MajorityGame) -> None:
    state = _initial(game, n=3)  # mode "FLOW"
    state, _, _ = game.handle_ws_event("p0", {"action": "VOTE", "choice": "B"}, state)
    state = {**state, "turn_deadline_at": 0}  # force the deadline into the past

    final_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "EXPIRE"}, state
    )
    assert finished
    assert final_state["status"] == "DONE"
    # p1/p2 never voted -> FirstChoiceRng defaults them to "A"
    assert final_state["votes"] == {"p0": "B", "p1": "A", "p2": "A"}
    assert outcomes["p0"]["auto_voted"] is False
    assert outcomes["p1"]["auto_voted"] is True
    assert outcomes["p2"]["auto_voted"] is True
    assert final_state["majority_choice"] == "A"


def test_hard_stop_timeout_finishes(game: MajorityGame) -> None:
    state = _initial(game, n=2)
    state, _, _ = game.handle_ws_event("p0", {"action": "VOTE", "choice": "A"}, state)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p1"]["auto_voted"] is True


def test_on_timeout_after_done_is_a_noop(game: MajorityGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    new_state, outcomes = game.on_timeout(state)
    assert new_state == state and outcomes == {}
