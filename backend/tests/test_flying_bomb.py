import time
from typing import Any
from unittest.mock import patch

import pytest

from app.games import flying_bomb
from app.games.flying_bomb import FlyingBombGame


class StubRng:
    """Deterministic stand-in for the module RNG: shuffle is a no-op (ring
    order == input order) and sample takes the first k elements."""

    def shuffle(self, seq: list) -> None:
        pass

    def sample(self, seq: list, k: int) -> list:
        return list(seq[:k])


def _players(n: int) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng()
    monkeypatch.setattr(flying_bomb, "_rng", rng)
    return rng


@pytest.fixture
def game() -> FlyingBombGame:
    return FlyingBombGame()


def _initial(game: FlyingBombGame, n: int) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def _throw(
    bomb_id: str,
    exit_side: str,
    velocity_x: float = 3.0,  # screen-widths/s — a plausible real swipe, not raw px/s
    velocity_y: float = 0.0,
    y_position: float = 0.5,
) -> dict:
    return {
        "action": "THROW_BOMB",
        "bomb_id": bomb_id,
        "exit_side": exit_side,
        "velocity_x": velocity_x,
        "velocity_y": velocity_y,
        "y_position": y_position,
    }


# ---------------------------------------------------------------------------
# get_initial_state
# ---------------------------------------------------------------------------

def test_initial_state_shape(game: FlyingBombGame) -> None:
    state = _initial(game, 8)
    assert state["status"] == "PLAYING"
    assert state["ring_order"] == [f"p{i}" for i in range(8)]  # stubbed shuffle is a no-op
    assert len(state["bombs"]) == 3  # ceil(8/3)
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {f"p{i}" for i in range(8)}
    assert state["round_end_at"] > 0
    assert state["timeout_at"] > state["round_end_at"]


@pytest.mark.parametrize(
    "n,expected_bombs",
    [(1, 1), (3, 1), (4, 2), (5, 2), (8, 3), (9, 3)],
)
def test_bomb_count_is_ceil_n_over_3(game: FlyingBombGame, n: int, expected_bombs: int) -> None:
    state = _initial(game, n)
    assert len(state["bombs"]) == expected_bombs


def test_initial_bombs_go_to_distinct_players_with_no_entry_physics(game: FlyingBombGame) -> None:
    state = _initial(game, 8)
    holders = [b["holder_id"] for b in state["bombs"].values()]
    assert len(holders) == len(set(holders))
    for bomb in state["bombs"].values():
        assert bomb["seq"] == 0
        assert bomb["entry_side"] is None
        assert bomb["velocity_x"] is None
        assert bomb["velocity_y"] is None
        assert bomb["y_position"] is None


# ---------------------------------------------------------------------------
# THROW_BOMB routing
# ---------------------------------------------------------------------------

def test_throw_right_goes_to_ring_successor(game: FlyingBombGame) -> None:
    state = _initial(game, 4)  # ring: p0,p1,p2,p3 ; bombs: bomb_0 -> p0
    new_state, finished, outcomes = game.handle_ws_event("p0", _throw("bomb_0", "right"), state)
    assert not finished
    assert outcomes == {}
    assert new_state["bombs"]["bomb_0"]["holder_id"] == "p1"


