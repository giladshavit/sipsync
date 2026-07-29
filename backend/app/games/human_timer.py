import random
import time
from typing import Any

from app.engine.base import BaseMiniGame
from app.games.scoring import rank_groups, uniform_scores

_REVEAL_MS = 3_000     # target number on screen before the countdown
_COUNTDOWN_MS = 3_000  # 3 · 2 · 1
_TARGET_MIN_S = 10
_TARGET_MAX_S = 30
# Once the worst tapped error can no longer be beaten, wait this long
# for stragglers before ending the round
_STRAGGLER_GRACE_MS = 10_000


class HumanTimerGame(BaseMiniGame):
    """
    Count the target seconds in your head and tap when they're up — no clock.
    Farthest from the target drinks a chaser; scores spread evenly from
    +10 (closest) down to -10 (farthest) across all placements.

    A round ends when the first of these happens:
    1. Everyone tapped.
    2. The dynamic deadline passed: target + worst-error-so-far + 10 s grace —
       anyone still counting is already the guaranteed loser. Clients watch
       the broadcast state and send an "expire" action; the server validates
       it against its own clock before finishing.
    3. Twice the target elapsed (hard stop via the engine's timeout task).
    """

    game_id = "human_timer"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.human_timer"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        target_s = random.randint(_TARGET_MIN_S, _TARGET_MAX_S)
        start_at = now_ms + _REVEAL_MS + _COUNTDOWN_MS
        clock_offsets = {p["player_id"]: p.get("clock_offset", 0) for p in players}
        return {
            "target_s": target_s,
            "countdown_at": now_ms + _REVEAL_MS,
            "start_at": start_at,
            "status": "REVEAL",
            # pid → elapsed ms at tap (server-corrected)
            "taps": {},
            "clock_offsets": clock_offsets,
            "timeout_at": start_at + 2 * target_s * 1_000,
        }

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if current_state.get("status") == "DONE":
            return current_state, False, {}

        action = payload.get("action")
        if action == "tap":
            return self._handle_tap(player_id, payload, current_state)
        if action == "expire":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_tap(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        taps: dict[str, int] = dict(current_state["taps"])
        if player_id in taps:
            return current_state, False, {}

        start_at: int = current_state["start_at"]
        clock_offsets: dict[str, int] = current_state["clock_offsets"]

        true_ts: int = payload["local_ts"] + clock_offsets.get(player_id, 0)
        taps[player_id] = max(0, true_ts - start_at)

        new_state = {**current_state, "taps": taps}

        if set(taps.keys()) >= set(clock_offsets.keys()):
            outcomes = _compute_outcomes(
                taps, current_state["target_s"] * 1_000, clock_offsets
            )
            return {**new_state, "status": "DONE"}, True, outcomes

        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the dynamic deadline passed — verify on our clock."""
        taps: dict[str, int] = current_state["taps"]
        if not taps:
            return current_state, False, {}  # nobody tapped: only conditions 1/3 apply

        target_ms: int = current_state["target_s"] * 1_000
        start_at: int = current_state["start_at"]
        worst_err = max(abs(elapsed - target_ms) for elapsed in taps.values())
        deadline = min(
            start_at + target_ms + worst_err + _STRAGGLER_GRACE_MS,
            int(current_state["timeout_at"]),
        )

        if int(time.time() * 1000) < deadline:
            return current_state, False, {}

        clock_offsets: dict[str, int] = current_state["clock_offsets"]
        outcomes = _compute_outcomes(taps, target_ms, clock_offsets)
        return {**current_state, "status": "DONE"}, True, outcomes

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        taps: dict[str, int] = dict(current_state.get("taps", {}))
        target_ms: int = current_state.get("target_s", 0) * 1_000
        clock_offsets: dict[str, int] = current_state.get("clock_offsets", {})
        outcomes = _compute_outcomes(taps, target_ms, clock_offsets)
        return {**current_state, "status": "DONE"}, outcomes


def _compute_outcomes(
    taps: dict[str, int],
    target_ms: int,
    clock_offsets: dict[str, int],
) -> dict[str, dict[str, Any]]:
    if not clock_offsets:
        return {}

    errors = {pid: abs(elapsed - target_ms) for pid, elapsed in taps.items()}
    forfeits = [pid for pid in clock_offsets.keys() if pid not in taps]
    # Closest to the target ranks first; forfeiters share last place
    scores = uniform_scores(rank_groups(errors), forfeits)

    outcomes: dict[str, dict[str, Any]] = {}

    # Nobody tapped at all — everyone drinks
    if not errors:
        for pid in forfeits:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "score_delta": scores[pid],
                "reason": "no_tap",
                "target_ms": target_ms,
            }
        return outcomes

    best = min(errors.values())
    worst = max(errors.values())

    # Everyone who tapped landed the same error and nobody forfeited — a wash
    dead_heat = best == worst and not forfeits

    for pid, err in errors.items():
        elapsed = taps[pid]
        base = {
            "elapsed_ms": elapsed,
            "error_ms": err,
            "target_ms": target_ms,
        }
        if dead_heat:
            outcomes[pid] = {
                **base,
                "result": "SAFE",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "dead_heat",
            }
        elif err == best:
            outcomes[pid] = {
                **base,
                "result": "WIN",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "closest",
            }
        elif err == worst and not forfeits:
            # Farthest only drinks when no forfeiter took the fall instead
            outcomes[pid] = {
                **base,
                "result": "LOSE",
                "chasers": 1,
                "score_delta": scores[pid],
                "reason": "farthest",
            }
        else:
            outcomes[pid] = {
                **base,
                "result": "SAFE",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "in_between",
            }

    for pid in forfeits:
        outcomes[pid] = {
            "result": "LOSE",
            "chasers": 1,
            "score_delta": scores[pid],
            "reason": "no_tap",
            "target_ms": target_ms,
        }

    return outcomes
