import math
import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_GREEN_MIN_MS = 3_000
_GREEN_MAX_MS = 8_000
_TIMEOUT_MS = 5_000
_RED_TAP_CHASERS = 5


class RedLightGreenLight(BaseMiniGame):
    game_id = "red_light_green_light"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.red_light_green_light"

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
    valid_deltas: dict[str, int] = {}

    for pid, value in taps.items():
        if value == "red":
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": _RED_TAP_CHASERS,
                "reason": "early_tap",
                "score_delta": _RED_TAP_CHASERS,
            }
        else:
            valid_deltas[pid] = value - execute_at

    # Players who never tapped (timed out) get the max possible penalty
    for pid in clock_offsets:
        if pid not in taps:
            valid_deltas[pid] = _TIMEOUT_MS + 1

    if not valid_deltas:
        return outcomes

    slowest_pid = max(valid_deltas, key=lambda p: valid_deltas[p])
    for pid, delta_ms in valid_deltas.items():
        if pid == slowest_pid:
            chasers = max(1, math.ceil(delta_ms / 500))
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": chasers,
                "reason": "slowest",
                "score_delta": chasers,
            }
        else:
            outcomes[pid] = {"result": "WIN", "chasers": 0, "score_delta": 0}

    return outcomes