def test_throw_left_goes_to_ring_predecessor(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, _, _ = game.handle_ws_event("p0", _throw("bomb_0", "left"), state)
    assert new_state["bombs"]["bomb_0"]["holder_id"] == "p3"  # wraps around


def test_throw_attenuates_velocity_vector_and_sets_opposite_entry_side(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, _, _ = game.handle_ws_event(
        "p0",
        _throw("bomb_0", "right", velocity_x=8.0, velocity_y=-3.0, y_position=0.75),
        state,
    )
    bomb = new_state["bombs"]["bomb_0"]
    assert bomb["velocity_x"] == pytest.approx(8.0 / 2)  # attenuated by ÷2
    assert bomb["velocity_y"] == pytest.approx(-3.0 / 2)  # same factor, both axes
    assert bomb["entry_side"] == "left"  # opposite of the exit side
    assert bomb["y_position"] == 0.75
    assert bomb["seq"] == 1


def test_throw_clamps_implausible_velocity_before_attenuating(game: FlyingBombGame) -> None:
    # Velocity is normalized screen-lengths/s — anything past
    # _MAX_PLAUSIBLE_VELOCITY (30) is a tampered/garbage report, not a real
    # swipe, and gets clamped before the ÷2 handoff attenuation applies.
    state = _initial(game, 4)
    new_state, _, _ = game.handle_ws_event(
        "p0", _throw("bomb_0", "right", velocity_x=9_999.0, velocity_y=-9_999.0), state
    )
    bomb = new_state["bombs"]["bomb_0"]
    assert bomb["velocity_x"] == pytest.approx(30.0 / 2)
    assert bomb["velocity_y"] == pytest.approx(-30.0 / 2)


def test_throw_increments_seq_on_each_hop(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    s1, _, _ = game.handle_ws_event("p0", _throw("bomb_0", "right"), state)
    s2, _, _ = game.handle_ws_event("p1", _throw("bomb_0", "right"), s1)
    assert s2["bombs"]["bomb_0"]["seq"] == 2
    assert s2["bombs"]["bomb_0"]["holder_id"] == "p2"


def test_throw_bomb_not_held_by_sender_is_ignored(game: FlyingBombGame) -> None:
    state = _initial(game, 4)  # bomb_0 belongs to p0
    new_state, finished, outcomes = game.handle_ws_event("p1", _throw("bomb_0", "right"), state)
    assert new_state is state
    assert not finished
    assert outcomes == {}


def test_throw_unknown_bomb_id_is_ignored(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event("p0", _throw("nope", "right"), state)
    assert new_state is state
    assert not finished


def test_throw_invalid_exit_side_is_ignored(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event("p0", _throw("bomb_0", "up"), state)
    assert new_state is state
    assert not finished


def test_throw_after_done_is_ignored(game: FlyingBombGame) -> None:
    state = {**_initial(game, 4), "status": "DONE"}
    new_state, finished, outcomes = game.handle_ws_event("p0", _throw("bomb_0", "right"), state)
    assert new_state is state
    assert not finished


def test_two_player_ring_left_and_right_hit_the_same_neighbor(game: FlyingBombGame) -> None:
    state = _initial(game, 2)  # ring: p0, p1 ; bomb_0 -> p0
    left, _, _ = game.handle_ws_event("p0", _throw("bomb_0", "left"), state)
    assert left["bombs"]["bomb_0"]["holder_id"] == "p1"
    right, _, _ = game.handle_ws_event("p0", _throw("bomb_0", "right"), state)
    assert right["bombs"]["bomb_0"]["holder_id"] == "p1"


def test_single_player_ring_boomerangs_to_self(game: FlyingBombGame) -> None:
    state = _initial(game, 1)
    new_state, _, _ = game.handle_ws_event("p0", _throw("bomb_0", "right"), state)
    assert new_state["bombs"]["bomb_0"]["holder_id"] == "p0"


def test_bomb_can_stack_two_on_the_same_holder(game: FlyingBombGame) -> None:
    state = _initial(game, 8)  # bomb_0 -> p0, bomb_1 -> p1 (stubbed sample = first 2)
    # Route bomb_1 from p1 onto p0 as well (p1's left neighbor is p0)
    new_state, _, _ = game.handle_ws_event("p1", _throw("bomb_1", "left"), state)
    holders = [b["holder_id"] for b in new_state["bombs"].values()]
    assert holders.count("p0") == 2


# ---------------------------------------------------------------------------
# EXPIRE
# ---------------------------------------------------------------------------

def test_expire_before_deadline_is_ignored(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event("p0", {"action": "EXPIRE"}, state)
    assert new_state is state
    assert not finished
    assert outcomes == {}


def test_expire_after_deadline_finishes_and_scores(game: FlyingBombGame) -> None:
    state = _initial(game, 4)  # bomb_0 -> p0, bomb_1 -> p1 (ceil(4/3) = 2 bombs)
    with patch("app.games.flying_bomb.time") as mock_time:
        mock_time.time.return_value = (state["round_end_at"] + 1) / 1000
        new_state, finished, outcomes = game.handle_ws_event("p0", {"action": "EXPIRE"}, state)

    assert finished
    assert new_state["status"] == "DONE"
    # bomb_0 is still on p0, bomb_1 is still on p1 — nobody threw either
    for pid in ("p0", "p1"):
        assert outcomes[pid]["result"] == "LOSE"
        assert outcomes[pid]["chasers"] == 1
        assert outcomes[pid]["score_delta"] == -7
    for pid in ("p2", "p3"):
        assert outcomes[pid]["result"] == "SAFE"
        assert outcomes[pid]["chasers"] == 0
        assert outcomes[pid]["score_delta"] == 0


# ---------------------------------------------------------------------------
# on_timeout / scoring
# ---------------------------------------------------------------------------

def test_on_timeout_finishes_with_flat_penalty_per_bomb_held(game: FlyingBombGame) -> None:
    state = _initial(game, 8)  # bomb_0 -> p0, bomb_1 -> p1, bomb_2 -> p2 (ceil(8/3) = 3 bombs)
    # p1 throws its bomb onto p2, which already started holding one of its own
    state, _, _ = game.handle_ws_event("p1", _throw("bomb_1", "right"), state)

    new_state, outcomes = game.on_timeout(state)

    assert new_state["status"] == "DONE"
    assert outcomes["p0"]["result"] == "LOSE"
    assert outcomes["p0"]["chasers"] == 1
    assert outcomes["p0"]["score_delta"] == -7

    assert outcomes["p2"]["result"] == "LOSE"
    assert outcomes["p2"]["bombs_held"] == 2
    assert outcomes["p2"]["chasers"] == 2
    assert outcomes["p2"]["score_delta"] == -14

    for pid in ("p1", "p3", "p4", "p5", "p6", "p7"):
        assert outcomes[pid]["result"] == "SAFE"
        assert outcomes[pid]["chasers"] == 0
        assert outcomes[pid]["score_delta"] == 0


def test_scoring_scales_with_multiple_bombs_on_one_holder(game: FlyingBombGame) -> None:
    state = _initial(game, 8)  # bomb_0 -> p0, bomb_1 -> p1
    state, _, _ = game.handle_ws_event("p1", _throw("bomb_1", "left"), state)  # p1's left neighbor is p0

    _, outcomes = game.on_timeout(state)

    assert outcomes["p0"]["bombs_held"] == 2
    assert outcomes["p0"]["chasers"] == 2
    assert outcomes["p0"]["score_delta"] == -14


def test_on_timeout_is_idempotent_once_done(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    done_state, _ = game.on_timeout(state)
    again_state, outcomes = game.on_timeout(done_state)
    assert again_state is done_state
    assert outcomes == {}


def test_unknown_action_is_noop(game: FlyingBombGame) -> None:
    state = _initial(game, 4)
    new_state, finished, outcomes = game.handle_ws_event("p0", {"action": "shrug"}, state)
    assert new_state is state
    assert not finished
    assert outcomes == {}
