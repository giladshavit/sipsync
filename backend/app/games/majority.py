import random
import time
from typing import Any

from app.engine.base import BaseMiniGame
from app.games.data.majority_questions import MAJORITY_QUESTIONS

_VOTE_MS = 15_000
# EXPIRE is a watchdog nudge from clients; this only catches a fully stalled
# room where nobody's client ever sends it
_HARD_STOP_GRACE_MS = 5_000

_CHOICES = ("A", "B")

_WINNER_POINTS = 5
_LOSER_POINTS = -5
_LOSER_CHASERS = 1

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class MajorityGame(BaseMiniGame):
    """
    Go with the Flow: everyone answers the same binary prompt. The room mode
    — FLOW (majority wins) or AGAINST (minority wins) — is shown to every
    player right alongside the question, before anyone votes: there's no
    hidden strategy here, just a house rule the room is playing under.

    `mode` is a class attribute rather than a per-round random pick: FLOW and
    AGAINST are two separate catalog entries (see MinorityGame below), each
    always playing under its own fixed rule, not one game that rolls between
    them. A subclass only ever needs to override `mode` (plus `game_id` /
    `tutorial_asset`) — every other line of this file is shared.

    Scoring is flat and mode-agnostic: the winning group (majority under
    FLOW, minority under AGAINST) always scores +5 with no chasers; the
    losing group always scores -5 and takes one chaser.

    Tie (equal A/B votes): a coin flip picks one of the two answers — everyone
    who chose it takes a chaser, same as a normal minority result; the other
    side is safe. Score is never touched by a tie.

    EXPIRE follows the sacrifice/roulette/dilemma pattern: clients watch the
    broadcast `turn_deadline_at` and nudge the server, which verifies against
    its own clock before randomly assigning every non-voter a side. The
    engine's `timeout_at` task remains as a hard stop for a stalled room.

    No-repeat questions: `get_initial_state` is a pure, synchronous function
    with no Redis access of its own (see base.py's contract), so it can't
    track what this room has already asked across rounds by itself. Instead
    room_service.handle_tutorial_done injects the room's already-asked set
    onto every player dict (same pattern as the old `admin_id` field) and
    reads back a `reset_question_cycle` signal to know when to clear its
    Redis-side pool — see that method's docstring-length comment for the
    full mechanics. This class only needs to filter the pool and set that
    one flag; it never touches Redis directly.
    """

    game_id = "majority"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.majority"
    mode = "FLOW"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        turn_deadline_at = now_ms + _VOTE_MS

        asked: set[str] = players[0].get("asked_questions", set()) if players else set()
        available = [q for q in MAJORITY_QUESTIONS if q["question"] not in asked]
        reset_cycle = not available
        prompt = _rng.choice(available or MAJORITY_QUESTIONS)

        return {
            "status": "PLAYING",
            "mode": self.mode,
            "current_question": prompt["question"],
            "option_a": prompt["option_a"],
            "option_b": prompt["option_b"],
            # Read (and stripped) by room_service — never persisted/broadcast
            "reset_question_cycle": reset_cycle,
            "votes": {},
            "turn_ms": _VOTE_MS,
            "turn_deadline_at": turn_deadline_at,
            "tally": None,
            "tie": False,
            "coin_result": None,
            "majority_choice": None,
            "minority_choice": None,
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
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
        if action == "VOTE":
            return self._handle_vote(player_id, payload, current_state)
        if action == "EXPIRE":
            return self._handle_expire(current_state)
        return current_state, False, {}

    def _handle_vote(
        self,
        player_id: str,
        payload: dict[str, Any],
        current_state: dict[str, Any],
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        if player_id not in current_state["clock_offsets"]:
            return current_state, False, {}
        if player_id in current_state["votes"]:  # locked in already
            return current_state, False, {}

        choice = payload.get("choice")
        if choice not in _CHOICES:
            return current_state, False, {}

        votes = {**current_state["votes"], player_id: choice}
        new_state = {**current_state, "votes": votes}

        if set(votes) >= set(current_state["clock_offsets"]):
            return self._finish(new_state)
        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the vote deadline passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["turn_deadline_at"]):
            return current_state, False, {}
        return self._finish(current_state)

    def on_timeout(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        if current_state.get("status") == "DONE":
            return current_state, {}
        new_state, _, outcomes = self._finish(current_state)
        return new_state, outcomes

    def _finish(
        self, state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        cast_votes: dict[str, str] = dict(state["votes"])
        votes = dict(cast_votes)
        for pid in state["clock_offsets"]:
            votes.setdefault(pid, _rng.choice(_CHOICES))

        count_a = sum(1 for choice in votes.values() if choice == "A")
        count_b = len(votes) - count_a
        mode: str = state["mode"]

        outcomes: dict[str, dict[str, Any]] = {}

        if count_a == count_b:
            # Coin picks the answer that drinks — same shape as a normal
            # round (some players drink, some don't), just with the losing
            # side assigned by a coin instead of a head-count.
            coin_result: str = _rng.choice(_CHOICES)
            for pid, choice in votes.items():
                lost = choice == coin_result
                outcomes[pid] = {
                    "result": "LOSE" if lost else "SAFE",
                    "chasers": _LOSER_CHASERS if lost else 0,
                    "score_delta": 0,
                    "reason": "tie_coin",
                    "choice": choice,
                    "mode": mode,
                    "tie": True,
                    "coin_result": coin_result,
                    "auto_voted": pid not in cast_votes,
                }
            new_state = {
                **state,
                "status": "DONE",
                "votes": votes,
                "tie": True,
                "coin_result": coin_result,
                "majority_choice": None,
                "minority_choice": None,
                "tally": {"A": count_a, "B": count_b},
            }
            return new_state, True, outcomes

        majority_choice = "A" if count_a > count_b else "B"
        minority_choice = "B" if majority_choice == "A" else "A"
        winner_choice = majority_choice if mode == "FLOW" else minority_choice

        for pid, choice in votes.items():
            won = choice == winner_choice
            outcomes[pid] = {
                "result": "WIN" if won else "LOSE",
                "chasers": 0 if won else _LOSER_CHASERS,
                "score_delta": _WINNER_POINTS if won else _LOSER_POINTS,
                "reason": "majority" if choice == majority_choice else "minority",
                "choice": choice,
                "mode": mode,
                "tie": False,
                "coin_result": None,
                "auto_voted": pid not in cast_votes,
            }

        new_state = {
            **state,
            "status": "DONE",
            "votes": votes,
            "tie": False,
            "coin_result": None,
            "majority_choice": majority_choice,
            "minority_choice": minority_choice,
            "tally": {"A": count_a, "B": count_b},
        }
        return new_state, True, outcomes


class MinorityGame(MajorityGame):
    """
    Against the Flow: the mirror of Go with the Flow — same prompts, same
    vote mechanics, same flat +-5/one-chaser scoring, same tie-break coin
    flip. The only difference is `mode`, which flips who counts as the
    winning group. See MajorityGame's docstring for everything else.
    """

    game_id = "minority"
    tutorial_asset = "tutorial.minority"
    mode = "AGAINST"
