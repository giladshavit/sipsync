"""Tests for backend/app/engine/bot_engine.py — bot headcount/parity math,
bot player-record seeding, and the tier-1 (reflex/dilemma/vote) policies."""
import random

from app.engine import bot_engine


def test_headcount_defaults_to_seven():
    assert bot_engine.bot_headcount("tap_race") == 7


def test_roulette_uses_a_smaller_headcount():
    # 3 bots + 1 human = 4 players total, per product feedback: a full 8-way
    # room made it too likely the human's turn never comes before the poison
    # card is hit by someone earlier in the (random) turn order.
    assert bot_engine.bot_headcount("roulette", human_count=1) == 3


def test_majority_minority_dilemma_force_even_total():
    for game_id in ("majority", "minority", "dilemma"):
        n = bot_engine.bot_headcount(game_id, human_count=1)
        assert n == 7
        assert (1 + n) % 2 == 0


def test_headcount_nudges_odd_total_to_even():
    # Default-count scenario: 2 humans + 7 bots = 9 (odd) -> bump to 8.
    n = bot_engine.bot_headcount("tap_race", human_count=2)
    assert (2 + n) % 2 == 0


def test_build_bot_player_records_shape_and_uniqueness():
    records = bot_engine.build_bot_player_records(7, used_avatars=set())

    assert len(records) == 7
    avatars = [r["avatar"] for r in records.values()]
    assert len(set(avatars)) == 7  # all unique, pool has 42 entries
    for bot_id, rec in records.items():
        assert bot_id.startswith("bot:")
        assert rec["is_bot"] is True
        assert rec["score"] == 0
        assert rec["clock_offset"] == 0
        assert "(Bot)" in rec["display_name"]


def test_build_bot_player_records_zero_count():
    assert bot_engine.build_bot_player_records(0, used_avatars=set()) == {}


def test_reflex_policy_is_uniform_over_the_full_window():
    # Single uniform draw over [-0.1s, 1.5s] — early ("red") taps are just
    # whatever falls below zero, not a separately-weighted branch, so the
    # early rate should land near 0.1/1.6 ≈ 6.25%, not the old fixed ~10%.
    rng = random.Random(42)
    state = {"execute_at": 1_000_000, "taps": {}}
    bot_ids = [f"bot:{i}" for i in range(2000)]

    actions = bot_engine.plan_bot_actions("reflex", state, bot_ids, rng)

    assert len(actions) == 2000
    offsets_ms = [payload["local_ts"] - state["execute_at"] for _, _, payload in actions]

    early_count = sum(1 for o in offsets_ms if o < 0)
    rate = early_count / len(offsets_ms)
    assert 0.03 < rate < 0.10

    assert min(offsets_ms) >= -100
    assert max(offsets_ms) <= 1500
    # Should actually use the widened range, not cluster near zero.
    assert max(offsets_ms) > 1000


def test_reflex_policy_skips_bots_that_already_tapped():
    rng = random.Random(1)
    state = {"execute_at": 1_000_000, "taps": {"bot:1": {}}}

    actions = bot_engine.plan_bot_actions("reflex", state, ["bot:1", "bot:2"], rng)

    acted_ids = {bot_id for _, bot_id, _ in actions}
    assert acted_ids == {"bot:2"}


def test_dilemma_policy_skips_immune_and_already_decided_bots():
    rng = random.Random(2)
    state = {
        "partner_of": {"bot:1": "bot:2", "bot:2": "bot:1"},
        "choices": {"bot:1": "HELP"},
    }
    # bot:3 is not in partner_of (the immune slot) — must never be scheduled.
    actions = bot_engine.plan_bot_actions("dilemma", state, ["bot:1", "bot:2", "bot:3"], rng)

    acted_ids = {bot_id for _, bot_id, _ in actions}
    assert acted_ids == {"bot:2"}
    for _, _, payload in actions:
        assert payload["choice"] in ("HELP", "BETRAY")


