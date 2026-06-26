import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_GREEN_MIN_MS = 3_000
_GREEN_MAX_MS = 8_000
_TIMEOUT_MS = 5_000


class ReflexGame(BaseMiniGame):
    game_id = "reflex"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.reflex"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        execute_at = now_ms + random.randint(_GREEN_MIN_MS, _GREEN_MAX_MS)
        clock_offsets = {p["player_id"]: p.get("clock_offset", 0) for p in players}
        return {
            "execute_at": execute_at,
            "status": "RED",
            "taps": {},
            "clock_offsets": clock_offsets,
            "timeout_at": execute_at + _TIMEOUT_MS,
        }

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        taps: dict = current_state.get("taps", {})
        execute_at: int = int(current_state.get("execute_at", 0))
        clock_offsets: dict[str, int] = current_state.get("clock_offsets", {})
        outcomes = _compute_outcomes(taps, execute_at, clock_offsets)
        return {**current_state, "status": "DONE"}, outcomes

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if payload.get("action") != "tap":
            return current_state, False, {}

        execute_at: int = current_state["execute_at"]
        clock_offsets: dict[str, int] = current_state["clock_offsets"]
        timeout_at: int = current_state["timeout_at"]
        taps: dict[str, Any] = dict(current_state["taps"])

        if player_id in taps:
            return current_state, False, {}

        true_ts: int = payload["local_ts"] + clock_offsets.get(player_id, 0)
        taps[player_id] = "red" if true_ts < execute_at else true_ts

        new_state = {**current_state, "taps": taps}

        now_ms = int(time.time() * 1000)
        all_tapped = set(taps.keys()) >= set(clock_offsets.keys())
        timed_out = now_ms >= timeout_at

        if not (all_tapped or timed_out):
            return new_state, False, {}

        outcomes = _compute_outcomes(taps, execute_at, clock_offsets)
        return {**new_state, "status": "DONE"}, True, outcomes


def _compute_outcomes(
    taps: dict[str, Any],
    execute_at: int,
    clock_offsets: dict[str, int],
) -> dict[str, dict[str, Any]]:
    outcomes: dict[str, dict[str, Any]] = {}
    green_deltas: dict[str, int] = {}

    for pid in clock_offsets.keys():
        tap_val = taps.get(pid)

        # 1. AFK / Never Tapped (Timeout)
        if tap_val is None:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "reason": "timed_out",
                "score_delta": -1,
            }
            continue

        # 2. False Start (Tapped on Red)
        if tap_val == "red":
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "reason": "early_tap",
                "score_delta": -1,
            }
            continue

        # 3. Valid Green Tap
        green_deltas[pid] = tap_val - execute_at

    # If nobody made a valid green tap (all early or AFK)
    if not green_deltas:
        return outcomes

    # If exactly one person made a valid green tap, they win automatically
    if len(green_deltas) == 1:
        pid = list(green_deltas.keys())[0]
        outcomes[pid] = {
            "result": "WIN",
            "chasers": 0,
            "score_delta": 1,
            "reason": "only_valid",
        }
        return outcomes

    # If multiple valid taps, find the slowest
    slowest_delta = max(green_deltas.values())

    for pid, delta in green_deltas.items():
        if delta == slowest_delta:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "reason": "slowest",
                "score_delta": -1,
            }
        else:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": 0,
                "score_delta": 1,
                "reason": "fast_enough",
            }

    return outcomes
