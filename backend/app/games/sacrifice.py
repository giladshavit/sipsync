import math
import time
from typing import Any

from app.engine.base import BaseMiniGame

_TURN_MS = 30_000
# EXPIRE is a watchdog nudge from clients; this only catches a fully stalled
# room where nobody's client ever sends it
_HARD_STOP_GRACE_MS = 5_000

_SUCCESS_POINTS_PER_PLEDGE = 10
# Failure only costs points for whoever actually pledged — bystanders still
# drink the room's flat 1-chaser "draft" tax (nobody skips a failed
# sacrifice), but score_delta 0, since they never signed up for anything.
# Volunteers pay this rate on every chaser they hold, including that same
# draft chaser.
_FAILURE_POINTS_PER_CHASER = -5


class SacrificeGame(BaseMiniGame):
    """
    The room needs `target_chasers` volunteered before a 30 s clock runs out.
    Anyone can tap PLEDGE (repeatedly) to commit themselves to one more
    chaser; the moment pledges reach the target the room is saved. If time
    runs out first, everyone drinks — pledgers take their pledged chasers
    plus one, everyone else is drafted for one.

    Deadline enforcement follows the roulette/coin_flip "expire" pattern:
    clients watch the broadcast `turn_deadline_at` and send an EXPIRE action,
    which the server validates against its own clock. The engine's
    `timeout_at` task remains as a hard stop for a fully stalled room.

    Scoring asymmetry is the whole point of the game: a successful pledge
    pays out (+10/chaser) even though the pledger still drinks — they're the
    hero, not the loser. A failed room still makes everyone drink, but only
    charges points to whoever actually pledged (-5/chaser, including the
    forced draft chaser) — bystanders who never stepped up drink their draft
    chaser same as anyone else, but score 0, not a penalty for a sacrifice
    they didn't make.
    """

    game_id = "sacrifice"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.sacrifice"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        turn_deadline_at = now_ms + _TURN_MS
        ids = [p["player_id"] for p in players]
        target_chasers = math.floor(len(players) / 3) + 1

        return {
            "status": "PLAYING",
            "target_chasers": target_chasers,
            "pledged_total": 0,
            "pledges": {pid: 0 for pid in ids},
            "turn_ms": _TURN_MS,
            "turn_deadline_at": turn_deadline_at,
            "last_event": None,
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": turn_deadline_at + _HARD_STOP_GRACE_MS,
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
        if action == "PLEDGE":
            return self._handle_pledge(player_id, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_pledge(
        self,
        player_id: str,
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id not in current_state["clock_offsets"]:
            return current_state, False, {}

        pledges = dict(current_state["pledges"])
        pledges[player_id] = pledges.get(player_id, 0) + 1
        pledged_total = current_state["pledged_total"] + 1

        new_state = {
            **current_state,
            "pledges": pledges,
            "pledged_total": pledged_total,
            "last_event": {
                "type": "PLEDGE",
                "player_id": player_id,
                "pledges": pledges[player_id],
                "pledged_total": pledged_total,
            },
        }

        if pledged_total >= current_state["target_chasers"]:
            final_state = {**new_state, "status": "DONE"}
            return final_state, True, _success_outcomes(final_state)

        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the global deadline passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["turn_deadline_at"]):
            return current_state, False, {}
        return self._finish_failure(current_state)

    def _finish_failure(
        self, state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        final_state = {**state, "status": "DONE"}
        return final_state, True, _failure_outcomes(final_state)

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        if current_state.get("status") == "DONE":
            return current_state, {}
        new_state, _, outcomes = self._finish_failure(current_state)
        return new_state, outcomes


def _success_outcomes(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    pledges: dict[str, int] = state["pledges"]
    pledged_total = state["pledged_total"]
    target_chasers = state["target_chasers"]

    outcomes: dict[str, dict[str, Any]] = {}
    for pid in state["clock_offsets"]:
        count = pledges.get(pid, 0)
        if count > 0:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": count,
                "score_delta": count * _SUCCESS_POINTS_PER_PLEDGE,
                "reason": "hero",
                "pledges": count,
                "pledged_total": pledged_total,
                "target_chasers": target_chasers,
            }
        else:
            outcomes[pid] = {
                "result": "SAFE",
                "chasers": 0,
                "score_delta": 0,
                "reason": "bystander",
                "pledges": 0,
                "pledged_total": pledged_total,
                "target_chasers": target_chasers,
            }
    return outcomes


def _failure_outcomes(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    pledges: dict[str, int] = state["pledges"]
    pledged_total = state["pledged_total"]
    target_chasers = state["target_chasers"]

    outcomes: dict[str, dict[str, Any]] = {}
    for pid in state["clock_offsets"]:
        count = pledges.get(pid, 0)
        chasers = count + 1
        outcomes[pid] = {
            "result": "LOSE",
            "chasers": chasers,
            # Only pledgers pay a points penalty — bystanders drink their
            # draft chaser same as everyone else, but a failed round they
            # didn't volunteer for doesn't cost them anything on the board.
            "score_delta": _FAILURE_POINTS_PER_CHASER * chasers if count > 0 else 0,
            "reason": "martyred" if count > 0 else "drafted",
            "pledges": count,
            "pledged_total": pledged_total,
            "target_chasers": target_chasers,
        }
    return outcomes