def test_vote_policy_shared_by_majority_and_minority():
    rng = random.Random(3)
    state = {"votes": {"bot:1": "A"}}

    for game_id in ("majority", "minority"):
        actions = bot_engine.plan_bot_actions(game_id, state, ["bot:1", "bot:2"], rng)
        acted_ids = {bot_id for _, bot_id, _ in actions}
        assert acted_ids == {"bot:2"}
        for _, _, payload in actions:
            assert payload["choice"] in ("A", "B")


def test_guarantee_human_first_turn_reorders_roulette():
    initial_state = {
        "turn_order": ["bot:1", "bot:2", "human:1", "bot:3"],
        "current_player_id": "bot:1",
    }
    new_state = bot_engine.guarantee_human_first_turn("roulette", initial_state, "human:1")

    assert new_state["turn_order"][0] == "human:1"
    assert new_state["current_player_id"] == "human:1"
    # Everyone else's relative order is preserved, just with the human pulled
    # to the front — not a full re-shuffle.
    assert new_state["turn_order"][1:] == ["bot:1", "bot:2", "bot:3"]


def test_guarantee_human_first_turn_is_a_noop_for_other_games():
    initial_state = {"votes": {}}
    assert bot_engine.guarantee_human_first_turn("majority", initial_state, "human:1") is initial_state


def test_guarantee_human_first_turn_is_a_noop_if_human_missing():
    initial_state = {"turn_order": ["bot:1", "bot:2"], "current_player_id": "bot:1"}
    assert bot_engine.guarantee_human_first_turn("roulette", initial_state, "human:1") is initial_state


def test_tap_race_policy_count_range():
    rng = random.Random(6)
    state = {"taps": {}, "end_at": 0}

    actions = bot_engine.plan_bot_actions("tap_race", state, [f"bot:{i}" for i in range(200)], rng)

    counts = [payload["count"] for _, _, payload in actions]
    assert len(counts) == 200
    assert all(45 <= c <= 75 for c in counts)
    assert min(counts) < 55  # actually spans the widened range, not clustered


def test_human_timer_policy_is_within_twenty_percent_of_target():
    rng = random.Random(7)
    target_s = 25
    state = {"taps": {}, "start_at": 1_000_000, "target_s": target_s}

    actions = bot_engine.plan_bot_actions(
        "human_timer", state, [f"bot:{i}" for i in range(500)], rng
    )

    elapsed_s = [(payload["local_ts"] - state["start_at"]) / 1000 for _, _, payload in actions]
    assert len(elapsed_s) == 500
    assert all(20 <= e <= 30 for e in elapsed_s)
    assert min(elapsed_s) < 22  # spans down near the -20% edge
    assert max(elapsed_s) > 28  # spans up near the +20% edge


def test_unknown_game_id_returns_no_actions():
    rng = random.Random(4)
    assert bot_engine.plan_bot_actions("not_a_game", {}, ["bot:1"], rng) == []


def test_no_bot_ids_returns_no_actions():
    rng = random.Random(5)
    assert bot_engine.plan_bot_actions("reflex", {"execute_at": 0, "taps": {}}, [], rng) == []


def test_only_turn_based_games_need_reschedule_on_action():
    # Regression guard: re-planning a simultaneous-action game (reflex, vote,
    # submission, ...) after every other player's action recomputes fresh
    # random delays relative to a "now" that's already drifted from round
    # start, collapsing everyone still pending into a near-instant cascade.
    # Only turn-based/leader-changes games (roulette's turn queue, auction's
    # current-highest-bidder) should re-trigger.
    assert bot_engine.needs_reschedule_on_action("roulette") is True
    assert bot_engine.needs_reschedule_on_action("auction") is True
    for game_id in (
        "reflex", "dilemma", "majority", "minority",
        "tap_race", "closest_average", "human_timer", "sacrifice", "coin_flip",
    ):
        assert bot_engine.needs_reschedule_on_action(game_id) is False


