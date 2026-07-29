import time
from typing import Any

from app.engine.base import BaseMiniGame
from app.games.scoring import rank_groups, uniform_scores

_COUNTDOWN_MS = 3_000
_RACE_MS = 10_000
# Grace period after the race ends for final tap reports to arrive
_REPORT_GRACE_MS = 2_000

# Physical ceiling — anything above this is a tampered report, not thumbs
_MAX_PLAUSIBLE_TAPS = 250


class TapRaceGame(BaseMiniGame):
    """
    Tap as many times as possible in 10 seconds.
    Fewest taps drinks a chaser; scores spread evenly from +10 (most taps)
    down to -10 (fewest) across all placements.

    Clients count taps locally and report a single final count when the
    window closes (one WS message per player instead of one per tap).
    The count itself is client-attested — acceptable for a party game;
    per-tap server judging would flood the socket for marginal gain.
    """

    game_id = "tap_race"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.tap_race"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        start_at = now_ms + _COUNTDOWN_MS
        end_at = start_at + _RACE_MS
        clock_offsets = {p["player_id"]: p.get("clock_offset", 0) for p in players}
        return {
            "start_at": start_at,
            "end_at": end_at,
            "status": "COUNTDOWN",
            # pid → final tap count (key named "taps" to match the engine's
            # everyone-reported guard in the shared timeout path)
            "taps": {},
            "clock_offsets": clock_offsets,
            "timeout_at": end_at + _REPORT_GRACE_MS,
        }

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if payload.get("action") != "taps_final":
            return current_state, False, {}

        taps: dict[str, int] = dict(current_state["taps"])
        if player_id in taps:  # first report wins; ignore duplicates
            return current_state, False, {}

        try:
            count = int(payload.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        taps[player_id] = max(0, min(count, _MAX_PLAUSIBLE_TAPS))

        new_state = {**current_state, "taps": taps}

        clock_offsets: dict[str, int] = current_state["clock_offsets"]
        if set(taps.keys()) >= set(clock_offsets.keys()):
            outcomes = _compute_outcomes(taps, clock_offsets)
            return {**new_state, "status": "DONE"}, True, outcomes

        return new_state, False, {}

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        taps: dict[str, int] = dict(current_state.get("taps", {}))
        clock_offsets: dict[str, int] = current_state.get("clock_offsets", {})
        outcomes = _compute_outcomes(taps, clock_offsets)
        return {**current_state, "status": "DONE"}, outcomes


def _compute_outcomes(
    taps: dict[str, int],
    clock_offsets: dict[str, int],
) -> dict[str, dict[str, Any]]:
    if not clock_offsets:
        return {}

    counts = {pid: count for pid, count in taps.items() if pid in clock_offsets}
    # Players who never reported (disconnected / AFK) are disqualified
    forfeits = [pid for pid in clock_offsets.keys() if pid not in counts]
    scores = uniform_scores(rank_groups(counts, higher_is_better=True), forfeits)

    outcomes: dict[str, dict[str, Any]] = {
        pid: {
            "result": "LOSE",
            "chasers": 1,
            "score_delta": scores[pid],
            "reason": "no_report",
            "taps": 0,
        }
        for pid in forfeits
    }

    if not counts:
        return outcomes

    lowest = min(counts.values())
    highest = max(counts.values())

    # Dead heat — everyone tapped the same amount, nobody drinks
    if lowest == highest and not forfeits:
        for pid, count in counts.items():
            outcomes[pid] = {
                "result": "SAFE",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "dead_heat",
                "taps": count,
            }
        return outcomes

    for pid, count in counts.items():
        if count == highest:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "most_taps",
                "taps": count,
            }
        elif count == lowest and not forfeits:
            # Fewest taps only drinks when no forfeiter took the fall instead
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "score_delta": scores[pid],
                "reason": "fewest_taps",
                "taps": count,
            }
        else:
            outcomes[pid] = {
                "result": "SAFE",
                "chasers": 0,
                "score_delta": scores[pid],
                "reason": "kept_pace",
                "taps": count,
            }

    return outcomes
