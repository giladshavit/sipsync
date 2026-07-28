from typing import Any

import pytest

from app.games import dilemma
from app.games.dilemma import DilemmaGame


class StubRng:
    """Deterministic stand-in for the module RNG — shuffle keeps the given
    order, so pairing is always (p0,p1), (p2,p3), ... with the odd one out
    (if any) landing last."""

    def shuffle(self, seq: list[Any]) -> None:
        pass


def _players(n: int) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stable_rng(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dilemma, "_rng", StubRng())


@pytest.fixture
def game() -> DilemmaGame:
    return DilemmaGame()


def _initial(game: DilemmaGame, n: int) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


# ── Matchmaking ──────────────────────────────────────────────────────────────


def test_initial_state_shape(game: DilemmaGame) -> None:
    state = _initial(game, 4)
    assert state["status"] == "PLAYING"
    assert state["pairs"] == [["p0", "p1"], ["p2", "p3"]]
    assert state["partner_of"] == {"p0": "p1", "p1": "p0", "p2": "p3", "p3": "p2"}
    assert state["immune_player"] is None
    assert state["choices"] == {}
    assert state["turn_ms"] == 30_000
    assert state["turn_deadline_at"] > 0
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3"}
    assert state["timeout_at"] > state["turn_deadline_at"]


def test_odd_player_count_gives_immunity_to_the_leftover(game: DilemmaGame) -> None:
    state = _initial(game, 5)
    assert state["pairs"] == [["p0", "p1"], ["p2", "p3"]]
    assert state["immune_player"] == "p4"
    assert "p4" not in state["partner_of"]


def test_single_player_is_fully_immune(game: DilemmaGame) -> None:
    state = _initial(game, 1)
    assert state["pairs"] == []
    assert state["immune_player"] == "p0"
    assert state["partner_of"] == {}


# ── CHOOSE mechanics ─────────────────────────────────────────────────────────


def test_unpaired_player_cannot_choose(game: DilemmaGame) -> None:
    state = _initial(game, 5)  # p4 is immune
    new_state, finished, outcomes = game.handle_ws_event(
        "p4", {"action": "CHOOSE", "choice": "HELP"}, state
    )
    assert new_state == state and not finished and outcomes == {}


def test_invalid_choice_is_ignored(game: DilemmaGame) -> None:
    state = _initial(game, 4)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "CHOOSE", "choice": "SHRUG"}, state
    )
    assert new_state == state and not finished


def test_choice_locks_and_does_not_finish_until_full_pair_decides(
    game: DilemmaGame,
) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "CHOOSE", "choice": "HELP"}, state
    )
    assert not finished and outcomes == {}
    assert new_state["choices"] == {"p0": "HELP"}
    assert new_state["status"] == "PLAYING"

    # Re-choosing is ignored once locked in
    relocked, finished, _ = game.handle_ws_event(
        "p0", {"action": "CHOOSE", "choice": "BETRAY"}, new_state
    )
    assert relocked == new_state and not finished


def test_round_finishes_only_once_every_pair_has_both_choices(
    game: DilemmaGame,
) -> None:
    state = _initial(game, 4)  # pairs: (p0,p1) (p2,p3)
    state, finished, _ = game.handle_ws_event("p0", {"action": "CHOOSE", "choice": "HELP"}, state)
    assert not finished
    state, finished, _ = game.handle_ws_event("p1", {"action": "CHOOSE", "choice": "HELP"}, state)
    assert not finished  # other pair still undecided
    state, finished, _ = game.handle_ws_event("p2", {"action": "CHOOSE", "choice": "BETRAY"}, state)
    assert not finished
    final_state, finished, outcomes = game.handle_ws_event(
        "p3", {"action": "CHOOSE", "choice": "BETRAY"}, state
    )
    assert finished
    assert final_state["status"] == "DONE"
    assert set(outcomes) == {"p0", "p1", "p2", "p3"}


def test_actions_after_done_are_ignored(game: DilemmaGame) -> None:
    state = {**_initial(game, 4), "status": "DONE"}
    for payload in ({"action": "CHOOSE", "choice": "HELP"}, {"action": "EXPIRE"}):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}


# ── Payoff matrix ────────────────────────────────────────────────────────────


def _resolve(game: DilemmaGame, n: int, choices: dict[str, str]) -> dict[str, dict[str, Any]]:
    state = _initial(game, n)
    finished = False
    outcomes: dict[str, dict[str, Any]] = {}
    for pid, choice in choices.items():
        state, finished, outcomes = game.handle_ws_event(
            pid, {"action": "CHOOSE", "choice": choice}, state
        )
    assert finished
    return outcomes


