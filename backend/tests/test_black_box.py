from typing import Any

import pytest

from app.games import black_box
from app.games.black_box import BlackBoxGame


class StubRng:
    """Deterministic stand-in for the module RNG.

    sample always returns the first k elements in order (so player_a_id is
    always the first player, player_b_id the second); shuffle is a no-op (so
    boxes stay in generation order: 3 DRINK boxes, then 3 DISTRIBUTE boxes);
    randint always returns the upper bound (every box gets 3 chasers);
    randrange always returns 0 (auto-pick always lands on box 0); choice
    always picks the first candidate (fallback fill walks recipients in
    insertion order).
    """

    def sample(self, population: Any, k: int) -> list[Any]:
        return list(population)[:k]

    def shuffle(self, seq: Any) -> None:
        return None

    def randint(self, a: int, b: int) -> int:
        return b

    def randrange(self, n: int) -> int:
        return 0

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
    monkeypatch.setattr(black_box, "_rng", rng)
    return rng


@pytest.fixture
def game() -> BlackBoxGame:
    return BlackBoxGame()


def _initial(game: BlackBoxGame, n: int = 4) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def _select(
    game: BlackBoxGame, state: dict[str, Any], pid: str, box_index: int
) -> dict[str, Any]:
    new_state, finished, _ = game.handle_ws_event(
        pid, {"action": "SELECT_BOX", "box_index": box_index}, state
    )
    assert not finished
    return new_state


# ── Initial state / box generation ───────────────────────────────────────────


def test_initial_state_shape(game: BlackBoxGame) -> None:
    state = _initial(game)  # n=4, StubRng.sample -> a=p0, b=p1
    assert state["status"] == "BOX_SELECTION"
    assert state["player_a_id"] == "p0"
    assert state["player_b_id"] == "p1"
    assert len(state["boxes"]) == 6
    assert [b["type"] for b in state["boxes"]] == ["DRINK"] * 3 + ["DISTRIBUTE"] * 3
    assert all(b["chasers"] == 3 for b in state["boxes"])  # StubRng.randint -> upper bound
    assert state["chosen_box_index"] is None
    assert state["taps"] == {}
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3"}
    assert state["select_deadline_at"] > 0
    assert state["timeout_at"] > state["select_deadline_at"]


# ── BOX_SELECTION ─────────────────────────────────────────────────────────────


def test_select_box_by_a_starts_bluffing(game: BlackBoxGame) -> None:
    state = _select(game, _initial(game), "p0", 0)
    assert state["status"] == "BLUFFING"
    assert state["chosen_box_index"] == 0
    assert state["bluff_deadline_at"] > 0


def test_select_box_by_non_a_is_ignored(game: BlackBoxGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "SELECT_BOX", "box_index": 0}, state
    )
    assert new_state == state and not finished


@pytest.mark.parametrize("box_index", [-1, 6, "0", None, 1.5, True])
def test_select_box_invalid_index_is_ignored(game: BlackBoxGame, box_index: Any) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "SELECT_BOX", "box_index": box_index}, state
    )
    assert new_state == state and not finished


def test_select_box_after_bluffing_started_is_ignored(game: BlackBoxGame) -> None:
    state = _select(game, _initial(game), "p0", 0)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "SELECT_BOX", "box_index": 1}, state
    )
    assert new_state == state and not finished


def test_expire_select_before_deadline_is_ignored(game: BlackBoxGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "EXPIRE_SELECT"}, state)
    assert new_state == state and not finished


def test_expire_select_after_deadline_auto_picks_random_box(game: BlackBoxGame) -> None:
    state = {**_initial(game), "select_deadline_at": 0}
    new_state, finished, _ = game.handle_ws_event("p2", {"action": "EXPIRE_SELECT"}, state)
    assert not finished
    assert new_state["status"] == "BLUFFING"
    assert new_state["chosen_box_index"] == 0  # StubRng.randrange -> 0


# ── BLUFFING → DRINK resolution ──────────────────────────────────────────────


def _bluffing_state(game: BlackBoxGame, box_index: int = 0) -> dict[str, Any]:
    return _select(game, _initial(game), "p0", box_index)


