from typing import Any

import pytest

from app.games.sacrifice import SacrificeGame


def _players(n: int) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture
def game() -> SacrificeGame:
    return SacrificeGame()


def _initial(game: SacrificeGame, n: int) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


# ── Dynamic target calculation ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "player_count,expected_target",
    [(1, 1), (2, 1), (3, 2), (4, 2), (5, 2), (6, 3), (7, 3), (9, 4)],
)
def test_target_chasers_scales_with_player_count(
    game: SacrificeGame, player_count: int, expected_target: int
) -> None:
    state = _initial(game, player_count)
    assert state["target_chasers"] == expected_target


def test_initial_state_shape(game: SacrificeGame) -> None:
    state = _initial(game, 4)
    assert state["status"] == "PLAYING"
    assert state["pledged_total"] == 0
    assert state["pledges"] == {f"p{i}": 0 for i in range(4)}
    assert state["turn_ms"] == 30_000
    assert state["turn_deadline_at"] > 0
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3"}
    assert state["timeout_at"] > state["turn_deadline_at"]


# ── PLEDGE mechanics ─────────────────────────────────────────────────────────


def test_pledge_by_unknown_player_is_ignored(game: SacrificeGame) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event(
        "ghost", {"action": "PLEDGE"}, state
    )
    assert new_state == state and not finished and outcomes == {}


def test_pledge_increments_pledger_and_total_without_finishing(
    game: SacrificeGame,
) -> None:
    state = _initial(game, 6)  # target 3
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "PLEDGE"}, state
    )
    assert not finished and outcomes == {}
    assert new_state["pledges"]["p0"] == 1
    assert new_state["pledged_total"] == 1
    assert new_state["status"] == "PLAYING"
    assert new_state["last_event"] == {
        "type": "PLEDGE",
        "player_id": "p0",
        "pledges": 1,
        "pledged_total": 1,
    }


def test_same_player_can_pledge_multiple_times(game: SacrificeGame) -> None:
    state = _initial(game, 6)  # target 3
    for _ in range(2):
        state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
        assert not finished
    assert state["pledges"]["p0"] == 2
    assert state["pledged_total"] == 2


def test_actions_after_done_are_ignored(game: SacrificeGame) -> None:
    state = {**_initial(game, 4), "status": "DONE"}
    for payload in ({"action": "PLEDGE"}, {"action": "EXPIRE"}):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}


# ── Success condition ───────────────────────────────────────────────────────


def test_success_scores_and_chasers_for_volunteers_and_bystanders(
    game: SacrificeGame,
) -> None:
    state = _initial(game, 4)  # target 2
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished

    final_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "PLEDGE"}, state
    )
    assert finished
    assert final_state["status"] == "DONE"
    assert final_state["pledged_total"] == 2

    assert outcomes["p0"] == {
        "result": "WIN",
        "chasers": 1,
        "score_delta": 10,
        "reason": "hero",
        "pledges": 1,
        "pledged_total": 2,
        "target_chasers": 2,
    }
    assert outcomes["p1"] == {
        "result": "WIN",
        "chasers": 1,
        "score_delta": 10,
        "reason": "hero",
        "pledges": 1,
        "pledged_total": 2,
        "target_chasers": 2,
    }
    for bystander in ("p2", "p3"):
        assert outcomes[bystander] == {
            "result": "SAFE",
            "chasers": 0,
            "score_delta": 0,
            "reason": "bystander",
            "pledges": 0,
            "pledged_total": 2,
            "target_chasers": 2,
        }


def test_success_scales_score_and_chasers_with_repeated_pledges(
    game: SacrificeGame,
) -> None:
    state = _initial(game, 6)  # target 3
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished  # total 2/3 — still short

    final_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "PLEDGE"}, state
    )
    assert finished
    assert final_state["pledged_total"] == 3
    assert outcomes["p0"]["chasers"] == 2
    assert outcomes["p0"]["score_delta"] == 20
    assert outcomes["p1"]["chasers"] == 1
    assert outcomes["p1"]["score_delta"] == 10
    for bystander in ("p2", "p3", "p4", "p5"):
        assert outcomes[bystander]["result"] == "SAFE"
        assert outcomes[bystander]["score_delta"] == 0


def test_single_hero_can_cover_the_whole_target(game: SacrificeGame) -> None:
    state = _initial(game, 4)  # target 2
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished
    final_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "PLEDGE"}, state
    )
    assert finished
    assert outcomes["p0"] == {
        "result": "WIN",
        "chasers": 2,
        "score_delta": 20,
        "reason": "hero",
        "pledges": 2,
        "pledged_total": 2,
        "target_chasers": 2,
    }
    for bystander in ("p1", "p2", "p3"):
        assert outcomes[bystander]["result"] == "SAFE"
        assert outcomes[bystander]["score_delta"] == 0


# ── Failure condition (timeout) ─────────────────────────────────────────────


def test_expire_before_deadline_is_ignored(game: SacrificeGame) -> None:
    state = _initial(game, 4)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_expire_after_deadline_everyone_drinks_only_volunteers_lose_points(
    game: SacrificeGame,
) -> None:
    state = _initial(game, 4)  # target 2
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished  # only 1/2 pledged, room still short

    state = {**state, "turn_deadline_at": 0}  # force the deadline into the past
    final_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "EXPIRE"}, state
    )
    assert finished
    assert final_state["status"] == "DONE"

    # Tragic volunteer: kept their pledged chaser, plus the room's forced one
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -10,
        "reason": "martyred",
        "pledges": 1,
        "pledged_total": 1,
        "target_chasers": 2,
    }
    # Every bystander still drinks — nobody skips the round on a failed
    # sacrifice — but a failure they never volunteered for costs them 0 points
    for coward in ("p1", "p2", "p3"):
        assert outcomes[coward] == {
            "result": "LOSE",
            "chasers": 1,
            "score_delta": 0,
            "reason": "drafted",
            "pledges": 0,
            "pledged_total": 1,
            "target_chasers": 2,
        }


def test_hard_stop_timeout_resolves_as_failure(game: SacrificeGame) -> None:
    state = _initial(game, 4)  # target 2
    state, finished, _ = game.handle_ws_event("p0", {"action": "PLEDGE"}, state)
    assert not finished

    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p0"]["result"] == "LOSE"
    assert outcomes["p0"]["chasers"] == 2
    for pid in ("p1", "p2", "p3"):
        assert outcomes[pid]["result"] == "LOSE"
        assert outcomes[pid]["chasers"] == 1


def test_on_timeout_after_done_is_a_noop(game: SacrificeGame) -> None:
    state = {**_initial(game, 4), "status": "DONE"}
    new_state, outcomes = game.on_timeout(state)
    assert new_state == state and outcomes == {}
