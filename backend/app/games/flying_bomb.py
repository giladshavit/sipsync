import math
import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_ROUND_MS = 30_000
# EXPIRE is a watchdog nudge from clients; this only catches a fully stalled
# room where nobody's client ever sends it
_HARD_STOP_GRACE_MS = 8_000

_LOSE_SCORE_PER_BOMB = -7
_LOSE_CHASERS_PER_BOMB = 1

# How much a throw's velocity shrinks on handoff — divide, don't zero out,
# so the bomb still visibly carries momentum into the receiver's screen
# instead of arriving limp. Tuned down from ÷4, then ÷3 (both felt too
# damped/stuck) — currently experimenting with ÷2.
_VELOCITY_ATTENUATION = 2

# Clients report velocity normalized to screen-widths (x) / screen-heights
# (y) per second, not raw pixels — same reasoning as y_position's 0..1: a
# fling that's "4 screen-widths/s" reads as equally hard on any device,
# where a raw px/s value wouldn't (2000px/s covers far less of a tablet than
# a phone). Anything past this is a tampered/garbage report, not a real
# fling, so it's clamped rather than trusted outright (same spirit as
# tap_race's tap-count cap) — 30 screen-lengths/s is already far beyond any
# real swipe.
_MAX_PLAUSIBLE_VELOCITY = 30.0

_EXIT_SIDES = ("left", "right")

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class FlyingBombGame(BaseMiniGame):
    """
    Hot potato with live physics. Players sit on a random ring; ceil(N/3)
    bombs start on random hands, one each — tuned up from ceil(N/4), which
    left too many players sitting idle with nothing to do at any given
    moment. Swipe a bomb off either edge of
    your screen and the server routes it to your neighbor on that side of
    the ring, attenuating its velocity vector (÷2 on both axes) so it
    doesn't ricochet forever. Physics themselves (friction, the fly-out/
    fly-in motion, bouncing off the top/bottom of the screen) are entirely
    client-side — the server only tracks who's currently holding each bomb
    and relays the throw's full (x, y) velocity, normalized to screen-
    widths/heights per second rather than raw pixels so it reads as equally
    hard on any device, plus its entry position, so the receiving client can
    pick up the motion — in the same direction, not just horizontally, and
    at the same felt strength — where the thrower left off.
    A bomb's `seq` increments on every throw so a client can tell "this bomb
    just arrived for me" apart from state it already rendered.

    Whoever is still holding one or more bombs when the 30s clock runs out
    drinks -7 and a chaser per bomb; empty-handed players are safe. Nobody
    is ranked against anyone else, so there's no tie to resolve.

    Deadline enforcement follows the coin_flip/sacrifice "expire" pattern:
    clients watch the broadcast `round_end_at` and send an EXPIRE action,
    which the server validates against its own clock. The engine's
    `timeout_at` task remains as a hard stop for a stalled room.
    """

    game_id = "flying_bomb"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.flying_bomb"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        round_end_at = now_ms + _ROUND_MS
        ids = [p["player_id"] for p in players]

        ring_order = ids[:]
        _rng.shuffle(ring_order)

        bomb_count = math.ceil(len(ids) / 3)
        holders = _rng.sample(ids, bomb_count)
        bombs = {
            f"bomb_{i}": {
                "holder_id": holder,
                "seq": 0,
                "entry_side": None,
                "velocity_x": None,
                "velocity_y": None,
                "y_position": None,
            }
            for i, holder in enumerate(holders)
        }

        return {
            "status": "PLAYING",
            "ring_order": ring_order,
            "bombs": bombs,
            "round_ms": _ROUND_MS,
            "round_end_at": round_end_at,
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": round_end_at + _HARD_STOP_GRACE_MS,
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
        if action == "THROW_BOMB":
            return self._handle_throw(player_id, payload, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_throw(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        bomb_id = payload.get("bomb_id")
        exit_side = payload.get("exit_side")
        bombs: dict[str, dict[str, Any]] = current_state["bombs"]
        bomb = bombs.get(bomb_id)

        if bomb is None or bomb["holder_id"] != player_id:
            return current_state, False, {}  # not yours to throw — spoofed or stale
        if exit_side not in _EXIT_SIDES:
            return current_state, False, {}

        try:
            velocity_x = float(payload.get("velocity_x", 0))
            velocity_y = float(payload.get("velocity_y", 0))
            y_position = float(payload.get("y_position", 0))
        except (TypeError, ValueError):
            return current_state, False, {}

        velocity_x = max(-_MAX_PLAUSIBLE_VELOCITY, min(_MAX_PLAUSIBLE_VELOCITY, velocity_x))
        velocity_y = max(-_MAX_PLAUSIBLE_VELOCITY, min(_MAX_PLAUSIBLE_VELOCITY, velocity_y))
        y_position = max(0.0, min(1.0, y_position))

        ring_order: list[str] = current_state["ring_order"]
        idx = ring_order.index(player_id)
        neighbor = (
            ring_order[(idx + 1) % len(ring_order)]
            if exit_side == "right"
            else ring_order[(idx - 1) % len(ring_order)]
        )

        new_bombs = {
            **bombs,
            bomb_id: {
                "holder_id": neighbor,
                "seq": bomb["seq"] + 1,
                "entry_side": "left" if exit_side == "right" else "right",
                "velocity_x": velocity_x / _VELOCITY_ATTENUATION,
                "velocity_y": velocity_y / _VELOCITY_ATTENUATION,
                "y_position": y_position,
            },
        }
        return {**current_state, "bombs": new_bombs}, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the round clock ran out — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["round_end_at"]):
            return current_state, False, {}
        return self._finish(current_state)

    def _finish(
        self, state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        final_state = {**state, "status": "DONE"}
        return final_state, True, _compute_outcomes(final_state)

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        if current_state.get("status") == "DONE":
            return current_state, {}
        new_state, _, outcomes = self._finish(current_state)
        return new_state, outcomes


def _compute_outcomes(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    bombs: dict[str, dict[str, Any]] = state["bombs"]
    clock_offsets: dict[str, int] = state["clock_offsets"]

    bombs_held: dict[str, int] = {pid: 0 for pid in clock_offsets}
    for bomb in bombs.values():
        holder = bomb["holder_id"]
        if holder in bombs_held:
            bombs_held[holder] += 1

    outcomes: dict[str, dict[str, Any]] = {}
    for pid, count in bombs_held.items():
        if count > 0:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": count * _LOSE_CHASERS_PER_BOMB,
                "score_delta": count * _LOSE_SCORE_PER_BOMB,
                "reason": "holding_bomb",
                "bombs_held": count,
            }
        else:
            outcomes[pid] = {
                "result": "SAFE",
                "chasers": 0,
                "score_delta": 0,
                "reason": "clear",
                "bombs_held": 0,
            }
    return outcomes