def test_take_box_by_b_targets_b_and_resolves_drink(game: BlackBoxGame) -> None:
    state = _bluffing_state(game, box_index=0)  # DRINK, 3 chasers
    new_state, finished, outcomes = game.handle_ws_event("p1", {"action": "TAKE_BOX"}, state)
    assert finished
    assert new_state["status"] == "DONE"
    assert new_state["target_player_id"] == "p1"
    assert outcomes["p1"] == {"result": "LOSE", "chasers": 3, "score_delta": -15, "reason": "drank"}
    for pid in ("p0", "p2", "p3"):
        assert outcomes[pid] == {
            "result": "SAFE",
            "chasers": 0,
            "score_delta": 0,
            "reason": "not_target",
        }


def test_leave_box_by_b_targets_a_and_resolves_drink(game: BlackBoxGame) -> None:
    state = _bluffing_state(game, box_index=0)  # DRINK, 3 chasers
    new_state, finished, outcomes = game.handle_ws_event("p1", {"action": "LEAVE_BOX"}, state)
    assert finished
    assert new_state["target_player_id"] == "p0"
    assert outcomes["p0"] == {"result": "LOSE", "chasers": 3, "score_delta": -15, "reason": "drank"}


def test_decision_by_non_b_is_ignored(game: BlackBoxGame) -> None:
    state = _bluffing_state(game)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "TAKE_BOX"}, state)
    assert new_state == state and not finished
    new_state, finished, _ = game.handle_ws_event("p2", {"action": "LEAVE_BOX"}, state)
    assert new_state == state and not finished


def test_expire_bluff_before_deadline_is_ignored(game: BlackBoxGame) -> None:
    state = _bluffing_state(game)
    new_state, finished, _ = game.handle_ws_event("p2", {"action": "EXPIRE_BLUFF"}, state)
    assert new_state == state and not finished


def test_expire_bluff_after_deadline_defaults_to_leave_box(game: BlackBoxGame) -> None:
    state = {**_bluffing_state(game, box_index=0), "bluff_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p3", {"action": "EXPIRE_BLUFF"}, state
    )
    assert finished
    assert new_state["target_player_id"] == "p0"
    assert outcomes["p0"]["reason"] == "drank"


# ── BLUFFING → DISTRIBUTE resolution ─────────────────────────────────────────


def _distributing_state(game: BlackBoxGame, n: int = 4) -> dict[str, Any]:
    state = _select(game, _initial(game, n), "p0", 3)  # index 3 -> DISTRIBUTE, 3 chasers
    new_state, _, _ = game.handle_ws_event("p1", {"action": "TAKE_BOX"}, state)
    return new_state


def test_take_box_with_distribute_box_starts_distributing(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    assert state["status"] == "DISTRIBUTING"
    assert state["target_player_id"] == "p1"
    assert state["assignments"] == {"p0": 0, "p2": 0, "p3": 0}
    assert state["distribute_deadline_at"] > 0


def test_assign_from_non_target_is_ignored(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "ASSIGN", "recipient_player_id": "p2"}, state
    )
    assert new_state == state and not finished


def test_assign_to_unknown_recipient_is_ignored(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "ASSIGN", "recipient_player_id": "p1"}, state
    )
    assert new_state == state and not finished


def test_assign_cycles_zero_through_three_then_zero(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    for expected in (1, 2, 3, 0):
        state, finished, _ = game.handle_ws_event(
            "p1", {"action": "ASSIGN", "recipient_player_id": "p0"}, state
        )
        assert not finished
        assert state["assignments"]["p0"] == expected


def test_submit_before_pool_fully_distributed_is_ignored(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "SUBMIT"}, state)
    assert new_state == state and not finished


def test_submit_with_full_pool_finishes_round(game: BlackBoxGame) -> None:
    state = _distributing_state(game)  # box chasers == 3
    for target, taps in (("p0", 2), ("p2", 1)):
        for _ in range(taps):
            state, _, _ = game.handle_ws_event(
                "p1", {"action": "ASSIGN", "recipient_player_id": target}, state
            )
    assert sum(state["assignments"].values()) == 3  # p0=2, p2=1, p3=0

    new_state, finished, outcomes = game.handle_ws_event("p1", {"action": "SUBMIT"}, state)
    assert finished
    assert new_state["status"] == "DONE"
    assert outcomes["p1"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 15,
        "reason": "distributed",
    }
    assert outcomes["p0"] == {"result": "LOSE", "chasers": 2, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p2"] == {"result": "LOSE", "chasers": 1, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p3"] == {"result": "SAFE", "chasers": 0, "score_delta": 0, "reason": "spared"}


