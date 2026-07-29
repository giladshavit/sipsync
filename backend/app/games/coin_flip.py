import random
import time
from typing import Any

from app.engine.base import BaseMiniGame

_FACES = ("heads", "tails")

# Coin flip animation plays on the flipper's screen before the vote window
_FLIP_REVEAL_MS = 3_000
_VOTE_MS = 20_000
# Hard-stop slack past the vote deadline — the EXPIRE watchdog should always
# fire first; this only catches a fully stalled room
_HARD_STOP_GRACE_MS = 8_000

_CORRECT_POINTS = 3
_WRONG_POINTS = -3
_WRONG_CHASERS = 1
_FLIPPER_CALLED_OUT_CHASERS = 2

# Module-level RNG so tests can substitute a deterministic one
_rng = random.Random()


class CoinFlipGame(BaseMiniGame):
    """
    Liar's Coin: one random player (the flipper) flips a coin and is the only
    one who sees the result. They announce it out loud — truth or bluff. The
    rest vote heads/tails within 20 s; not voting counts as a wrong guess.

    Scoring:
    - Correct guessers: +3. Wrong (or silent) guessers: -3 and a chaser.
    - Flipper: +1 per wrong guesser, -1 per correct one. If a strict majority
      of guessers got it right, the room read the flipper — 2 chasers for
      them (an exact 50/50 split is safe).

    The round ends when everyone voted or the deadline passes, whichever
    comes first. Deadline enforcement follows the human_timer/roulette
    "expire" pattern: clients watch the broadcast `vote_deadline_at` and send
    an EXPIRE action, which the server validates against its own clock. The
    engine's `timeout_at` task remains as a hard stop for a stalled room.

    Trust note: game state is broadcast verbatim, so the coin result rides in
    it — the flipper's client must render it. Guessers' clients simply don't
    show it, which matches the party-room trust model (same as every score
    living in plain sight).
    """

    game_id = "coin_flip"
    tutorial_type = "timed_text"
    tutorial_asset = "tutorial.coin_flip"

    def get_initial_state(self, players: list[dict[str, Any]]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        flipper_id = _rng.choice([p["player_id"] for p in players])
        vote_deadline_at = now_ms + _FLIP_REVEAL_MS + _VOTE_MS
        return {
            "status": "PLAYING",
            "flipper_id": flipper_id,
            "result": _rng.choice(_FACES),
            # pid → "heads" | "tails" (flipper never votes)
            "votes": {},
            "flip_reveal_ms": _FLIP_REVEAL_MS,
            "vote_ms": _VOTE_MS,
            "vote_deadline_at": vote_deadline_at,
            # {correct, wrong} guesser counts, set when the round resolves
            "tally": None,
            "display_names": {
                p["player_id"]: p.get("display_name", "?") for p in players
            },
            "avatars": {p["player_id"]: p.get("avatar") for p in players},
            # "taps" stays empty so the engine's everyone-reported guard in the
            # shared timeout path never short-circuits before on_timeout
            "taps": {},
            "clock_offsets": {p["player_id"]: p.get("clock_offset", 0) for p in players},
            "timeout_at": vote_deadline_at + _HARD_STOP_GRACE_MS,
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
        if player_id == current_state["flipper_id"]:
            return current_state, False, {}
        if player_id not in current_state["clock_offsets"]:
            return current_state, False, {}
        if player_id in current_state["votes"]:
            return current_state, False, {}

        choice = payload.get("choice")
        if choice not in _FACES:
            return current_state, False, {}

        votes = {**current_state["votes"], player_id: choice}
        new_state = {**current_state, "votes": votes}

        if set(votes.keys()) >= _guesser_ids(current_state):
            return self._finish(new_state)
        return new_state, False, {}

    def _handle_expire(
        self, current_state: dict[str, Any]
    ) -> tuple[dict[str, Any], bool, dict[str, dict[str, Any]]]:
        """Client claims the vote deadline passed — verify on our clock."""
        if int(time.time() * 1000) < int(current_state["vote_deadline_at"]):
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
        result: str = state["result"]
        flipper_id: str = state["flipper_id"]
        votes: dict[str, str] = state["votes"]
        guessers = _guesser_ids(state)

        correct = [pid for pid in guessers if votes.get(pid) == result]
        # Silence counts as a wrong guess — it pays the flipper the same
        wrong = [pid for pid in guessers if pid not in correct]

        outcomes: dict[str, dict[str, Any]] = {}
        for pid in correct:
            outcomes[pid] = {
                "result": "WIN",
                "chasers": 0,
                "score_delta": _CORRECT_POINTS,
                "reason": "correct",
                "coin_result": result,
            }
        for pid in wrong:
            outcomes[pid] = {
                "result": "LOSE",
                "chasers": _WRONG_CHASERS,
                "score_delta": _WRONG_POINTS,
                "reason": "wrong" if pid in votes else "no_vote",
                "coin_result": result,
            }

        flipper_score = len(wrong) - len(correct)
        called_out = 2 * len(correct) > len(guessers)  # strict majority only
        if called_out:
            flipper_result, flipper_reason = "LOSE", "called_out"
        elif flipper_score > 0:
            flipper_result, flipper_reason = "WIN", "fooled_them"
        else:
            flipper_result, flipper_reason = "SAFE", "split_room"
        outcomes[flipper_id] = {
            "result": flipper_result,
            "chasers": _FLIPPER_CALLED_OUT_CHASERS if called_out else 0,
            "score_delta": flipper_score,
            "reason": flipper_reason,
            "coin_result": result,
        }

        new_state = {
            **state,
            "status": "DONE",
            "tally": {"correct": len(correct), "wrong": len(wrong)},
        }
        return new_state, True, outcomes


def _guesser_ids(state: dict[str, Any]) -> set[str]:
    return set(state["clock_offsets"]) - {state["flipper_id"]}