def test_auction_policy_skips_unknown_status():
    rng = random.Random(8)
    state = {"status": "DONE", "current_bid": None, "current_bidder_id": None}
    assert bot_engine.plan_bot_actions("auction", state, ["bot:1", "bot:2"], rng) == []


def test_auction_distribute_skips_when_winner_is_human():
    rng = random.Random(20)
    state = {
        "status": "DISTRIBUTING",
        "winner_id": "human:1",
        "pool_size": 3,
        "assignments": {"bot:1": 0, "bot:2": 0},
    }
    assert bot_engine.plan_bot_actions("auction", state, ["bot:1", "bot:2"], rng) == []


def test_auction_distribute_assigns_to_least_assigned_recipient():
    rng = random.Random(21)
    state = {
        "status": "DISTRIBUTING",
        "winner_id": "bot:1",
        "pool_size": 3,
        "assignments": {"human:1": 1, "bot:2": 0, "bot:3": 0},
    }
    actions = bot_engine.plan_bot_actions("auction", state, ["bot:1", "bot:2", "bot:3"], rng)
    assert len(actions) == 1
    delay_ms, actor, payload = actions[0]
    assert actor == "bot:1"  # the winner does the distributing, not any bot
    assert payload["action"] == "ASSIGN"
    assert payload["target_player_id"] in ("bot:2", "bot:3")  # never the already-1 recipient
    assert 0 <= delay_ms <= 1_200


def test_auction_distribute_never_assigns_past_the_cap():
    rng = random.Random(22)
    state = {
        "status": "DISTRIBUTING",
        "winner_id": "bot:1",
        "pool_size": 5,
        "assignments": {"human:1": 2, "bot:2": 2, "bot:3": 0},
    }
    for seed in range(50):
        actions = bot_engine.plan_bot_actions(
            "auction", state, ["bot:1"], random.Random(seed)
        )
        assert len(actions) == 1
        assert actions[0][2]["target_player_id"] == "bot:3"


def test_auction_distribute_submits_once_pool_is_fully_placed():
    rng = random.Random(23)
    state = {
        "status": "DISTRIBUTING",
        "winner_id": "bot:1",
        "pool_size": 2,
        "assignments": {"human:1": 1, "bot:2": 1},
    }
    actions = bot_engine.plan_bot_actions("auction", state, ["bot:1"], rng)
    assert len(actions) == 1
    delay_ms, actor, payload = actions[0]
    assert actor == "bot:1"
    assert payload == {"action": "SUBMIT"}
    assert 0 <= delay_ms <= 700


def test_auction_distribute_returns_nothing_if_pool_fully_capped_but_unplaced():
    # Degenerate case: pool_size exceeds every recipient's remaining capacity.
    # Shouldn't happen in a real game (pool_size <= n <= 2*(n-1)), but the
    # policy should still no-op rather than crash.
    rng = random.Random(24)
    state = {
        "status": "DISTRIBUTING",
        "winner_id": "bot:1",
        "pool_size": 10,
        "assignments": {"bot:2": 2},
    }
    assert bot_engine.plan_bot_actions("auction", state, ["bot:1"], rng) == []


def test_auction_policy_first_bid_is_a_valid_floor_or_higher_bid():
    # No current bid yet — a raise must still land at >= [1, 0], never [0, N].
    rng = random.Random(9)
    state = {"status": "BIDDING", "current_bid": None, "current_bidder_id": None}
    hits = 0
    for seed in range(200):
        actions = bot_engine.plan_bot_actions(
            "auction", state, ["bot:1", "bot:2"], random.Random(seed)
        )
        if not actions:
            continue
        hits += 1
        _, bidder, payload = actions[0]
        assert bidder in ("bot:1", "bot:2")
        assert payload["action"] == "BID"
        assert payload["chasers"] >= 1
        assert payload["points"] >= 0
    assert hits > 0  # continuation odds at progress=0 should virtually always fire