def test_expire_distribute_before_deadline_is_ignored(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p2", {"action": "EXPIRE_DISTRIBUTE"}, state
    )
    assert new_state == state and not finished


def test_expire_distribute_after_deadline_fallback_fills_and_finishes(
    game: BlackBoxGame,
) -> None:
    state = {**_distributing_state(game), "distribute_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p3", {"action": "EXPIRE_DISTRIBUTE"}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    # StubRng.choice always takes the first eligible candidate — fewest-first
    # fill over {p0, p2, p3} for 3 chasers gives p0=1, p2=1, p3=1
    assert outcomes["p0"]["chasers"] == 1
    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p3"]["chasers"] == 1
    assert outcomes["p1"] == {
        "result": "WIN",
        "chasers": 0,
        "score_delta": 15,
        "reason": "distributed",
    }


def test_two_player_room_lets_single_recipient_absorb_full_box(game: BlackBoxGame) -> None:
    """The whole reason RECIPIENT_MAX_CHASERS was raised to 3: a 2-player
    duel has exactly one recipient, who must be able to take a full 3-chaser
    box alone without deadlocking SUBMIT."""
    state = _distributing_state(game, n=2)
    assert state["assignments"] == {"p0": 0}

    for expected in (1, 2, 3):
        state, finished, _ = game.handle_ws_event(
            "p1", {"action": "ASSIGN", "recipient_player_id": "p0"}, state
        )
        assert not finished
        assert state["assignments"]["p0"] == expected

    new_state, finished, outcomes = game.handle_ws_event("p1", {"action": "SUBMIT"}, state)
    assert finished
    assert new_state["status"] == "DONE"
    assert outcomes["p0"] == {"result": "LOSE", "chasers": 3, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p1"]["reason"] == "distributed"


# ── Hard-stop timeout ─────────────────────────────────────────────────────────


def test_hard_stop_timeout_during_box_selection_resolves_fully(game: BlackBoxGame) -> None:
    state = _initial(game)  # box 0 (StubRng.randrange) is DRINK, 3 chasers
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert new_state["chosen_box_index"] == 0
    # LEAVE_BOX default -> target is A (p0)
    assert outcomes["p0"] == {"result": "LOSE", "chasers": 3, "score_delta": -15, "reason": "drank"}


def test_hard_stop_timeout_during_bluffing_defaults_leave_box(game: BlackBoxGame) -> None:
    state = _bluffing_state(game, box_index=0)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p0"]["reason"] == "drank"


def test_hard_stop_timeout_during_bluffing_with_distribute_box_fallback_fills(
    game: BlackBoxGame,
) -> None:
    state = _bluffing_state(game, box_index=3)  # DISTRIBUTE, 3 chasers
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    # LEAVE_BOX default -> target is A (p0); recipients are p1, p2, p3
    assert outcomes["p0"]["reason"] == "distributed"
    assert sum(o["chasers"] for pid, o in outcomes.items() if pid != "p0") == 3


def test_hard_stop_timeout_during_distributing_fallback_fills(game: BlackBoxGame) -> None:
    state = _distributing_state(game)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert sum(o["chasers"] for pid, o in outcomes.items() if pid != "p1") == 3
    assert outcomes["p1"]["reason"] == "distributed"


def test_actions_after_done_are_ignored(game: BlackBoxGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in (
        {"action": "SELECT_BOX", "box_index": 0},
        {"action": "EXPIRE_SELECT"},
        {"action": "TAKE_BOX"},
        {"action": "LEAVE_BOX"},
        {"action": "EXPIRE_BLUFF"},
        {"action": "ASSIGN", "recipient_player_id": "p1"},
        {"action": "SUBMIT"},
        {"action": "EXPIRE_DISTRIBUTE"},
    ):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}
    timeout_state, timeout_outcomes = game.on_timeout(state)
    assert timeout_state == state and timeout_outcomes == {}
