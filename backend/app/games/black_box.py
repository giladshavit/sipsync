import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_SELECT_MS = 15_000
_BLUFF_MS = 30_000
_DISTRIBUTE_MS = 20_000
# EXPIRE is a watchdog nudge from clients; this only catches a fully stalled
# room where nobody's client ever sends it
_HARD_STOP_GRACE_MS = 6_000

_BOX_COUNT = 6
_DRINK_BOX_COUNT = 3
_DISTRIBUTE_BOX_COUNT = 3
_BOX_CHASERS_MIN = 1
_BOX_CHASERS_MAX = 3

_DRINK_POINTS_PER_CHASER = -5
_DISTRIBUTE_POINTS_PER_CHASER = 5

# Auction's DISTRIBUTING mechanic caps a recipient at 2, which assumes the
# pool is always split across several recipients. This game's pool can land
# entirely on a single opponent (a 2-player duel has exactly one recipient),
# so the cap is raised to the box's own max chaser count — the one recipient
# in a 2-player room must always be able to absorb a full 3-chaser box alone.
RECIPIENT_MAX_CHASERS = _BOX_CHASERS_MAX

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class BlackBoxGame(BaseMiniGame):
    """
    Two players are picked at random: Player A (the Holder) and Player B (the
    Guesser). Everyone else spectates. Six identical-looking boxes are
    generated, each secretly Drink or Distribute with 1-3 chasers. A has 15s
    to pick one (EXPIRE auto-picks a random box); once chosen, A bluffs its
    contents to B, who has 30s to TAKE_BOX (it becomes A's gift to B) or
    LEAVE_BOX (A keeps it) — EXPIRE defaults to LEAVE_BOX. Whoever ends up
    holding the box is the Target Player.

    A Drink box ends the round immediately: the Target Player drinks its
    chasers. A Distribute box instead reuses auction's DISTRIBUTING phase
    verbatim — the Target Player taps through the other players (cycling
    their assigned chasers 0..RECIPIENT_MAX_CHASERS..0) and submits once the
    box's full chaser count is placed, with the same EXPIRE fallback-fill for
    a stalled distributor.

    Trust note: like coin_flip, all 6 box contents ride in broadcast state
    from round start (there's no per-client payload filtering anywhere in
    this codebase to do otherwise) — only A's client is expected to render
    `boxes[chosen_box_index]` before the reveal transition. B's and
    spectators' clients simply don't show any box content until the round
    resolves. Same party-trust boundary as every other hidden value in this
    app, not a technical guarantee.

    Timeout enforcement follows the auction/dilemma "expire" pattern once per
    phase (EXPIRE_SELECT, EXPIRE_BLUFF, EXPIRE_DISTRIBUTE), each validated
    against the server's own clock. `timeout_at` is a single fixed hard stop
    computed once at round start (no phase here resets its own deadline, so
    unlike auction's bid war there's no need for an extension pad) — a last
    resort for a fully stalled room. `on_timeout` walks whichever phase(s)
    are still unresolved in one wake-up, auction-style.
    """

    game_id = "black_box"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.black_box"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        ids = [p["player_id"] for p in players]
        player_a_id, player_b_id = _rng.sample(ids, 2)
        select_deadline_at = now_ms + _SELECT_MS

        return {
            "status": "BOX_SELECTION",
            "player_a_id": player_a_id,
            "player_b_id": player_b_id,
            "boxes": _generate_boxes(),
            "chosen_box_index": None,
            "select_ms": _SELECT_MS,
            "select_deadline_at": select_deadline_at,
            "bluff_ms": _BLUFF_MS,
            "bluff_deadline_at": None,
            "decision": None,
            "target_player_id": None,
            "distribute_ms": _DISTRIBUTE_MS,
            "distribute_deadline_at": None,
            "assignments": {},
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": select_deadline_at
            + _BLUFF_MS
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

        if status == "BOX_SELECTION":
            if action == "SELECT_BOX":
                return self._handle_select_box(player_id, payload, current_state)
            if action == "EXPIRE_SELECT":
                return self._handle_expire_select(current_state)
            return current_state, False, {}

        if status == "BLUFFING":
            if action == "TAKE_BOX":
                return self._handle_decision(player_id, "TAKE_BOX", current_state)
            if action == "LEAVE_BOX":
                return self._handle_decision(player_id, "LEAVE_BOX", current_state)
            if action == "EXPIRE_BLUFF":
                return self._handle_expire_bluff(current_state)
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

    def _handle_select_box(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["player_a_id"]:
            return current_state, False, {}

        box_index = payload.get("box_index")
        if not isinstance(box_index, int) or isinstance(box_index, bool):
            return current_state, False, {}
        if not 0 <= box_index < _BOX_COUNT:
            return current_state, False, {}

        return self._start_bluffing(current_state, box_index), False, {}

    def _handle_expire_select(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the select window passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["select_deadline_at"]):
            return current_state, False, {}
        return self._start_bluffing(current_state, _rng.randrange(_BOX_COUNT)), False, {}

    def _start_bluffing(
        self, current_state: dict[str, Any], box_index: int
    ) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        return {
            **current_state,
            "status": "BLUFFING",
            "chosen_box_index": box_index,
            "bluff_deadline_at": now_ms + _BLUFF_MS,
        }

    def _handle_decision(
        self, player_id: str, decision: str, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["player_b_id"]:
            return current_state, False, {}
        return self._resolve_bluff(current_state, decision)

    def _handle_expire_bluff(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the bluff window passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["bluff_deadline_at"]):
            return current_state, False, {}
        return self._resolve_bluff(current_state, "LEAVE_BOX")

    def _resolve_bluff(
        self, current_state: dict[str, Any], decision: str
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        target_player_id = (
            current_state["player_b_id"]
            if decision == "TAKE_BOX"
            else current_state["player_a_id"]
        )
        box = current_state["boxes"][current_state["chosen_box_index"]]
        state = {
            **current_state,
            "decision": decision,
            "target_player_id": target_player_id,
        }

        if box["type"] == "DRINK":
            return self._finish_drink(state, box, target_player_id)
        return self._start_distributing(state, box, target_player_id), False, {}

    def _finish_drink(
        self, state: dict[str, Any], box: dict[str, Any], target_player_id: str
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        chasers = box["chasers"]
        outcomes: dict[str, dict[str, Any]] = {
            pid: {"result": "SAFE", "chasers": 0, "score_delta": 0, "reason": "not_target"}
            for pid in state["clock_offsets"]
        }
        outcomes[target_player_id] = {
            "result": "LOSE",
            "chasers": chasers,
            "score_delta": _DRINK_POINTS_PER_CHASER * chasers,
            "reason": "drank",
        }
        new_state = {**state, "status": "DONE"}
        return new_state, True, outcomes

    def _start_distributing(
        self, state: dict[str, Any], box: dict[str, Any], target_player_id: str
    ) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        recipients = [pid for pid in state["clock_offsets"] if pid != target_player_id]
        return {
            **state,
            "status": "DISTRIBUTING",
            "assignments": {pid: 0 for pid in recipients},
            "distribute_deadline_at": now_ms + _DISTRIBUTE_MS,
        }

    def _handle_assign(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["target_player_id"]:
            return current_state, False, {}

        recipient_id = payload.get("recipient_player_id")
        assignments = current_state["assignments"]
        if recipient_id not in assignments:
            return current_state, False, {}

        new_assignments = {
            **assignments,
            recipient_id: (assignments[recipient_id] + 1) % (RECIPIENT_MAX_CHASERS + 1),
        }
        return {**current_state, "assignments": new_assignments}, False, {}

    def _handle_submit(
        self, player_id: str, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id != current_state["target_player_id"]:
            return current_state, False, {}
        box = current_state["boxes"][current_state["chosen_box_index"]]
        if sum(current_state["assignments"].values()) != box["chasers"]:
            return current_state, False, {}
        return self._finish_distribute(current_state, box)

    def _handle_expire_distribute(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the distribute window passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["distribute_deadline_at"]):
            return current_state, False, {}
        box = current_state["boxes"][current_state["chosen_box_index"]]
        return self._finish_distribute(_fallback_fill(current_state, box), box)

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        status = current_state.get("status")
        if status == "DONE":
            return current_state, {}

        state = current_state
        if status == "BOX_SELECTION":
            state = self._start_bluffing(state, _rng.randrange(_BOX_COUNT))

        if state["status"] == "BLUFFING":
            new_state, finished, outcomes = self._resolve_bluff(state, "LEAVE_BOX")
            if finished:
                return new_state, outcomes
            state = new_state

        box = state["boxes"][state["chosen_box_index"]]
        new_state, _, outcomes = self._finish_distribute(_fallback_fill(state, box), box)
        return new_state, outcomes

    def _finish_distribute(
        self, state: dict[str, Any], box: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        target_player_id: str = state["target_player_id"]
        chasers = box["chasers"]
        assignments: dict[str, int] = state["assignments"]

        outcomes: dict[str, dict[str, Any]] = {
            target_player_id: {
                "result": "WIN",
                "chasers": 0,
                "score_delta": _DISTRIBUTE_POINTS_PER_CHASER * chasers,
                "reason": "distributed",
            }
        }
        for pid, assigned in assignments.items():
            outcomes[pid] = {
                "result": "LOSE" if assigned > 0 else "SAFE",
                "chasers": assigned,
                "score_delta": 0,
                "reason": "assigned" if assigned > 0 else "spared",
            }

        new_state = {**state, "status": "DONE"}
        return new_state, True, outcomes


def _generate_boxes() -> list[dict[str, Any]]:
    boxes = [
        {"type": "DRINK", "chasers": _rng.randint(_BOX_CHASERS_MIN, _BOX_CHASERS_MAX)}
        for _ in range(_DRINK_BOX_COUNT)
    ]
    boxes += [
        {"type": "DISTRIBUTE", "chasers": _rng.randint(_BOX_CHASERS_MIN, _BOX_CHASERS_MAX)}
        for _ in range(_DISTRIBUTE_BOX_COUNT)
    ]
    _rng.shuffle(boxes)
    return boxes


def _fallback_fill(state: dict[str, Any], box: dict[str, Any]) -> dict[str, Any]:
    """Randomly (and fairly) place whatever's left of the box's chasers —
    players with fewer chasers already assigned are filled first, ties
    broken at random, nobody exceeds RECIPIENT_MAX_CHASERS."""
    assignments = dict(state["assignments"])
    remaining = box["chasers"] - sum(assignments.values())

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
