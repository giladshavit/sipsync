import math
import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_BID_WINDOW_MS = 15_000
_DISTRIBUTE_MS = 60_000

# The bid window resets on every valid bid, so there's no real mathematical
# cap on how long a live bidding war can run (unlike roulette's turn-bounded
# max_turns). This pad is a generous heuristic, not a proven worst case: it's
# sized so an active room (real bids or EXPIRE_BID nudges still flowing)
# never trips it — the engine schedules this task exactly once, at round
# start, and never reschedules it (see room_service._game_timeout), so
# timeout_at must stay fixed for the life of the round rather than being
# bumped forward per bid.
_MAX_BID_EXTENSIONS_PAD = 40  # generous heuristic bid-war ceiling, not enforced
_HARD_STOP_GRACE_MS = 20_000

RECIPIENT_MAX_CHASERS = 2

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class AuctionGame(BaseMiniGame):
    """
    A pool of `pool_size` chasers (randint(ceil(n/2), n)) is up for grabs.
    Players bid an absolute [chasers, points] pair for the right to
    distribute the pool; each valid bid must be >= the current winning bid
    in both parameters and strictly > in at least one, and resets a 15s
    countdown. If the window closes with no bid ever placed, the round is a
    draw. Otherwise the highest bidder pays their bid (their own points drop,
    their own chaser count rises by the chaser side of the bid) and gets 60s
    to assign the pool to the other players by repeatedly tapping avatars
    (cycling 0 -> 1 -> 2 -> 0 chasers each), then submitting once the whole
    pool is placed.

    Deadline enforcement follows the coin_flip/sacrifice/roulette "expire"
    pattern twice over — once per phase. Clients watch the broadcast
    `bid_deadline_at` (or `distribute_deadline_at`) and send EXPIRE_BID (or
    EXPIRE_DISTRIBUTE), which the server validates against its own clock.
    `timeout_at` is computed once at round start and never touched again
    (see the module docstring above `_MAX_BID_EXTENSIONS_PAD`) — it's a
    last-resort hard stop for a fully stalled room, not the normal-path
    deadline for either phase. `on_timeout` resolves whichever phase the
    round is stuck in, roulette-style, in one wake-up.

    Recipients score 0 regardless of chasers assigned — like sacrifice's
    bystanders, a forced/passive drink doesn't cost points; only the winner's
    bid (the one real choice with stakes in this game) moves the scoreboard.
    """

    game_id = "auction"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.auction"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        ids = [p["player_id"] for p in players]
        n = len(ids)
        pool_size = _rng.randint(math.ceil(n / 2), n) if n else 0
        bid_deadline_at = now_ms + _BID_WINDOW_MS

        return {
            "status": "BIDDING",
            "pool_size": pool_size,
            "current_bid": None,  # {"chasers": int, "points": int} once someone bids
            "current_bidder_id": None,
            "bid_history": [],
            "bid_ms": _BID_WINDOW_MS,
            "bid_deadline_at": bid_deadline_at,
            "winner_id": None,
            "distribute_ms": _DISTRIBUTE_MS,
            "distribute_deadline_at": None,
            "assignments": {},  # pid -> 0/1/2, populated once DISTRIBUTING starts
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": now_ms
            + _MAX_BID_EXTENSIONS_PAD * _BID_WINDOW_MS
            + _DISTRIBUTE_MS
            + _HARD_STOP_GRACE_MS,
        }

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        status = current_state.get("status")
        action = payload.get("action")

        if status == "BIDDING":
            if action == "BID":
                return self._handle_bid(player_id, payload, current_state)
            if action == "EXPIRE_BID":
                return self._handle_expire_bid(current_state)
            return current_state, False, {}

        if status == "DISTRIBUTING":
            if action == "ASSIGN":
                return self._handle_assign(player_id, payload, current_state)
            if action == "SUBMIT":
                return self._handle_submit(player_id, current_state)
            if action == "EXPIRE_DISTRIBUTE":
                return self._handle_expire_distribute(current_state)
            return current_state, False, {}

        return current_state, False, {}

    def _handle_bid(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id not in current_state["clock_offsets"]:
            return current_state, False, {}

        chasers = payload.get("chasers")
        points = payload.get("points")
        if not isinstance(chasers, int) or isinstance(chasers, bool):
            return current_state, False, {}
        if not isinstance(points, int) or isinstance(points, bool):
            return current_state, False, {}
        if chasers < 1 or points < 0:
            return current_state, False, {}

        current_bid = current_state["current_bid"]
        if current_bid is not None:
            if chasers < current_bid["chasers"] or points < current_bid["points"]:
                return current_state, False, {}
            if chasers == current_bid["chasers"] and points == current_bid["points"]:
                return current_state, False, {}

        new_bid = {"chasers": chasers, "points": points}
        new_state = {
            **current_state,
            "current_bid": new_bid,
            "current_bidder_id": player_id,
            "bid_history": [
                *current_state["bid_history"],
                {"player_id": player_id, **new_bid},
            ],
            "bid_deadline_at": int(time.time() * 1000) + _BID_WINDOW_MS,
        }
        return new_state, False, {}

    def _handle_expire_bid(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the bid window passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["bid_deadline_at"]):
            return current_state, False, {}

        if current_state["current_bid"] is None:
            return self._finish_draw(current_state)

        return self._start_distributing(current_state), False, {}

    def _start_distributing(self, current_state: dict[str, Any]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        winner_id = current_state["current_bidder_id"]
        recipients = [pid for pid in current_state["clock_offsets"] if pid != winner_id]
        return {
            **current_state,
            "status": "DISTRIBUTING",
            "winner_id": winner_id,
            "assignments": {pid: 0 for pid in recipients},
            "distribute_deadline_at": now_ms + _DISTRIBUTE_MS,
        }

    def _finish_draw(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        outcomes = {
            pid: {"result": "SAFE", "chasers": 0, "score_delta": 0, "reason": "no_bids"}
            for pid in current_state["clock_offsets"]
        }
        new_state = {**current_state, "status": "DONE"}
        return new_state, True, outcomes

    def _handle_assign(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["winner_id"]:
            return current_state, False, {}

        target_id = payload.get("target_player_id")
        assignments = current_state["assignments"]
        if target_id not in assignments:
            return current_state, False, {}

        new_assignments = {
            **assignments,
            target_id: (assignments[target_id] + 1) % (RECIPIENT_MAX_CHASERS + 1),
        }
        return {**current_state, "assignments": new_assignments}, False, {}

    def _handle_submit(
        self, player_id: str, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["winner_id"]:
            return current_state, False, {}
        if sum(current_state["assignments"].values()) != current_state["pool_size"]:
            return current_state, False, {}
        return self._finish(current_state)

    def _handle_expire_distribute(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the distribute window passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["distribute_deadline_at"]):
            return current_state, False, {}
        return self._finish(_fallback_fill(current_state))

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        status = current_state.get("status")
        if status == "DONE":
            return current_state, {}
        if status == "BIDDING":
            new_state, _, outcomes = self._finish_draw(current_state)
            return new_state, outcomes
        # DISTRIBUTING (or an unreachable status, treated the same as a
        # stalled distribution phase since a winner is already committed)
        new_state, _, outcomes = self._finish(_fallback_fill(current_state))
        return new_state, outcomes

    def _finish(
        self, state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        winner_id: str = state["winner_id"]
        bid: dict[str, int] = state["current_bid"]
        assignments: dict[str, int] = state["assignments"]

        outcomes: dict[str, dict[str, Any]] = {
            winner_id: {
                "result": "LOSE",
                "chasers": bid["chasers"],
                "score_delta": -bid["points"],
                "reason": "won_auction",
            }
        }
        for pid, chasers in assignments.items():
            outcomes[pid] = {
                "result": "LOSE" if chasers > 0 else "SAFE",
                "chasers": chasers,
                "score_delta": 0,
                "reason": "assigned" if chasers > 0 else "spared",
            }

        new_state = {**state, "status": "DONE"}
        return new_state, True, outcomes


def _fallback_fill(state: dict[str, Any]) -> dict[str, Any]:
    """Randomly (and fairly) place whatever's left of the pool — players
    with fewer chasers already assigned are filled first, ties broken at
    random, nobody exceeds the 2-chaser cap."""
    assignments = dict(state["assignments"])
    remaining = state["pool_size"] - sum(assignments.values())

    while remaining > 0:
        eligible = [pid for pid, c in assignments.items() if c < RECIPIENT_MAX_CHASERS]
        if not eligible:
            break
        min_count = min(assignments[pid] for pid in eligible)
        candidates = [pid for pid in eligible if assignments[pid] == min_count]
        pid = _rng.choice(candidates)
        assignments[pid] += 1
        remaining -= 1

    return {**state, "assignments": assignments}