def test_auction_policy_never_rebids_against_the_current_bidder():
    rng = random.Random(10)
    state = {
        "status": "BIDDING",
        "current_bid": {"chasers": 1, "points": 5},
        "current_bidder_id": "bot:1",
    }
    for seed in range(50):
        actions = bot_engine.plan_bot_actions(
            "auction", state, ["bot:1"], random.Random(seed)
        )
        assert actions == []  # bot:1 is the only bot and already holds the lead


def test_auction_policy_raise_never_exceeds_one_chaser_or_ten_points():
    rng = random.Random(11)
    state = {
        "status": "BIDDING",
        "current_bid": {"chasers": 2, "points": 15},
        "current_bidder_id": "bot:1",
    }
    for seed in range(200):
        actions = bot_engine.plan_bot_actions(
            "auction", state, ["bot:1", "bot:2", "bot:3"], random.Random(seed)
        )
        if not actions:
            continue
        _, bidder, payload = actions[0]
        assert bidder != "bot:1"
        assert payload["chasers"] in (2, 3)
        assert payload["points"] - 15 <= 10
        # Must actually beat the current bid, per rule 4
        assert payload["chasers"] > 2 or payload["points"] > 15


def test_auction_policy_stops_at_the_ceiling():
    rng = random.Random(12)
    state = {
        "status": "BIDDING",
        "current_bid": {"chasers": 4, "points": 40},
        "current_bidder_id": "bot:1",
    }
    assert bot_engine.plan_bot_actions("auction", state, ["bot:1", "bot:2"], rng) == []


def test_black_box_box_selection_skips_human_holder():
    rng = random.Random(30)
    state = {"status": "BOX_SELECTION", "player_a_id": "human:1", "player_b_id": "bot:1"}
    assert bot_engine.plan_bot_actions("black_box", state, ["bot:1"], rng) == []


def test_black_box_box_selection_picks_a_legal_box_index():
    state = {"status": "BOX_SELECTION", "player_a_id": "bot:1", "player_b_id": "human:1"}
    for seed in range(50):
        actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1"], random.Random(seed))
        assert len(actions) == 1
        delay_ms, actor, payload = actions[0]
        assert actor == "bot:1"
        assert payload["action"] == "SELECT_BOX"
        assert 0 <= payload["box_index"] < 6
        assert 0 <= delay_ms <= 9_000


def test_black_box_bluffing_skips_human_guesser():
    rng = random.Random(31)
    state = {
        "status": "BLUFFING",
        "player_a_id": "bot:1",
        "player_b_id": "human:1",
        "boxes": [{"type": "DRINK", "chasers": 2}],
        "chosen_box_index": 0,
    }
    assert bot_engine.plan_bot_actions("black_box", state, ["bot:1"], rng) == []


def test_black_box_bluffing_decides_without_reading_the_true_box_content():
    # A bot Guesser must not dodge every DRINK box or grab every DISTRIBUTE
    # one — it should decide independently of the true (secretly visible in
    # state) box type, same as a real player who can't see it either.
    drink_state = {
        "status": "BLUFFING",
        "player_a_id": "human:1",
        "player_b_id": "bot:1",
        "boxes": [{"type": "DRINK", "chasers": 3}],
        "chosen_box_index": 0,
    }
    distribute_state = {**drink_state, "boxes": [{"type": "DISTRIBUTE", "chasers": 3}]}

    def decisions(state):
        seen = set()
        for seed in range(60):
            actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1"], random.Random(seed))
            assert len(actions) == 1
            delay_ms, actor, payload = actions[0]
            assert actor == "bot:1"
            assert payload["action"] in ("TAKE_BOX", "LEAVE_BOX")
            assert 7_000 <= delay_ms <= 12_000
            seen.add(payload["action"])
        return seen

    assert decisions(drink_state) == {"TAKE_BOX", "LEAVE_BOX"}
    assert decisions(distribute_state) == {"TAKE_BOX", "LEAVE_BOX"}


