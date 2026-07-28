import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_SLOTS = 6
_TURN_MS = 10_000

_POISON_POINTS = -15
_POISON_CHASERS = 3
_SKIP_POINTS = -5
_SKIP_CHASERS = 1

# Safe-reveal reward grows as the board thins: 9 − closed slots
# (6 closed → +3 … 2 closed → +7; 1 closed is always the poison).
_SAFE_POINTS_BASE = 9

# Real turns overrun the nominal 10 s (thinking time, flip animations, EXPIRE
# retries), so the hard-stop budget allows generous slack per turn — it should
# only ever fire when the whole room has stalled.
_TURN_SLACK_MS = 5_000
_HARD_STOP_GRACE_MS = 30_000

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class RouletteGame(BaseMiniGame):
    """
    Russian Roulette: 6 face-down cards, one hides the poison. Players take
    locked, shuffled turns revealing cards. A safe reveal pays more the
    thinner the board gets; the poison costs 15 pts and 3 chasers and ends
    the game on the spot. Each player may chicken out ("SKIP") once per game
    for −5 pts and 1 chaser — unless only the poison card is left.

    Server-as-Judge note: game state is broadcast verbatim to every client,
    so the poison index is never predetermined and stored. Instead each
    reveal draws poison with probability 1/(closed slots) — distributionally
    identical to a hidden fixed slot (and the last closed slot is a forced
    hit), but nothing secret ever leaves the server.

    Turn timeout (10 s) follows the human_timer "expire" pattern: the engine
    schedules only one timeout task per game, so per-turn deadlines are
    enforced by clients watching the broadcast `turn_deadline_at` and sending
    an EXPIRE action, which the server validates against its own clock before
    force-revealing a random closed card for the idle player. The engine's
    single `timeout_at` task remains as a worst-case hard stop for a fully
    stalled room (everyone disconnected): the remaining turns are fast-
    forwarded as forced reveals so the round still ends with a poison loser.
    """

    game_id = "roulette"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.roulette"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        order = [p["player_id"] for p in players]
        _rng.shuffle(order)

        # Worst case: every player skips once + all 6 cards get revealed
        max_turns = _SLOTS + len(order)

        return {
            "status": "PLAYING",
            "revealed": [False] * _SLOTS,
            # Set only at the moment the poison is hit (see class docstring)
            "poison_index": None,
            "turn_order": order,
            "turn_index": 0,
            "round": 1,
            "current_player_id": order[0] if order else None,
            "turn_ms": _TURN_MS,
            "turn_deadline_at": now_ms + _TURN_MS,
            "skips_used": [],
            # Points/chasers banked during play, paid out in the final outcomes
            # (the engine applies scores only once, when the game finishes)
            "pending_deltas": {pid: 0 for pid in order},
            "pending_chasers": {pid: 0 for pid in order},
            # slot index (str, JSON key) → {player_id, points} for the card UI
            "revealed_by": {},
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
            + max_turns * (_TURN_MS + _TURN_SLACK_MS)
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
        if action == "REVEAL":
            return self._handle_reveal(player_id, payload, current_state)
        if action == "SKIP":
            return self._handle_skip(player_id, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_reveal(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["current_player_id"]:
            return current_state, False, {}

        slot_index = payload.get("slot_index")
        if not isinstance(slot_index, int) or not 0 <= slot_index < _SLOTS:
            return current_state, False, {}
        if current_state["revealed"][slot_index]:
            return current_state, False, {}

        return self._resolve_reveal(player_id, slot_index, current_state, "pick")

    def _handle_skip(
        self,
        player_id: str,
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["current_player_id"]:
            return current_state, False, {}
        if player_id in current_state["skips_used"]:
            return current_state, False, {}
        # Down to the poison alone — no escape
        if current_state["revealed"].count(False) <= 1:
            return current_state, False, {}

        deltas = dict(current_state["pending_deltas"])
        chasers = dict(current_state["pending_chasers"])
        deltas[player_id] = deltas.get(player_id, 0) + _SKIP_POINTS
        chasers[player_id] = chasers.get(player_id, 0) + _SKIP_CHASERS

        new_state = _advance_turn({
            **current_state,
            "pending_deltas": deltas,
            "pending_chasers": chasers,
            "skips_used": [*current_state["skips_used"], player_id],
            "last_event": {"type": "SKIP", "player_id": player_id},
        })
        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the turn deadline passed — verify on our clock,
        then reveal a random closed card on the idle player's behalf."""
        if int(time.time() * 1000) < int(current_state["turn_deadline_at"]):
            return current_state, False, {}

        current_player_id = current_state["current_player_id"]
        if current_player_id is None:
            return current_state, False, {}

        closed = [i for i, r in enumerate(current_state["revealed"]) if not r]
        slot_index = _rng.choice(closed)
        return self._resolve_reveal(
            current_player_id, slot_index, current_state, "timeout"
        )

    def _resolve_reveal(
        self,
        player_id: str,
        slot_index: int,
        current_state: dict[str, Any],
        reason: str,
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        closed_count = current_state["revealed"].count(False)
        revealed = list(current_state["revealed"])
        revealed[slot_index] = True

        if _rng.randrange(closed_count) == 0:  # poison — always hits at 1 closed
            new_state = {
                **current_state,
                "revealed": revealed,
                "poison_index": slot_index,
                "status": "DONE",
                "last_event": {
                    "type": "POISON",
                    "player_id": player_id,
                    "slot_index": slot_index,
                    "reason": reason,
                },
            }
            return new_state, True, _final_outcomes(new_state, loser_id=player_id)

        points = _SAFE_POINTS_BASE - closed_count
        deltas = dict(current_state["pending_deltas"])
        deltas[player_id] = deltas.get(player_id, 0) + points

        new_state = _advance_turn({
            **current_state,
            "revealed": revealed,
            "pending_deltas": deltas,
            "revealed_by": {
                **current_state["revealed_by"],
                str(slot_index): {"player_id": player_id, "points": points},
            },
            "last_event": {
                "type": "SAFE",
                "player_id": player_id,
                "slot_index": slot_index,
                "points": points,
                "reason": reason,
            },
        })
        return new_state, False, {}

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        """Hard stop for a fully stalled room — fast-forward the remaining
        turns as forced reveals so the round still ends with a real poison
        loser instead of an everyone-safe wash."""
        if current_state.get("status") == "DONE":
            return current_state, {}
        if not current_state.get("turn_order"):
            return {**current_state, "status": "DONE"}, {}

        state = current_state
        while True:
            closed = [i for i, r in enumerate(state["revealed"]) if not r]
            slot_index = _rng.choice(closed)
            state, finished, outcomes = self._resolve_reveal(
                state["current_player_id"], slot_index, state, "timeout"
            )
            if finished:
                return state, outcomes


def _advance_turn(state: dict[str, Any]) -> dict[str, Any]:
    order: list[str] = state["turn_order"]
    turn_index: int = state["turn_index"] + 1
    return {
        **state,
        "turn_index": turn_index,
        "round": turn_index // len(order) + 1,
        "current_player_id": order[turn_index % len(order)],
        "turn_deadline_at": int(time.time() * 1000) + _TURN_MS,
    }


def _final_outcomes(
    state: dict[str, Any], loser_id: str
) -> dict[str, dict[str, Any]]:
    deltas: dict[str, int] = state["pending_deltas"]
    chasers: dict[str, int] = state["pending_chasers"]
    poison_index: int = state["poison_index"]

    outcomes: dict[str, dict[str, Any]] = {}
    for pid in state["turn_order"]:
        if pid == loser_id:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": _POISON_CHASERS + chasers.get(pid, 0),
                "score_delta": _POISON_POINTS + deltas.get(pid, 0),
                "reason": "poison",
                "poison_index": poison_index,
            }
        else:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": chasers.get(pid, 0),
                "score_delta": deltas.get(pid, 0),
                "reason": "survived",
                "poison_index": poison_index,
            }
    return outcomes
