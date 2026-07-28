import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_TURN_MS = 30_000
# EXPIRE is a watchdog nudge from clients; this only catches a fully stalled
# room where nobody's client ever sends it
_HARD_STOP_GRACE_MS = 5_000

_HELP_HELP_POINTS = 5
_BETRAY_WIN_POINTS = 10
_BETRAY_LOSE_POINTS = -10
_BETRAY_LOSE_CHASERS = 2
_MUTUAL_BETRAY_POINTS = -5
_MUTUAL_BETRAY_CHASERS = 1

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class DilemmaGame(BaseMiniGame):
    """
    Prisoner's Dilemma: players are shuffled into pairs (an odd one out sits
    the round with immunity) and each half of a pair privately locks in HELP
    or BETRAY. Once both halves of every pair have chosen, all pairs resolve
    at once against a fixed payoff matrix — mutual help is the modest, safe
    outcome; a lone betrayal is the best individual result at the partner's
    expense; mutual betrayal burns both for less than either could have won.

    Server-as-Judge note: like roulette/coin_flip, choices are broadcast
    verbatim in game state once the round resolves — nothing about a pick is
    ever hidden client-side while `status` is still PLAYING, since the
    payload simply doesn't include the other half of a pair's choice until
    both are in.

    Turn timeout follows the sacrifice/roulette "expire" pattern: clients
    watch the broadcast `turn_deadline_at` and send an EXPIRE action, which
    the server validates against its own clock before defaulting every
    undecided paired player to BETRAY. The engine's single `timeout_at` task
    remains as a hard stop for a fully stalled room.
    """

    game_id = "dilemma"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.dilemma"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        turn_deadline_at = now_ms + _TURN_MS

        ids = [p["player_id"] for p in players]
        _rng.shuffle(ids)

        pairs: list[list[str]] = []
        for i in range(0, len(ids) - 1, 2):
            pairs.append([ids[i], ids[i + 1]])
        immune_player = ids[-1] if len(ids) % 2 == 1 else None

        partner_of: dict[str, str] = {}
        for a, b in pairs:
            partner_of[a] = b
            partner_of[b] = a

        return {
            "status": "PLAYING",
            "pairs": pairs,
            "partner_of": partner_of,
            "immune_player": immune_player,
            "choices": {},
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
        if action == "CHOOSE":
            return self._handle_choose(player_id, payload, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_choose(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        partner_of: dict[str, str] = current_state["partner_of"]
        if player_id not in partner_of:  # unpaired (immune or unknown) — no move to make
            return current_state, False, {}
        if player_id in current_state["choices"]:  # locked in already
            return current_state, False, {}

        choice = payload.get("choice")
        if choice not in ("HELP", "BETRAY"):
            return current_state, False, {}

        choices = {**current_state["choices"], player_id: choice}
        new_state = {
            **current_state,
            "choices": choices,
            "last_event": {"type": "CHOOSE", "player_id": player_id},
        }

        if set(choices) >= set(partner_of):
            return self._finish(new_state)

        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the global deadline passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["turn_deadline_at"]):
            return current_state, False, {}
        return self._finish(current_state)

    def _finish(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        choices = dict(current_state["choices"])
        for pid in current_state["partner_of"]:
            choices.setdefault(pid, "BETRAY")

        final_state = {**current_state, "choices": choices, "status": "DONE"}
        return final_state, True, _final_outcomes(final_state)

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        if current_state.get("status") == "DONE":
            return current_state, {}
        new_state, _, outcomes = self._finish(current_state)
        return new_state, outcomes


def _pair_outcome(
    result: str,
    chasers: int,
    score_delta: int,
    reason: str,
    choice: str | None,
    opponent_choice: str | None,
    opponent_id: str | None,
) -> dict[str, Any]:
    return {
        "result": result,
        "chasers": chasers,
        "score_delta": score_delta,
        "reason": reason,
        "choice": choice,
        "opponent_id": opponent_id,
        "opponent_choice": opponent_choice,
    }


def _final_outcomes(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    choices: dict[str, str] = state["choices"]
    partner_of: dict[str, str] = state["partner_of"]
    immune_player = state.get("immune_player")

    outcomes: dict[str, dict[str, Any]] = {}
    resolved: set[str] = set()
    for pid, partner in partner_of.items():
        if pid in resolved:
            continue
        resolved.add(pid)
        resolved.add(partner)

        mine, theirs = choices[pid], choices[partner]

        if mine == "HELP" and theirs == "HELP":
            outcomes[pid] = _pair_outcome("WIN", 0, _HELP_HELP_POINTS, "mutual_help", mine, theirs, partner)
            outcomes[partner] = _pair_outcome("WIN", 0, _HELP_HELP_POINTS, "mutual_help", theirs, mine, pid)
        elif mine == "BETRAY" and theirs == "BETRAY":
            outcomes[pid] = _pair_outcome(
                "LOSE", _MUTUAL_BETRAY_CHASERS, _MUTUAL_BETRAY_POINTS, "mutual_betray", mine, theirs, partner
            )
            outcomes[partner] = _pair_outcome(
                "LOSE", _MUTUAL_BETRAY_CHASERS, _MUTUAL_BETRAY_POINTS, "mutual_betray", theirs, mine, pid
            )
        elif mine == "BETRAY":  # mine BETRAY, theirs HELP
            outcomes[pid] = _pair_outcome("WIN", 0, _BETRAY_WIN_POINTS, "betrayed_them", mine, theirs, partner)
            outcomes[partner] = _pair_outcome(
                "LOSE", _BETRAY_LOSE_CHASERS, _BETRAY_LOSE_POINTS, "got_betrayed", theirs, mine, pid
            )
        else:  # mine HELP, theirs BETRAY
            outcomes[pid] = _pair_outcome(
                "LOSE", _BETRAY_LOSE_CHASERS, _BETRAY_LOSE_POINTS, "got_betrayed", mine, theirs, partner
            )
            outcomes[partner] = _pair_outcome("WIN", 0, _BETRAY_WIN_POINTS, "betrayed_them", theirs, mine, pid)

    if immune_player is not None:
        outcomes[immune_player] = _pair_outcome("SAFE", 0, 0, "immune", None, None, None)

    return outcomes
