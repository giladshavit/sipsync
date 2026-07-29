from typing import Any

import pytest

from app.games import auction
from app.games.auction import AuctionGame


class StubRng:
    """Deterministic stand-in for the module RNG.

    randint always returns the upper bound (pool_size == n), choice always
    picks the first element (fallback fill walks recipients in insertion
    order: p1, p2, p3, p4).
    """

    def randint(self, a: int, b: int) -> int:
        return b

    def choice(self, seq: Any) -> Any:
        return seq[0]


def _players(n: int = 5) -> list[dict[str, Any]]:
    return [
        {"player_id": f"p{i}", "display_name": f"Player {i}", "clock_offset": 0}
        for i in range(n)
    ]


@pytest.fixture(autouse=True)
def stub_rng(monkeypatch: pytest.MonkeyPatch) -> StubRng:
    rng = StubRng()
    monkeypatch.setattr(auction, "_rng", rng)
    return rng


@pytest.fixture
def game() -> AuctionGame:
    return AuctionGame()


def _initial(game: AuctionGame, n: int = 5) -> dict[str, Any]:
    return game.get_initial_state(_players(n))


def _bid(
    game: AuctionGame, state: dict[str, Any], pid: str, chasers: int, points: int
) -> dict[str, Any]:
    new_state, finished, _ = game.handle_ws_event(
        pid, {"action": "BID", "chasers": chasers, "points": points}, state
    )
    assert not finished
    return new_state


# ── Initial state / bidding ──────────────────────────────────────────────────


def test_initial_state_shape(game: AuctionGame) -> None:
    state = _initial(game)  # n=5, StubRng.randint -> pool_size == 5
    assert state["status"] == "BIDDING"
    assert state["pool_size"] == 5
    assert state["current_bid"] is None
    assert state["current_bidder_id"] is None
    assert state["bid_history"] == []
    assert state["winner_id"] is None
    assert state["assignments"] == {}
    assert state["taps"] == {}  # engine timeout-guard compat
    assert set(state["clock_offsets"]) == {"p0", "p1", "p2", "p3", "p4"}
    assert state["bid_deadline_at"] > 0
    assert state["timeout_at"] > state["bid_deadline_at"]


def test_first_bid_at_exact_floor_is_valid(game: AuctionGame) -> None:
    state = _initial(game)
    new_state = _bid(game, state, "p0", 1, 0)
    assert new_state["current_bid"] == {"chasers": 1, "points": 0}
    assert new_state["current_bidder_id"] == "p0"
    assert new_state["bid_history"] == [{"player_id": "p0", "chasers": 1, "points": 0}]


@pytest.mark.parametrize("chasers,points", [(0, 5), (-1, 0)])
def test_bid_below_chaser_floor_is_rejected(
    game: AuctionGame, chasers: int, points: int
) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "BID", "chasers": chasers, "points": points}, state
    )
    assert new_state == state and not finished


def test_bid_with_negative_points_is_rejected(game: AuctionGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "BID", "chasers": 1, "points": -5}, state
    )
    assert new_state == state and not finished


@pytest.mark.parametrize("chasers,points", [("1", 0), (None, 0), (1, None), (1.5, 0)])
def test_non_int_bid_fields_are_rejected(
    game: AuctionGame, chasers: Any, points: Any
) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "BID", "chasers": chasers, "points": points}, state
    )
    assert new_state == state and not finished


def test_unknown_player_bid_is_ignored(game: AuctionGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event(
        "ghost", {"action": "BID", "chasers": 1, "points": 0}, state
    )
    assert new_state == state and not finished


def test_equal_bid_is_rejected(game: AuctionGame) -> None:
    state = _bid(game, _initial(game), "p0", 1, 0)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "BID", "chasers": 1, "points": 0}, state
    )
    assert new_state == state and not finished


def test_bid_lower_in_one_dimension_is_rejected(game: AuctionGame) -> None:
    state = _bid(game, _initial(game), "p0", 1, 5)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "BID", "chasers": 2, "points": 3}, state
    )
    assert new_state == state and not finished


def test_bid_higher_in_only_one_dimension_is_accepted(game: AuctionGame) -> None:
    state = _bid(game, _initial(game), "p0", 1, 5)
    new_state = _bid(game, state, "p1", 2, 5)
    assert new_state["current_bid"] == {"chasers": 2, "points": 5}
    assert new_state["current_bidder_id"] == "p1"


def test_valid_bid_resets_deadline(game: AuctionGame) -> None:
    state = _initial(game)
    original_deadline = state["bid_deadline_at"]
    state = {**state, "bid_deadline_at": original_deadline - 10_000}
    new_state = _bid(game, state, "p0", 1, 0)
    assert new_state["bid_deadline_at"] > original_deadline - 10_000


def test_expire_before_deadline_is_ignored(game: AuctionGame) -> None:
    state = _initial(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "EXPIRE_BID"}, state)
    assert new_state == state and not finished


