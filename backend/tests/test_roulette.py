from typing import Any

import pytest

from app.games import roulette
from app.games.roulette import RouletteGame


class StubRng:
    """Deterministic stand-in for the module RNG.

    randrange returns `draw` (0 → poison); choice picks the first closed
    slot; shuffle keeps the given order.
    """

    def __init__(self, draw: int = 1) -> None:
        self.draw = draw

    def shuffle(self, seq: list[Any]) -> None:
        pass

    def randrange(self, n: int) -> int:
        return self.draw % n

    def choice(self, seq: list[Any]) -> Any:
        return seq[0]


def _players(n: int = 3) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture
def safe_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng(draw=1)  # never poison (except a forced 1-closed draw)
    monkeypatch.setattr(roulette, "_rng", rng)
    return rng


@pytest.fixture
def game() -> RouletteGame:
    return RouletteGame()


def _initial(game: RouletteGame, n: int = 3) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def test_initial_state_shape(game: RouletteGame, safe_rng: StubRng) -> None:
    state = _initial(game)
    assert state["status"] == "PLAYING"
    assert state["revealed"] == [False] * 6
    assert state["poison_index"] is None
    assert sorted(state["turn_order"]) == ["p0", "p1", "p2"]
    assert state["current_player_id"] == state["turn_order"][0]
    assert state["round"] == 1
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2"}
    assert state["timeout_at"] > state["turn_deadline_at"]


def test_reveal_by_non_current_player_is_ignored(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    new_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "REVEAL", "slot_index": 0}, state
    )
    assert new_state == state and not finished and outcomes == {}


@pytest.mark.parametrize("slot", [-1, 6, "3", None, 2.5])
def test_reveal_invalid_slot_is_ignored(
    game: RouletteGame, safe_rng: StubRng, slot: Any
) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "REVEAL", "slot_index": slot}, state
    )
    assert new_state == state and not finished


def test_safe_reveal_scores_and_advances_turn(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "REVEAL", "slot_index": 2}, state
    )
    assert not finished and outcomes == {}
    assert new_state["revealed"][2] is True
    assert new_state["pending_deltas"]["p0"] == 3  # 6 closed → +3
    assert new_state["current_player_id"] == "p1"
    assert new_state["turn_index"] == 1
    assert new_state["revealed_by"]["2"] == {"player_id": "p0", "points": 3}
    assert new_state["turn_deadline_at"] > state["turn_deadline_at"] - 1


def test_safe_points_scale_with_remaining_slots(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game, n=2)
    expected = [3, 4, 5, 6, 7]  # closed 6, 5, 4, 3, 2
    for turn, points in enumerate(expected):
        pid = state["current_player_id"]
        state, finished, _ = game.handle_ws_event(
            pid, {"action": "REVEAL", "slot_index": turn}, state
        )
        assert not finished
        last = state["last_event"]
        assert last["type"] == "SAFE" and last["points"] == points


def test_already_revealed_slot_is_ignored(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    state, _, _ = game.handle_ws_event(
        "p0", {"action": "REVEAL", "slot_index": 0}, state
    )
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "REVEAL", "slot_index": 0}, state
    )
    assert new_state == state and not finished


def test_round_increments_after_full_cycle(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game, n=2)
    for slot in range(2):
        pid = state["current_player_id"]
        state, _, _ = game.handle_ws_event(
            pid, {"action": "REVEAL", "slot_index": slot}, state
        )
    assert state["round"] == 2
    assert state["current_player_id"] == state["turn_order"][0]


