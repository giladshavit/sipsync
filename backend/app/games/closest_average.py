import random
import time
from typing import Any

from app.engine.base import BaseMiniGame
from app.games.scoring import rank_groups, uniform_scores

_DECISION_MS = 15_000
# Grace period after the deadline for a client's own auto-submit (whatever
# the slider/wheel is sitting on when time's up) to reach the server before
# the timeout path falls back to a random pick — same pattern as tap_race's
# _REPORT_GRACE_MS, since the server's timer needs no network round trip and
# would otherwise almost always win that race.
_REPORT_GRACE_MS = 2_000

_MIN_NUMBER = 0
_MAX_NUMBER = 99

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class ClosestAverageGame(BaseMiniGame):
    """
    Everyone picks a number 0-99; whoever lands closest to the room's
    average wins, whoever lands farthest drinks. Clients auto-submit
    whatever their picker is sitting on the moment the deadline hits, so
    only players who are genuinely gone (disconnected, never opened the
    screen) fall through to the server's random fallback (tagged
    `auto_picked`) — that keeps a single AFK player from stalling the round
    or dodging the average.

    Numbers are broadcast verbatim in game state, same trust model as
    roulette/coin_flip: clients simply don't render other players' picks
    until the round resolves.
    """

    game_id = "closest_average"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.closest_average"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        deadline_at = now_ms + _DECISION_MS
        clock_offsets = {p["player_id"]: p.get("clock_offset", 0) for p in players}
        return {
            "status": "PLAYING",
            "deadline_at": deadline_at,
            "numbers": {},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": clock_offsets,
            "timeout_at": deadline_at + _REPORT_GRACE_MS,
        }

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if payload.get("action") != "SUBMIT_NUMBER":
            return current_state, False, {}

        numbers: dict[str, int] = dict(current_state["numbers"])
        if player_id in numbers:  # first submission wins; ignore duplicates
            return current_state, False, {}

        try:
            number = int(payload.get("number"))
        except (TypeError, ValueError):
            number = 0
        numbers[player_id] = max(_MIN_NUMBER, min(number, _MAX_NUMBER))

        new_state = {**current_state, "numbers": numbers}

        clock_offsets: dict[str, int] = current_state["clock_offsets"]
        if set(numbers.keys()) >= set(clock_offsets.keys()):
            outcomes = _compute_outcomes(numbers, clock_offsets, [])
            return {**new_state, "status": "DONE"}, True, outcomes

        return new_state, False, {}

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        numbers: dict[str, int] = dict(current_state.get("numbers", {}))
        clock_offsets: dict[str, int] = current_state.get("clock_offsets", {})

        auto_filled = [pid for pid in clock_offsets if pid not in numbers]
        for pid in auto_filled:
            numbers[pid] = _rng.randint(_MIN_NUMBER, _MAX_NUMBER)

        outcomes = _compute_outcomes(numbers, clock_offsets, auto_filled)
        return {**current_state, "numbers": numbers, "status": "DONE"}, outcomes


def _compute_outcomes(
    numbers: dict[str, int],
    clock_offsets: dict[str, int],
    auto_filled: list[str],
) -> dict[str, dict[str, Any]]:
    if not clock_offsets:
        return {}

    average = sum(numbers.values()) / len(numbers)
    distances = {pid: abs(numbers[pid] - average) for pid in clock_offsets}
    scores = uniform_scores(rank_groups(distances))

    closest = min(distances.values())
    farthest = max(distances.values())

    def base_outcome(pid: str, result: str, chasers: int, reason: str) -> dict[str, Any]:
        return {
            "result": result,
            "chasers": chasers,
            "reason": reason,
            "score_delta": scores[pid],
            "number": numbers[pid],
            "average": round(average, 1),
            "distance": round(distances[pid], 1),
            "auto_picked": pid in auto_filled,
        }

    # Dead heat — with exactly 2 players this is always true, since the
    # average of two numbers is equidistant from both by definition
    if closest == farthest:
        return {
            pid: base_outcome(pid, "SAFE", 0, "dead_heat") for pid in clock_offsets
        }

    outcomes: dict[str, dict[str, Any]] = {}
    for pid in clock_offsets:
        if distances[pid] == closest:
            outcomes[pid] = base_outcome(pid, "WIN", 0, "closest")
        elif distances[pid] == farthest:
            outcomes[pid] = base_outcome(pid, "LOSE", 1, "farthest")
        else:
            outcomes[pid] = base_outcome(pid, "SAFE", 0, "kept_pace")

    return outcomes