def test_black_box_distributing_skips_human_target():
    rng = random.Random(32)
    state = {
        "status": "DISTRIBUTING",
        "target_player_id": "human:1",
        "chosen_box_index": 0,
        "boxes": [{"type": "DISTRIBUTE", "chasers": 2}],
        "assignments": {"bot:1": 0},
    }
    assert bot_engine.plan_bot_actions("black_box", state, ["bot:1"], rng) == []


def test_black_box_distributing_assigns_to_least_assigned_recipient():
    rng = random.Random(33)
    state = {
        "status": "DISTRIBUTING",
        "target_player_id": "bot:1",
        "chosen_box_index": 0,
        "boxes": [{"type": "DISTRIBUTE", "chasers": 3}],
        "assignments": {"human:1": 1, "bot:2": 0, "bot:3": 0},
    }
    actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1", "bot:2", "bot:3"], rng)
    assert len(actions) == 1
    delay_ms, actor, payload = actions[0]
    assert actor == "bot:1"
    assert payload["action"] == "ASSIGN"
    assert payload["recipient_player_id"] in ("bot:2", "bot:3")
    # Subsequent places stay snappy — the first-place reveal wait already ran.
    assert 0 <= delay_ms <= 1_200


def test_black_box_distributing_first_assign_waits_out_client_reveal():
    rng = random.Random(33)
    state = {
        "status": "DISTRIBUTING",
        "target_player_id": "bot:1",
        "chosen_box_index": 0,
        "boxes": [{"type": "DISTRIBUTE", "chasers": 3}],
        "assignments": {"human:1": 0, "bot:2": 0, "bot:3": 0},
    }
    actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1", "bot:2", "bot:3"], rng)
    assert len(actions) == 1
    delay_ms, actor, payload = actions[0]
    assert actor == "bot:1"
    assert payload["action"] == "ASSIGN"
    # First place waits out the client's reveal (~10–12s after scale).
    assert 9_000 <= delay_ms <= 13_000


def test_black_box_distributing_can_place_all_three_on_a_single_recipient():
    # The whole point of black_box.py raising RECIPIENT_MAX_CHASERS to 3 —
    # confirm the bot policy can actually reach that cap too, on a 2-player
    # room's lone recipient.
    rng = random.Random(34)
    state = {
        "status": "DISTRIBUTING",
        "target_player_id": "bot:1",
        "chosen_box_index": 0,
        "boxes": [{"type": "DISTRIBUTE", "chasers": 3}],
        "assignments": {"human:1": 2},
    }
    actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1"], rng)
    assert len(actions) == 1
    assert actions[0][2] == {"action": "ASSIGN", "recipient_player_id": "human:1"}


def test_black_box_distributing_submits_once_pool_is_fully_placed():
    rng = random.Random(35)
    state = {
        "status": "DISTRIBUTING",
        "target_player_id": "bot:1",
        "chosen_box_index": 0,
        "boxes": [{"type": "DISTRIBUTE", "chasers": 2}],
        "assignments": {"human:1": 1, "bot:2": 1},
    }
    actions = bot_engine.plan_bot_actions("black_box", state, ["bot:1"], rng)
    assert len(actions) == 1
    delay_ms, actor, payload = actions[0]
    assert actor == "bot:1"
    assert payload == {"action": "SUBMIT"}
    # Confirm hover beat (~840–1400ms after scale).
    assert 800 <= delay_ms <= 1_500


def test_black_box_needs_reschedule_on_action():
    assert bot_engine.needs_reschedule_on_action("black_box") is True


def test_apply_practice_role_preference_is_a_noop_for_other_games():
    initial_state = {"player_a_id": "bot:1", "player_b_id": "bot:2"}
    result = bot_engine.apply_practice_role_preference("auction", initial_state, "human:1", "player_1")
    assert result is initial_state


