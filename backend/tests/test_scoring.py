from app.games.scoring import rank_groups, uniform_scores

# ---------------------------------------------------------------------------
# uniform_scores — even spread
# ---------------------------------------------------------------------------


def test_five_players_canonical_spread():
    groups = [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]]
    assert uniform_scores(groups) == {
        "p1": 10,
        "p2": 5,
        "p3": 0,
        "p4": -5,
        "p5": -10,
    }


def test_two_players_full_spread():
    assert uniform_scores([["p1"], ["p2"]]) == {"p1": 10, "p2": -10}


def test_three_players():
    assert uniform_scores([["p1"], ["p2"], ["p3"]]) == {"p1": 10, "p2": 0, "p3": -10}


def test_four_players_rounds_to_nearest_int():
    # interval 20/3 ≈ 6.67 → 10, 3.33, -3.33, -10
    groups = [["p1"], ["p2"], ["p3"], ["p4"]]
    assert uniform_scores(groups) == {"p1": 10, "p2": 3, "p3": -3, "p4": -10}


def test_rounding_is_symmetric_around_zero():
    # 9 players → interval 2.5 → raw 7.5 / -7.5 must round to 8 / -8
    groups = [[f"p{i}"] for i in range(1, 10)]
    scores = uniform_scores(groups)
    assert scores["p2"] == 8
    assert scores["p8"] == -8


# ---------------------------------------------------------------------------
# Extremes stay exclusive to 1st and last place
# ---------------------------------------------------------------------------


def test_second_place_never_reaches_ten():
    # 41 players → interval 0.5 → 2nd place raw 9.5 would round to 10
    groups = [[f"p{i}"] for i in range(1, 42)]
    scores = uniform_scores(groups)
    assert scores["p1"] == 10
    assert scores["p2"] == 9
    assert scores["p40"] == -9
    assert scores["p41"] == -10


# ---------------------------------------------------------------------------
# Ties — competition ranking (1, 2, 2, 4)
# ---------------------------------------------------------------------------


def test_tied_group_shares_place_and_next_place_skips():
    # 5 players, p2+p3 tied for 2nd → both get 5; p4 is 4th → -5
    groups = [["p1"], ["p2", "p3"], ["p4"], ["p5"]]
    assert uniform_scores(groups) == {
        "p1": 10,
        "p2": 5,
        "p3": 5,
        "p4": -5,
        "p5": -10,
    }


def test_full_dead_heat_everyone_first():
    assert uniform_scores([["p1", "p2", "p3"]]) == {"p1": 10, "p2": 10, "p3": 10}


# ---------------------------------------------------------------------------
# Disqualified players
# ---------------------------------------------------------------------------


def test_disqualified_always_score_bottom():
    # 1 valid player + 4 disqualified: DQs are NOT ranked as tied-for-2nd
    scores = uniform_scores([["p1"]], disqualified=["p2", "p3", "p4", "p5"])
    assert scores == {"p1": 10, "p2": -10, "p3": -10, "p4": -10, "p5": -10}


def test_all_disqualified():
    assert uniform_scores([], disqualified=["p1", "p2"]) == {"p1": -10, "p2": -10}


def test_empty_input():
    assert uniform_scores([]) == {}


def test_single_player_scores_top():
    assert uniform_scores([["p1"]]) == {"p1": 10}


# ---------------------------------------------------------------------------
# rank_groups
# ---------------------------------------------------------------------------


def test_rank_groups_lower_is_better_by_default():
    metrics = {"slow": 900, "fast": 100, "mid": 500}
    assert rank_groups(metrics) == [["fast"], ["mid"], ["slow"]]


def test_rank_groups_higher_is_better():
    metrics = {"few": 10, "many": 90, "mid": 50}
    assert rank_groups(metrics, higher_is_better=True) == [["many"], ["mid"], ["few"]]


def test_rank_groups_ties_grouped_together():
    metrics = {"a": 100, "b": 200, "c": 200, "d": 300}
    assert rank_groups(metrics) == [["a"], ["b", "c"], ["d"]]