def test_poison_ends_game_with_outcomes(
    game: RouletteGame, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(roulette, "_rng", StubRng(draw=0))  # instant poison
    state = _initial(game)
    loser = state["current_player_id"]
    new_state, finished, outcomes = game.handle_ws_event(
        loser, {"action": "REVEAL", "slot_index": 4}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    assert new_state["poison_index"] == 4
    assert outcomes[loser] == {
        "result": "LOSE",
        "chasers": 3,
        "score_delta": -15,
        "reason": "poison",
        "poison_index": 4,
    }
    for pid in state["turn_order"]:
        if pid != loser:
            assert outcomes[pid]["result"] == "WIN"
            assert outcomes[pid]["score_delta"] == 0
            assert outcomes[pid]["chasers"] == 0


def test_final_outcomes_include_banked_deltas(
    game: RouletteGame, monkeypatch: pytest.MonkeyPatch
) -> None:
    rng = StubRng(draw=1)
    monkeypatch.setattr(roulette, "_rng", rng)
    state = _initial(game, n=2)
    first, second = state["turn_order"]

    # first banks +3 with a safe reveal, then second hits the poison
    state, _, _ = game.handle_ws_event(
        first, {"action": "REVEAL", "slot_index": 0}, state
    )
    rng.draw = 0
    _, finished, outcomes = game.handle_ws_event(
        second, {"action": "REVEAL", "slot_index": 1}, state
    )
    assert finished
    assert outcomes[first]["result"] == "WIN"
    assert outcomes[first]["score_delta"] == 3
    assert outcomes[second]["score_delta"] == -15


def test_skip_penalizes_once_and_advances(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    skipper = state["current_player_id"]
    state, finished, _ = game.handle_ws_event(skipper, {"action": "SKIP"}, state)
    assert not finished
    assert state["pending_deltas"][skipper] == -5
    assert state["pending_chasers"][skipper] == 1
    assert skipper in state["skips_used"]
    assert state["current_player_id"] != skipper

    # Second skip on their next turn is ignored
    while state["current_player_id"] != skipper:
        pid = state["current_player_id"]
        state, _, _ = game.handle_ws_event(pid, {"action": "SKIP"}, state)
    new_state, _, _ = game.handle_ws_event(skipper, {"action": "SKIP"}, state)
    assert new_state == state


def test_skip_disabled_with_one_slot_left(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    state = {**state, "revealed": [True] * 5 + [False]}
    pid = state["current_player_id"]
    new_state, finished, _ = game.handle_ws_event(pid, {"action": "SKIP"}, state)
    assert new_state == state and not finished


def test_last_slot_reveal_is_forced_poison(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    # draw=1, but randrange(1) can only return 0 — the last card must lose
    state = _initial(game)
    state = {**state, "revealed": [True] * 5 + [False]}
    pid = state["current_player_id"]
    _, finished, outcomes = game.handle_ws_event(
        pid, {"action": "REVEAL", "slot_index": 5}, state
    )
    assert finished
    assert outcomes[pid]["result"] == "LOSE"


def test_expire_before_deadline_is_ignored(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert new_state == state and not finished


def test_expire_after_deadline_force_reveals_for_current_player(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    idle = state["current_player_id"]
    state = {**state, "turn_deadline_at": 0}  # deadline long past
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE"}, state)
    assert not finished
    assert new_state["revealed"][0] is True  # StubRng.choice → first closed slot
    assert new_state["pending_deltas"][idle] == 3
    assert new_state["last_event"]["reason"] == "timeout"
    assert new_state["current_player_id"] != idle


def test_actions_after_done_are_ignored(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in (
        {"action": "REVEAL", "slot_index": 0},
        {"action": "SKIP"},
        {"action": "EXPIRE"},
    ):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}


def test_hard_stop_timeout_fast_forwards_to_a_poison_loser(
    game: RouletteGame, safe_rng: StubRng
) -> None:
    state = _initial(game)
    pid = state["current_player_id"]
    state, _, _ = game.handle_ws_event(
        pid, {"action": "REVEAL", "slot_index": 0}, state
    )
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert new_state["poison_index"] is not None
    # Never an everyone-safe wash: exactly one poison loser, the rest win
    results = [o["result"] for o in outcomes.values()]
    assert results.count("LOSE") == 1
    assert results.count("WIN") == len(results) - 1
    loser = next(p for p, o in outcomes.items() if o["result"] == "LOSE")
    assert outcomes[loser]["reason"] == "poison"
    # Banked points from real play survive the fast-forward
    # (p0 revealed slot 0 for +3, then banked +6 in the simulated turns)
    assert outcomes[pid]["score_delta"] == 9