def test_apply_practice_role_preference_is_a_noop_without_a_hint():
    initial_state = {"player_a_id": "bot:1", "player_b_id": "bot:2"}
    assert bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", None) is initial_state


def test_apply_practice_role_preference_places_human_as_player_1():
    initial_state = {
        "player_a_id": "bot:1",
        "player_b_id": "bot:2",
        "clock_offsets": {"bot:1": 0, "bot:2": 0, "human:1": 0, "bot:3": 0},
    }
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "player_1")
    assert result["player_a_id"] == "human:1"
    assert result["player_b_id"] == "bot:2"  # untouched — human just took A's seat


def test_apply_practice_role_preference_places_human_as_player_2():
    initial_state = {
        "player_a_id": "bot:1",
        "player_b_id": "bot:2",
        "clock_offsets": {"bot:1": 0, "bot:2": 0, "human:1": 0},
    }
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "player_2")
    assert result["player_a_id"] == "bot:1"
    assert result["player_b_id"] == "human:1"


def test_apply_practice_role_preference_swaps_seats_if_human_already_in_the_other_one():
    initial_state = {
        "player_a_id": "human:1",
        "player_b_id": "bot:2",
        "clock_offsets": {"human:1": 0, "bot:2": 0},
    }
    # Human was randomly picked as A, but asked for player_2 — swap, don't
    # bump them out of the duel entirely.
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "player_2")
    assert result["player_a_id"] == "bot:2"
    assert result["player_b_id"] == "human:1"


def test_apply_practice_role_preference_is_a_noop_if_human_already_in_requested_seat():
    initial_state = {"player_a_id": "human:1", "player_b_id": "bot:2"}
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "player_1")
    assert result is initial_state


def test_apply_practice_role_preference_moves_human_to_spectator():
    initial_state = {
        "player_a_id": "human:1",
        "player_b_id": "bot:2",
        "clock_offsets": {"human:1": 0, "bot:2": 0, "bot:3": 0, "bot:4": 0},
    }
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "spectator")
    assert "human:1" not in (result["player_a_id"], result["player_b_id"])
    assert result["player_b_id"] == "bot:2"  # B untouched, only A (the human's seat) was swapped out
    assert result["player_a_id"] in ("bot:3", "bot:4")


def test_apply_practice_role_preference_spectator_is_a_noop_if_already_spectating():
    initial_state = {"player_a_id": "bot:1", "player_b_id": "bot:2"}
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "spectator")
    assert result is initial_state


def test_apply_practice_role_preference_spectator_noop_if_nobody_else_to_swap_in():
    # Degenerate 2-player room: the human is stuck in the duel, no one else
    # exists to take their seat — leave them in it rather than crash.
    initial_state = {
        "player_a_id": "human:1",
        "player_b_id": "bot:2",
        "clock_offsets": {"human:1": 0, "bot:2": 0},
    }
    result = bot_engine.apply_practice_role_preference("black_box", initial_state, "human:1", "spectator")
    assert result is initial_state


def test_auction_policy_continuation_odds_shrink_near_the_ceiling():
    # Near the ceiling, a raise should fire much less often than at the start.
    state_low = {"status": "BIDDING", "current_bid": None, "current_bidder_id": None}
    state_high = {
        "status": "BIDDING",
        "current_bid": {"chasers": 3, "points": 38},
        "current_bidder_id": "bot:1",
    }
    low_hits = sum(
        1
        for seed in range(300)
        if bot_engine.plan_bot_actions("auction", state_low, ["bot:1", "bot:2"], random.Random(seed))
    )
    high_hits = sum(
        1
        for seed in range(300)
        if bot_engine.plan_bot_actions("auction", state_high, ["bot:1", "bot:2"], random.Random(seed + 10_000))
    )
    assert high_hits < low_hits
