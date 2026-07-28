import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_TURN_MS = 12_000
_TARGET = 21
_VALID_AMOUNTS = (1, 2, 3)

# Real turns overrun the nominal window (thinking time, EXPIRE retries), so
# the hard-stop budget allows generous slack per turn — it should only ever
# fire when the whole room has stalled. Worst case is 21 turns (every turn
# only ever adds +1).
_TURN_SLACK_MS = 5_000
_HARD_STOP_GRACE_MS = 30_000
_MAX_TURNS = _TARGET

_LOSE_POINTS = -8
_LOSE_CHASERS = 2
_WIN_POINTS = 2
_WIN_CHASERS = 0

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class TwentyOneGame(BaseMiniGame):
    """
    21: a shared counter starts at 0. On their turn, a player pushes it up by
    +1, +2, or +3 — never past 21. Whoever is forced to land it on exactly 21
    loses. Turn order is a fixed shuffle at round start with a cursor
    (`turn_index % len(turn_order)`) that advances every turn — mathematically
    identical to "loser of the turn goes to the back of the queue" for a
    static player set, without needing to actually mutate a queue.

    Trust note: `turn_order` still rides in the broadcast state (the server
    needs it to compute `next_player_id`, and state is broadcast verbatim —
    see the coin_flip.py trust note), but only `current_player_id` and
    `next_player_id` are meant to be rendered; the full order is a
    server-bookkeeping detail, not a UI element, so long-term meta-gaming
    across the hidden rest of the queue isn't something the client surfaces.

    AFK handling follows the roulette/coin_flip "expire" pattern: clients
    watch the broadcast `turn_deadline_at` and send an EXPIRE action, which
    the server verifies against its own clock before auto-applying +1 on the
    idle player's behalf (always a legal move, since the game already ends
    the instant `count` hits 21 — a turn never opens above 20). The engine's
    `timeout_at` hard stop fast-forwards any remaining turns as forced +1s
    (roulette's pattern) so a fully stalled room still resolves with a real
    loser instead of a wash.
    """

    game_id = "twenty_one"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.twenty_one"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        order = [p["player_id"] for p in players]
        _rng.shuffle(order)

        return {
            "status": "PLAYING",
            "count": 0,
            "turn_order": order,
            "turn_index": 0,
            "current_player_id": order[0] if order else None,
            "next_player_id": order[1 % len(order)] if order else None,
            "turn_ms": _TURN_MS,
            "turn_deadline_at": now_ms + _TURN_MS,
            "last_event": None,
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": now_ms
            + _MAX_TURNS * (_TURN_MS + _TURN_SLACK_MS)
            + _HARD_STOP_GRACE_MS,
        }

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if current_state.get("status") != "PLAYING":
            return current_state, False, {}

        action = payload.get("action")
        if action == "INCREMENT":
            return self._handle_increment(player_id, payload, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_increment(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["current_player_id"]:
            return current_state, False, {}

        amount = payload.get("amount")
        if amount not in _VALID_AMOUNTS:
            return current_state, False, {}
        if current_state["count"] + amount > _TARGET:
            return current_state, False, {}

        return self._apply_increment(player_id, amount, current_state, "pick")

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the turn deadline passed — verify on our clock,
        then auto-increment by 1 on the idle player's behalf."""
        if int(time.time() * 1000) < int(current_state["turn_deadline_at"]):
            return current_state, False, {}

        current_player_id = current_state["current_player_id"]
        if current_player_id is None:
            return current_state, False, {}

        return self._apply_increment(current_player_id, 1, current_state, "timeout")

    def _apply_increment(
        self,
        player_id: str,
        amount: int,
        current_state: dict[str, Any],
        reason: str,
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        new_count = current_state["count"] + amount
        last_event = {
            "type": "INCREMENT",
            "player_id": player_id,
            "amount": amount,
            "count": new_count,
            "reason": reason,
        }

        if new_count == _TARGET:
            final_state = {
                **current_state,
                "count": new_count,
                "status": "DONE",
                "last_event": last_event,
            }
            return final_state, True, _final_outcomes(final_state, loser_id=player_id)

        new_state = _advance_turn({
            **current_state,
            "count": new_count,
            "last_event": last_event,
        })
        return new_state, False, {}

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        """Hard stop for a fully stalled room — fast-forward the remaining
        turns as forced +1s so the round still ends with a real loser
        instead of an everyone-safe wash."""
        if current_state.get("status") == "DONE":
            return current_state, {}
        if not current_state.get("turn_order"):
            return {**current_state, "status": "DONE"}, {}

        state = current_state
        while True:
            state, finished, outcomes = self._apply_increment(
                state["current_player_id"], 1, state, "timeout"
            )
            if finished:
                return state, outcomes


def _advance_turn(state: dict[str, Any]) -> dict[str, Any]:
    order: list[str] = state["turn_order"]
    turn_index: int = state["turn_index"] + 1
    return {
        **state,
        "turn_index": turn_index,
        "current_player_id": order[turn_index % len(order)],
        "next_player_id": order[(turn_index + 1) % len(order)],
        "turn_deadline_at": int(time.time() * 1000) + _TURN_MS,
    }


def _final_outcomes(
    state: dict[str, Any], loser_id: str
) -> dict[str, dict[str, Any]]:
    outcomes: dict[str, dict[str, Any]] = {}
    for pid in state["turn_order"]:
        if pid == loser_id:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": _LOSE_CHASERS,
                "score_delta": _LOSE_POINTS,
                "reason": "hit_21",
            }
        else:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": _WIN_CHASERS,
                "score_delta": _WIN_POINTS,
                "reason": "survived",
            }
    return outcomes