def test_expire_with_no_bids_is_a_draw(game: AuctionGame) -> None:
    state = {**_initial(game), "bid_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "EXPIRE_BID"}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    for pid in ("p0", "p1", "p2", "p3", "p4"):
        assert outcomes[pid] == {
            "result": "SAFE",
            "chasers": 0,
            "score_delta": 0,
            "reason": "no_bids",
        }


def test_expire_with_a_bid_starts_distributing(game: AuctionGame) -> None:
    state = _bid(game, _initial(game), "p0", 2, 15)
    state = {**state, "bid_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p1", {"action": "EXPIRE_BID"}, state
    )
    assert not finished and outcomes == {}
    assert new_state["status"] == "DISTRIBUTING"
    assert new_state["winner_id"] == "p0"
    assert new_state["assignments"] == {"p1": 0, "p2": 0, "p3": 0, "p4": 0}
    assert new_state["distribute_deadline_at"] > 0


# ── Distribution ─────────────────────────────────────────────────────────────


def _distributing_state(game: AuctionGame) -> dict[str, Any]:
    state = _bid(game, _initial(game), "p0", 2, 15)  # pool_size == 5
    state = {**state, "bid_deadline_at": 0}
    new_state, _, _ = game.handle_ws_event("p1", {"action": "EXPIRE_BID"}, state)
    return new_state


def test_assign_from_non_winner_is_ignored(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p1", {"action": "ASSIGN", "target_player_id": "p2"}, state
    )
    assert new_state == state and not finished


def test_assign_to_unknown_target_is_ignored(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p0", {"action": "ASSIGN", "target_player_id": "p0"}, state
    )
    assert new_state == state and not finished


def test_assign_cycles_zero_one_two_zero(game: AuctionGame) -> None:
    state = _distributing_state(game)
    for expected in (1, 2, 0, 1):
        state, finished, _ = game.handle_ws_event(
            "p0", {"action": "ASSIGN", "target_player_id": "p1"}, state
        )
        assert not finished
        assert state["assignments"]["p1"] == expected


def test_submit_from_non_winner_is_ignored(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event("p1", {"action": "SUBMIT"}, state)
    assert new_state == state and not finished


def test_submit_before_pool_fully_distributed_is_ignored(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event("p0", {"action": "SUBMIT"}, state)
    assert new_state == state and not finished


def test_submit_with_full_pool_finishes_round(game: AuctionGame) -> None:
    state = _distributing_state(game)  # pool_size == 5, winner p0 bid [2, 15]
    for target, taps in (("p1", 2), ("p2", 1), ("p3", 2)):
        for _ in range(taps):
            state, _, _ = game.handle_ws_event(
                "p0", {"action": "ASSIGN", "target_player_id": target}, state
            )
    assert sum(state["assignments"].values()) == 5  # p1=2, p2=1, p3=2, p4=0

    new_state, finished, outcomes = game.handle_ws_event(
        "p0", {"action": "SUBMIT"}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -15,
        "reason": "won_auction",
    }
    assert outcomes["p1"] == {"result": "LOSE", "chasers": 2, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p2"] == {"result": "LOSE", "chasers": 1, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p3"] == {"result": "LOSE", "chasers": 2, "score_delta": 0, "reason": "assigned"}
    assert outcomes["p4"] == {"result": "SAFE", "chasers": 0, "score_delta": 0, "reason": "spared"}


def test_expire_distribute_before_deadline_is_ignored(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, finished, _ = game.handle_ws_event(
        "p2", {"action": "EXPIRE_DISTRIBUTE"}, state
    )
    assert new_state == state and not finished


def test_expire_distribute_after_deadline_fallback_fills_and_finishes(
    game: AuctionGame,
) -> None:
    state = {**_distributing_state(game), "distribute_deadline_at": 0}
    new_state, finished, outcomes = game.handle_ws_event(
        "p3", {"action": "EXPIRE_DISTRIBUTE"}, state
    )
    assert finished
    assert new_state["status"] == "DONE"
    # StubRng.choice always takes the first eligible candidate — walking the
    # fill loop by hand gives p1=2, p2=1, p3=1, p4=1 (sums to pool_size 5)
    assert outcomes["p1"]["chasers"] == 2
    assert outcomes["p2"]["chasers"] == 1
    assert outcomes["p3"]["chasers"] == 1
    assert outcomes["p4"]["chasers"] == 1
    assert outcomes["p0"] == {
        "result": "LOSE",
        "chasers": 2,
        "score_delta": -15,
        "reason": "won_auction",
    }


def test_partial_manual_assign_then_fallback_fills_only_the_rest(
    game: AuctionGame,
) -> None:
    state = _distributing_state(game)
    state, _, _ = game.handle_ws_event(
        "p0", {"action": "ASSIGN", "target_player_id": "p1"}, state
    )  # p1 -> 1, 4 chasers remain of the pool of 5
    state = {**state, "distribute_deadline_at": 0}

    _, finished, outcomes = game.handle_ws_event(
        "p2", {"action": "EXPIRE_DISTRIBUTE"}, state
    )
    assert finished
    assert sum(o["chasers"] for o in (outcomes[pid] for pid in ("p1", "p2", "p3", "p4"))) == 5
    assert outcomes["p1"]["chasers"] >= 1  # already-assigned chaser is preserved


# ── Hard-stop timeout ─────────────────────────────────────────────────────────


def test_hard_stop_timeout_during_bidding_is_a_draw(game: AuctionGame) -> None:
    state = _initial(game)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert outcomes["p0"]["reason"] == "no_bids"


def test_hard_stop_timeout_during_distributing_fallback_fills(game: AuctionGame) -> None:
    state = _distributing_state(game)
    new_state, outcomes = game.on_timeout(state)
    assert new_state["status"] == "DONE"
    assert sum(o["chasers"] for pid, o in outcomes.items() if pid != "p0") == 5
    assert outcomes["p0"]["reason"] == "won_auction"


def test_actions_after_done_are_ignored(game: AuctionGame) -> None:
    state = {**_initial(game), "status": "DONE"}
    for payload in (
        {"action": "BID", "chasers": 1, "points": 0},
        {"action": "EXPIRE_BID"},
        {"action": "ASSIGN", "target_player_id": "p1"},
        {"action": "SUBMIT"},
        {"action": "EXPIRE_DISTRIBUTE"},
    ):
        new_state, finished, outcomes = game.handle_ws_event("p0", payload, state)
        assert new_state == state and not finished and outcomes == {}
    timeout_state, timeout_outcomes = game.on_timeout(state)
    assert timeout_state == state and timeout_outcomes == {}