def test_mutual_help_pays_both_a_modest_win(game: DilemmaGame) -> None:
    outcomes = _resolve(game, 2, {"p0": "HELP", "p1": "HELP"})
    for pid, opponent in (("p0", "p1"), ("p1", "p0")):
        assert outcomes[pid] == {
            "result": "WIN",
            "chasers": 0,
            "score_delta": 5,
            "reason": "mutual_help",
            "choice": "HELP",
            "opponent_id": opponent,
            "opponent_choice": "HELP",
        }


def test_lone_betrayal_wins_big_and_burns_the_helper(game: DilemmaGame) -> None:
    outcomes = _resolve(game, 2, {"p0": "BETRAY", "p1": "HELP"})
    assert outcomes["p0"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 10,
        "reason": "betrayed_them",
        "choice": "BETRAY",
        "opponent_id": "p1",
        "opponent_choice": "HELP",
    }
    assert outcomes["p1"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -10,
        "reason": "got_betrayed",
        "choice": "HELP",
        "opponent_id": "p0",
        "opponent_choice": "BETRAY",
    }


def test_lone_betrayal_is_symmetric_regardless_of_choice_order(game: DilemmaGame) -> None:
    outcomes = _resolve(game, 2, {"p0": "HELP", "p1": "BETRAY"})
    assert outcomes["p1"]["reason"] == "betrayed_them"
    assert outcomes["p1"]["score_delta"] == 10
    assert outcomes["p0"]["reason"] == "got_betrayed"
    assert outcomes["p0"]["score_delta"] == -10
    assert outcomes["p0"]["chasers"] == 2


def test_mutual_betrayal_burns_both_less_severely(game: DilemmaGame) -> None:
    outcomes = _resolve(game, 2, {"p0": "BETRAY", "p1": "BETRAY"})
    for pid, opponent in (("p0", "p1"), ("p1", "p0")):
        assert outcomes[pid] == {
            "result": "LOSE",
            "chasers": 1,
            "score_delta": -5,
            "reason": "mutual_betray",
            "choice": "BETRAY",
            "opponent_id": opponent,
            "opponent_choice": "BETRAY",
        }


def test_immune_player_takes_no_action_and_scores_nothing(game: DilemmaGame) -> None:
    outcomes = _resolve(game, 5, {"p0": "HELP", "p1": "HELP", "p2": "BETRAY", "p3": "BETRAY"})
    assert outcomes["p4"] == {
        "result": "SAFE",
        "chasers": 0,
        "score_delta": 0,
        "reason": "immune",
        "choice": None,
        "opponent_id": None,
        "opponent_choice": None,
    }


# ── EXPIRE / timeout ─────────────────────────────────────────────────────────


def test_expire_before_deadline_is_ignored(game: DilemmaGame) -> None:
    state = _initial(game, 2)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_expire_after_deadline_defaults_undecided_players_to_betray(
    game: DilemmaGame,
) -> None:
    state = _initial(game, 4)  # pairs: (p0,p1) (p2,p3)
    state, finished, _ = game.handle_ws_event("p0", {"action": "CHOOSE", "choice": "HELP"}, state)
    assert not finished

    state = {**state, "turn_deadline_at": 0}  # force the deadline into the past
    final_state, finished, outcomes = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert finished
    assert final_state["status"] == "DONE"
    assert final_state["choices"] == {"p0": "HELP", "p1": "BETRAY", "p2": "BETRAY", "p3": "BETRAY"}

    # p0 helped but got defaulted-BETRAY'd by their own idle partner
    assert outcomes["p0"]["reason"] == "got_betrayed"
    assert outcomes["p1"]["reason"] == "betrayed_them"
    # Neither of p2/p3 ever chose — both default to BETRAY, i.e. mutual betrayal
    assert outcomes["p2"]["reason"] == "mutual_betray"
    assert outcomes["p3"]["reason"] == "mutual_betray"


def test_hard_stop_timeout_defaults_everyone_undecided_to_betray(
    game: DilemmaGame,
) -> None:
    state = _initial(game, 2)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert new_state["choices"] == {"p0": "BETRAY", "p1": "BETRAY"}
    assert outcomes["p0"]["reason"] == "mutual_betray"
    assert outcomes["p1"]["reason"] == "mutual_betray"


def test_on_timeout_after_done_is_a_noop(game: DilemmaGame) -> None:
    state = {**_initial(game, 2), "status": "DONE"}
    new_state, outcomes = game.on_timeout(state)
    assert new_state == state and outcomes == {}
