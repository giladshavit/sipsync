"""Bot player seeding and per-game action policies for practice-vs-bots rooms.

Pure, Redis-free module — bots are just player records with `is_bot: True`,
and their actions are computed here and executed by room_service.py calling
handle_game_action, the same public entry point real WS messages use. Every
mini-game's get_initial_state/handle_ws_event already treats players
uniformly, so nothing here needs to touch fsm.py/deck.py/base.py/ws.py.

Tier 1 (reflex, dilemma, majority, minority) is fully spec'd. Tier 2 (the
rest) is a simple, field-verified placeholder — intentionally uniform-random,
expected to be tuned per-game later.
"""

import time
import uuid
from random import Random
from typing import Any, Callable

from app.engine.avatar_pool import pick_avatar
from app.games.auction import RECIPIENT_MAX_CHASERS
from app.games.black_box import RECIPIENT_MAX_CHASERS as _BLACK_BOX_RECIPIENT_MAX_CHASERS

_BOT_NAME_POOL = ["Ava", "Kai", "Nova", "Remy", "Sage", "Wren", "Finn", "Rio", "Zola", "Milo"]
_DEFAULT_BOT_COUNT = 7
_BOT_COUNT_OVERRIDES: dict[str, int] = {"majority": 7, "minority": 7, "dilemma": 7, "roulette": 3}

BotAction = tuple[int, str, dict[str, Any]]


def bot_headcount(game_id: str, human_count: int = 1) -> int:
    """Bot count for a practice room. Always nudges the total (humans + bots)
    to an even number — dilemma's pairing needs this so the odd-one-out
    immune slot never has to land specifically on the human; harmless for
    every other game."""
    n = _BOT_COUNT_OVERRIDES.get(game_id, _DEFAULT_BOT_COUNT)
    if (human_count + n) % 2 != 0:
        n += 1
    return n


