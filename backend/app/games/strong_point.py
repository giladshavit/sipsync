import random
import time
from typing import Any

from app.engine.base import BaseMiniGame
from app.games.scoring import rank_groups, uniform_scores

_ACTIVATE_DELAY_MS = 3_000

# The circle grows at a constant rate for a full 30 s — most rounds resolve
# long before it finishes, since the hit-zone is already live at full size
# the instant it appears (see class docstring); this is just the hard-stop
# grace window's basis.
_GROW_MS = 30_000
_TIMEOUT_MS = _GROW_MS + 3_000

_TARGET_DIAMETER_PX = 40

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class StrongPointGame(BaseMiniGame):
    """
    The screen is empty. After a fixed 3 s delay, a single point appears at a
    random spot and grows into a circle at a constant, deliberately slow
    rate over 30 s. Tap inside it and you send CLICK; tap outside it (or
    before it ever appears) and you send MISS.

    Server-as-judge follows the same split reflex.py uses: the server never
    trusts a client's CLICK claim about *timing* — it recomputes true_ts
    against activate_at and downgrades an early claim to "early_tap" — but
    it does trust the client's own claim about *space* (inside vs. outside
    the circle), since that depends on each device's own screen geometry.
    Same trust boundary as coin_flip's visible-to-the-room model.

    The hit-zone is always the full _TARGET_DIAMETER_PX the instant the
    point appears — the 30 s grow animation is purely cosmetic on the
    client, so tapping the instant the point appears (while it still looks
    tiny) scores exactly the same as tapping once it's fully grown.

    Scoring mirrors reflex.py's _compute_outcomes exactly: fastest valid
    click wins, only the slowest valid click among 2+ valid clicks drinks,
    and anyone missed/early/timed-out shares a flat -10 and 1 chaser.
    """

    game_id = "strong_point"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.strong_point"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        activate_at = now_ms + _ACTIVATE_DELAY_MS
        clock_offsets = {p["player_id"]: p.get("clock_offset", 0) for p in players}
        return {
            "status": "PENDING",
            "activate_at": activate_at,
            # Normalized [0,1] position — each client maps this into its own
            # safe pixel bounds (screen size minus the fixed diameter) so the
            # circle never clips on any device.
            "target": {"nx": _rng.random(), "ny": _rng.random()},
            "target_diameter_px": _TARGET_DIAMETER_PX,
            "grow_duration_ms": _GROW_MS,
            "taps": {},
            "clock_offsets": clock_offsets,
            "timeout_at": activate_at + _TIMEOUT_MS,
        }

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        taps: dict = current_state.get("taps", {})
        activate_at: int = int(current_state.get("activate_at", 0))
        clock_offsets: dict[str, int] = current_state.get("clock_offsets", {})
        outcomes = _compute_outcomes(taps, activate_at, clock_offsets)
        return {**current_state, "status": "DONE"}, outcomes

    def handle_ws_event(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        action = payload.get("action")
        if action not in ("CLICK", "MISS"):
            return current_state, False, {}

        activate_at: int = current_state["activate_at"]
        clock_offsets: dict[str, int] = current_state["clock_offsets"]
        timeout_at: int = current_state["timeout_at"]
        taps: dict[str, Any] = dict(current_state["taps"])

        if player_id in taps:
            return current_state, False, {}

        if action == "MISS":
            taps[player_id] = "missed"
        else:
            true_ts: int = payload["local_ts"] + clock_offsets.get(player_id, 0)
            taps[player_id] = "early" if true_ts < activate_at else true_ts

        new_state = {**current_state, "taps": taps}

        now_ms = int(time.time() * 1000)
        all_reported = set(taps.keys()) >= set(clock_offsets.keys())
        timed_out = now_ms >= timeout_at

        if not (all_reported or timed_out):
            return new_state, False, {}

        outcomes = _compute_outcomes(taps, activate_at, clock_offsets)
        return {**new_state, "status": "DONE"}, True, outcomes


def _compute_outcomes(
    taps: dict[str, Any],
    activate_at: int,
    clock_offsets: dict[str, int],
) -> dict[str, dict[str, Any]]:
    valid_deltas: dict[str, int] = {}
    dq_reasons: dict[str, str] = {}

    for pid in clock_offsets.keys():
        tap_val = taps.get(pid)
        if tap_val is None:
            dq_reasons[pid] = "timed_out"  # AFK / never reported
        elif tap_val == "missed":
            dq_reasons[pid] = "missed"  # tapped outside the zone
        elif tap_val == "early":
            dq_reasons[pid] = "early_tap"  # claimed CLICK before activation
        else:
            valid_deltas[pid] = tap_val - activate_at

    # Fastest valid click ranks first; missed/early/timed-out share last place
    scores = uniform_scores(rank_groups(valid_deltas), list(dq_reasons.keys()))

    outcomes: dict[str, dict[str, Any]] = {
        pid: {
            "result": "LOSE",
            "chasers": 1,
            "reason": reason,
            "score_delta": scores[pid],
        }
        for pid, reason in dq_reasons.items()
    }

    # If nobody made a valid click (all missed, early, or AFK)
    if not valid_deltas:
        return outcomes

    # If exactly one person made a valid click, they win automatically
    if len(valid_deltas) == 1:
        pid = list(valid_deltas.keys())[0]
        outcomes[pid] = {
            "result": "WIN",
            "chasers": 0,
            "score_delta": scores[pid],
            "reason": "only_valid",
            "reaction_ms": valid_deltas[pid],
        }
        return outcomes

    # With multiple valid clicks, only the slowest drinks
    slowest_delta = max(valid_deltas.values())

    for pid, delta in valid_deltas.items():
        if delta == slowest_delta:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": 1,
                "reason": "slowest",
                "score_delta": scores[pid],
                "reaction_ms": delta,
            }
        else:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": 0,
                "reason": "fast_enough",
                "score_delta": scores[pid],
                "reaction_ms": delta,
            }

    return outcomes