def build_bot_player_records(count: int, used_avatars: set[str]) -> dict[str, dict[str, Any]]:
    """{bot_id: player_record} — same JSON shape room_service writes to
    room:{code}:players for real players, plus is_bot=True."""
    if count <= 0:
        return {}
    used = set(used_avatars)
    names = (_BOT_NAME_POOL * ((count // len(_BOT_NAME_POOL)) + 1))[:count]
    rng = Random()
    rng.shuffle(names)
    records: dict[str, dict[str, Any]] = {}
    for name in names:
        avatar = pick_avatar(used)
        used.add(avatar)
        records[f"bot:{uuid.uuid4()}"] = {
            "display_name": f"{name} (Bot)",
            "score": 0,
            "total_chasers": 0,
            "clock_offset": 0,
            "vibe": None,
            "avatar": avatar,
            "is_bot": True,
        }
    return records


def _now_ms() -> int:
    return int(time.time() * 1000)


# Practice-mode bots deliberately don't act instantly (see the Tier 1/Tier 2
# docstring above), but the waits before a bot's turn landed felt tedious in
# practice — scale every "thinking time" delay down to 70% of its original
# spread rather than hand-tuning each policy's bounds individually. Policies
# that time a bot's action against a fixed external stimulus instead of pure
# deliberation (reflex's reaction-time window, human_timer's target-guess,
# strong_point's post-activation click) simulate human timing precision, not
# idle waiting, so those are left at their original spread.
_BOT_DELAY_SCALE = 0.7


def _bot_delay(rng: Random, lo_ms: int, hi_ms: int) -> int:
    return rng.randint(int(lo_ms * _BOT_DELAY_SCALE), int(hi_ms * _BOT_DELAY_SCALE))


# Games with a real "your turn might never come" risk — the poison-card roll
# in roulette.py is a fresh 1/(closed slots) draw on every reveal, independent
# of who's revealing, so with a full-size room the human could easily never
# get a turn before a bot hits it. Reordering turn_order so the human always
# goes first (rather than trying to rig which reveals are "safe", which isn't
# possible without touching roulette.py's own poison roll) guarantees they
# always get to play at least once, without changing the game's actual odds
# or touching its file at all.
_HUMAN_FIRST_GAMES = {"roulette"}


def guarantee_human_first_turn(game_id: str, initial_state: dict, human_id: str) -> dict:
    if game_id not in _HUMAN_FIRST_GAMES:
        return initial_state
    turn_order = initial_state.get("turn_order")
    if not turn_order or human_id not in turn_order:
        return initial_state
    reordered = [human_id] + [pid for pid in turn_order if pid != human_id]
    return {**initial_state, "turn_order": reordered, "current_player_id": reordered[0]}


# black_box picks its two duel participants uniformly at random — fine for a
# real room, but in a practice-vs-bots room the human almost certainly wants
# to actually play the mechanic, not gamble on a 2-in-8 chance of being
# picked. Lets the practice-start flow ask up front (Player 1 / Player 2 /
# spectator) and forces that outcome here, same "adjust get_initial_state's
# output after the fact, keyed by game_id" shape as guarantee_human_first_turn
# above — black_box.py itself is never touched.
_PRACTICE_ROLE_GAMES = {"black_box"}


def apply_practice_role_preference(
    game_id: str, initial_state: dict, human_id: str, role_hint: str | None
) -> dict:
    if game_id not in _PRACTICE_ROLE_GAMES or role_hint not in ("player_1", "player_2", "spectator"):
        return initial_state

    a, b = initial_state.get("player_a_id"), initial_state.get("player_b_id")

    if role_hint == "spectator":
        if human_id not in (a, b):
            return initial_state  # already spectating — the common case, most bots outnumber the 2 duel seats
        others = [pid for pid in initial_state.get("clock_offsets", {}) if pid not in (a, b)]
        if not others:
            return initial_state  # nobody else to swap in — leave the human in the duel, nothing better to do
        replacement = Random().choice(others)
        field = "player_a_id" if a == human_id else "player_b_id"
        return {**initial_state, field: replacement}

    target_field = "player_a_id" if role_hint == "player_1" else "player_b_id"
    other_field = "player_b_id" if role_hint == "player_1" else "player_a_id"
    if initial_state.get(target_field) == human_id:
        return initial_state
    if initial_state.get(other_field) == human_id:
        return {**initial_state, "player_a_id": b, "player_b_id": a}  # already in the duel, just the other seat
    # Not in the duel at all — take the requested seat; whoever it belonged
    # to simply becomes a spectator, same as every other non-picked player.
    return {**initial_state, target_field: human_id}


# ── Tier 1: fully spec'd bot policies ───────────────────────────────────────

def _reflex_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    execute_at = state["execute_at"]
    already = set(state.get("taps", {}))
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in already:
            continue
        # Single uniform draw across the whole window — a few bots naturally
        # fall before 0 (an early/"red" false start) without skewing the rest
        # of the spread toward the fast end.
        offset_s = rng.uniform(-0.1, 1.5)
        fire_at_ms = execute_at + int(offset_s * 1000)
        delay_ms = max(0, fire_at_ms - _now_ms())
        # bot clock_offset is always 0, so local_ts == true_ts == fire_at_ms
        actions.append((delay_ms, bot_id, {"action": "tap", "local_ts": fire_at_ms}))
    return actions


def _dilemma_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    partner_of = state.get("partner_of", {})
    choices = state.get("choices", {})
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id not in partner_of or bot_id in choices:
            continue  # immune, or already decided
        choice = "HELP" if rng.random() < 0.5 else "BETRAY"
        delay_ms = _bot_delay(rng, 1_000, 8_000)  # well inside _TURN_MS=30_000
        actions.append((delay_ms, bot_id, {"action": "CHOOSE", "choice": choice}))
    return actions


def _vote_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    """Shared by majority + minority — identical VOTE action shape."""
    votes = state.get("votes", {})
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in votes:
            continue
        delay_ms = _bot_delay(rng, 1_000, 10_000)  # inside _VOTE_MS=15_000
        actions.append((delay_ms, bot_id, {"action": "VOTE", "choice": rng.choice(("A", "B"))}))
    return actions


# ── Tier 2: simple default policies, verified against real field names ─────

def _roulette_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    current = state.get("current_player_id")
    if current not in bot_ids:
        return []
    revealed = state.get("revealed", [])
    closed = [i for i, r in enumerate(revealed) if not r]
    if not closed:
        return []
    can_skip = current not in state.get("skips_used", []) and len(closed) > 1
    payload = (
        {"action": "SKIP"}
        if can_skip and rng.random() < 0.15
        else {"action": "REVEAL", "slot_index": rng.choice(closed)}
    )
    # Slower than other games' bot delays on purpose — roulette's turn-by-turn
    # queue is meant to be watched (who's up, who's on deck), and a near-instant
    # bot pick made that unreadable. Still comfortably inside _TURN_MS=10_000.
    return [(_bot_delay(rng, 2_500, 6_000), current, payload)]


def _tap_race_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    taps = state.get("taps", {})
    end_at = state.get("end_at", 0)
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in taps:
            continue
        delay_ms = max(0, end_at - _now_ms()) + _bot_delay(rng, 100, 800)
        actions.append((delay_ms, bot_id, {"action": "taps_final", "count": rng.randint(45, 75)}))
    return actions


def _closest_average_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    numbers = state.get("numbers", {})
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in numbers:
            continue
        delay_ms = _bot_delay(rng, 1_000, 10_000)  # inside _DECISION_MS=15_000
        actions.append((delay_ms, bot_id, {"action": "SUBMIT_NUMBER", "number": rng.randint(0, 99)}))
    return actions


def _human_timer_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    taps = state.get("taps", {})
    start_at = state.get("start_at", 0)
    target_s = state.get("target_s", 15)
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in taps:
            continue
        # Uniform within ±20% of the target (e.g. target=25s -> 20s..30s).
        elapsed_s = rng.uniform(target_s * 0.8, target_s * 1.2)
        fire_at_ms = start_at + int(elapsed_s * 1000)
        delay_ms = max(0, fire_at_ms - _now_ms())
        actions.append((delay_ms, bot_id, {"action": "tap", "local_ts": fire_at_ms}))
    return actions


def _sacrifice_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    # Each bot has one chance to PLEDGE, spread across _TURN_MS=30_000.
    # Simplified vs. the real game's repeatable-pledge mechanic — placeholder.
    return [
        (_bot_delay(rng, 1_000, 20_000), bot_id, {"action": "PLEDGE"})
        for bot_id in bot_ids
        if rng.random() < 0.35
    ]


def _coin_flip_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    flipper = state.get("flipper_id")
    votes = state.get("votes", {})
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id == flipper or bot_id in votes:
            continue
        delay_ms = _bot_delay(rng, 1_000, 15_000)  # inside _VOTE_MS=20_000
        actions.append((delay_ms, bot_id, {"action": "VOTE", "choice": rng.choice(("heads", "tails"))}))
    return actions


_AUCTION_MAX_CHASERS = 4
_AUCTION_MAX_POINTS = 40


def _auction_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    """Re-planned after every bid/assign (see _RESCHEDULE_ON_ACTION_GAMES
    below), so only ever proposes the *next* single action — never a cascade
    of simultaneous actions.

    During BIDDING: one raise at a time, never jumping more than +1 chaser /
    +10 points past the current highest (matches the quick-bid buttons' own
    increments); the whole war is capped at
    _AUCTION_MAX_CHASERS/_AUCTION_MAX_POINTS, with continuation odds shrinking
    as the bid climbs toward that ceiling so most rounds settle before ever
    reaching it instead of grinding there every time.

    During DISTRIBUTING: only relevant if the winner is itself a bot (a human
    winner always distributes manually) — otherwise the round would just sit
    idle until the 60s hard-stop fallback-fills it. Spreads its ASSIGN taps
    across a few seconds (not instant, not the full 60s) so a bot-won round
    resolves at a reasonable pace, then SUBMITs once the pool is placed.
    """
    if state.get("status") == "DISTRIBUTING":
        return _auction_bot_distribute(state, bot_ids, rng)
    if state.get("status") != "BIDDING":
        return []

    current: dict[str, int] | None = state.get("current_bid")
    current_bidder = state.get("current_bidder_id")
    cur_chasers = current["chasers"] if current else 0
    cur_points = current["points"] if current else 0

    max_delta_chasers = max(0, min(1, _AUCTION_MAX_CHASERS - cur_chasers))
    max_delta_points = max(0, min(10, _AUCTION_MAX_POINTS - cur_points))
    if max_delta_chasers == 0 and max_delta_points == 0:
        return []  # already at the ceiling in both dimensions

    eligible = [b for b in bot_ids if b != current_bidder]
    if not eligible:
        return []

    # Continuation odds fall off as the bid approaches the ceiling — a fresh
    # auction almost always gets a raise, a near-maxed one rarely does.
    progress = ((cur_chasers / _AUCTION_MAX_CHASERS) + (cur_points / _AUCTION_MAX_POINTS)) / 2
    if rng.random() > max(0.12, 1 - progress):
        return []

    delta_chasers = rng.randint(0, max_delta_chasers) if max_delta_chasers else 0
    delta_points = rng.randint(0, max_delta_points) if max_delta_points else 0
    if delta_chasers == 0 and delta_points == 0:
        # A rule 4 bid must beat the last one in at least one dimension —
        # force a token raise in whichever side still has room.
        if max_delta_points:
            delta_points = 1
        else:
            delta_chasers = 1

    new_chasers = max(1, cur_chasers + delta_chasers)  # the floor is always >= 1 chaser
    new_points = cur_points + delta_points

    bidder = rng.choice(eligible)
    delay_ms = _bot_delay(rng, 2_000, 10_000)  # comfortably inside _BID_WINDOW_MS=15_000
    return [(delay_ms, bidder, {"action": "BID", "chasers": new_chasers, "points": new_points})]


def _auction_bot_distribute(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    winner_id = state.get("winner_id")
    if winner_id not in bot_ids:
        return []  # a human winner distributes manually — never touched here

    assignments: dict[str, int] = state.get("assignments", {})
    pool_size = state.get("pool_size", 0)
    if sum(assignments.values()) < pool_size:
        eligible = [pid for pid, c in assignments.items() if c < RECIPIENT_MAX_CHASERS]
        if not eligible:
            return []
        # Prefer whoever has the fewest chasers so far — reads as a real
        # (if self-interested) choice rather than a random pile-on, while
        # still finishing the whole pool in roughly ~5s of wall-clock time.
        min_count = min(assignments[pid] for pid in eligible)
        candidates = [pid for pid in eligible if assignments[pid] == min_count]
        target = rng.choice(candidates)
        delay_ms = _bot_delay(rng, 600, 1_200)
        return [(delay_ms, winner_id, {"action": "ASSIGN", "target_player_id": target})]

    delay_ms = _bot_delay(rng, 300, 700)
    return [(delay_ms, winner_id, {"action": "SUBMIT"})]


def _black_box_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    """Re-planned after every action (see _RESCHEDULE_ON_ACTION_GAMES below) —
    each of the three phases only ever needs the CURRENT phase's actor to
    move, and DISTRIBUTING in particular needs a fresh ASSIGN proposed after
    every tap, same as auction's distribute phase.

    BOX_SELECTION: bot Holder (player_a) picks uniformly among the 6 sealed
    boxes — there's nothing to prefer, they all look identical even to A
    before picking.

    BLUFFING: bot Guesser (player_b) flips a coin, deliberately WITHOUT
    reading `boxes[chosen_box_index]`'s true type. The state handed to every
    bot policy is the full authoritative state (it has to be, to compute
    legal moves), so the true content is technically sitting right there —
    but a bot that used it would dodge every Drink box and grab every
    Distribute one, reading as omniscient rather than a player actually
    being bluffed. A human Guesser has no such option, so neither does this
    one.

    DISTRIBUTING: only relevant if the Target Player is itself a bot (a
    human target distributes manually) — same shape as
    _auction_bot_distribute, just against this game's own
    RECIPIENT_MAX_CHASERS (3, not auction's 2).
    """
    status = state.get("status")

    if status == "BOX_SELECTION":
        holder_id = state.get("player_a_id")
        if holder_id not in bot_ids:
            return []
        delay_ms = _bot_delay(rng, 2_000, 9_000)  # inside _SELECT_MS=15_000
        return [(delay_ms, holder_id, {"action": "SELECT_BOX", "box_index": rng.randrange(6)})]

    if status == "BLUFFING":
        guesser_id = state.get("player_b_id")
        if guesser_id not in bot_ids:
            return []
        decision = "TAKE_BOX" if rng.random() < 0.5 else "LEAVE_BOX"
        # Past the client's synced grid→duel intro (~6.7s, including the
        # Holder's private peek that every screen now waits out) so bot-vs-
        # bot spectators actually see the duel UI before a decision lands.
        # Raw range is pre-_BOT_DELAY_SCALE (0.7) — lands ~7.7–11.9s real.
        # Still well inside _BLUFF_MS=30_000.
        delay_ms = _bot_delay(rng, 11_000, 17_000)
        return [(delay_ms, guesser_id, {"action": decision})]

    if status == "DISTRIBUTING":
        target_id = state.get("target_player_id")
        if target_id not in bot_ids:
            return []
        box_index = state.get("chosen_box_index")
        boxes = state.get("boxes", [])
        pool_size = boxes[box_index]["chasers"] if isinstance(box_index, int) and box_index < len(boxes) else 0
        assignments: dict[str, int] = state.get("assignments", {})
        placed = sum(assignments.values())
        if placed < pool_size:
            eligible = [pid for pid, c in assignments.items() if c < _BLACK_BOX_RECIPIENT_MAX_CHASERS]
            if not eligible:
                return []
            min_count = min(assignments[pid] for pid in eligible)
            candidates = [pid for pid in eligible if assignments[pid] == min_count]
            recipient = rng.choice(candidates)
            # First tap waits out the client's zoom-and-flip reveal (~9s
            # once DISTRIBUTING starts, full cinematic) so spectators mount
            # the distribute screen onto an EMPTY board and then watch the
            # bot place live — same feel as a human distributor thinking,
            # then pouring. Raw range is pre-_BOT_DELAY_SCALE (0.7) — lands
            # ~10–12s real. Later taps stay snappy so the pour itself reads
            # as a sequence.
            delay_ms = (
                _bot_delay(rng, 14_500, 17_000)
                if placed == 0
                else _bot_delay(rng, 600, 1_200)
            )
            return [(delay_ms, target_id, {"action": "ASSIGN", "recipient_player_id": recipient})]
        # Brief beat after the last place — the bot's stand-in for hovering
        # over CONFIRM — then submit. Pre-scale → ~840–1400ms real.
        delay_ms = _bot_delay(rng, 1_200, 2_000)
        return [(delay_ms, target_id, {"action": "SUBMIT"})]

    return []


def _flying_bomb_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    """Re-planned after every THROW_BOMB (see _RESCHEDULE_ON_ACTION_GAMES
    below) since a bot's "turn" to throw opens up dynamically whenever a
    bomb lands on it, not just once at round start — unlike reflex/tap_race,
    a hot-potato bomb can arrive at any point in the window.

    flying_bomb has no per-turn cursor for _round_fingerprint to key off (its
    `timeout_at` is fixed for the whole round), so a bot still holding a bomb
    at the next reschedule gets a fresh scheduled throw proposed again before
    its earlier one has necessarily fired — the older, stale task is
    harmless when it eventually runs since flying_bomb.py's own holder check
    silently no-ops a throw for a bomb the bot no longer has. Keeping the
    delay window short (well under typical time-between-throws) keeps any
    such duplicates from piling up meaningfully.
    """
    bombs: dict[str, dict] = state.get("bombs", {})
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        for bomb_id, bomb in bombs.items():
            if bomb.get("holder_id") != bot_id:
                continue
            exit_side = rng.choice(("left", "right"))
            # Normalized screen-widths/heights per second (see
            # flying_bomb._MAX_PLAUSIBLE_VELOCITY) — not raw px/s. A bot has
            # no real screen, so it "swipes" directly in these device-
            # independent units: ~2-4 screen-widths/s reads as a firm,
            # deliberate throw on any device.
            velocity_x = rng.uniform(2.0, 4.0) * (1 if exit_side == "right" else -1)
            velocity_y = rng.uniform(-1.5, 1.5)
            y_position = rng.uniform(0.2, 0.8)
            delay_ms = _bot_delay(rng, 500, 2_500)
            actions.append((delay_ms, bot_id, {
                "action": "THROW_BOMB",
                "bomb_id": bomb_id,
                "exit_side": exit_side,
                "velocity_x": velocity_x,
                "velocity_y": velocity_y,
                "y_position": y_position,
            }))
    return actions


def _twenty_one_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    """Only ever proposes the current turn's action — re-planned after every
    INCREMENT since a bot's turn opens dynamically as the cursor rotates to
    it (see _RESCHEDULE_ON_ACTION_GAMES below), same as roulette.

    Picks uniformly among the amounts that don't bust past 21 — no attempt
    at real push-your-luck strategy, just a legal, unhurried move.
    """
    current = state.get("current_player_id")
    if current not in bot_ids:
        return []
    count = state.get("count", 0)
    legal = [a for a in (1, 2, 3) if count + a <= 21]
    if not legal:
        return []
    # Comfortably inside _TURN_MS=12_000, slow enough that the turn-by-turn
    # queue reads as a real decision instead of an instant bot reflex.
    return [(_bot_delay(rng, 1_500, 4_000), current, {"action": "INCREMENT", "amount": rng.choice(legal)})]


def _strong_point_policy(state: dict, bot_ids: list[str], rng: Random) -> list[BotAction]:
    activate_at = state["activate_at"]
    already = set(state.get("taps", {}))
    actions: list[BotAction] = []
    for bot_id in bot_ids:
        if bot_id in already:
            continue
        # Spread bots across the first few seconds after activation — the
        # hit-zone is already live at full size the instant it appears, so a
        # bot "reacting" this fast is legitimate, not a cheat.
        offset_s = rng.uniform(0.1, 4.0)
        fire_at_ms = activate_at + int(offset_s * 1000)
        delay_ms = max(0, fire_at_ms - _now_ms())
        # bot clock_offset is always 0, so local_ts == true_ts == fire_at_ms
        actions.append((delay_ms, bot_id, {"action": "CLICK", "local_ts": fire_at_ms}))
    return actions


# Games where a bot's turn only opens up once a previous action lands (i.e.
# their policy reads a live `current_player_id`/turn cursor from state) need
# to be re-planned after every action. Games where every player acts
# independently within one shared window (reflex, votes, submissions, ...)
# are fully planned once at round start — re-planning them after another
# player's action would recompute fresh random delays relative to a "now"
# that's already drifted from the round's start, collapsing everyone still
# pending into a near-instant cascade instead of their originally intended
# spread.
_RESCHEDULE_ON_ACTION_GAMES = {"roulette", "auction", "flying_bomb", "twenty_one", "black_box"}


def needs_reschedule_on_action(game_id: str) -> bool:
    return game_id in _RESCHEDULE_ON_ACTION_GAMES


_POLICIES: dict[str, Callable[[dict, list[str], Random], list[BotAction]]] = {
    "auction": _auction_policy,
    "reflex": _reflex_policy,
    "dilemma": _dilemma_policy,
    "majority": _vote_policy,
    "minority": _vote_policy,
    "roulette": _roulette_policy,
    "tap_race": _tap_race_policy,
    "closest_average": _closest_average_policy,
    "human_timer": _human_timer_policy,
    "sacrifice": _sacrifice_policy,
    "coin_flip": _coin_flip_policy,
    "strong_point": _strong_point_policy,
    "flying_bomb": _flying_bomb_policy,
    "twenty_one": _twenty_one_policy,
    "black_box": _black_box_policy,
}


def plan_bot_actions(
    game_id: str, state: dict[str, Any], bot_ids: list[str], rng: Random
) -> list[BotAction]:
    if not bot_ids:
        return []
    policy = _POLICIES.get(game_id)
    return policy(state, bot_ids, rng) if policy else []
