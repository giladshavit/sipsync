"""Uniform score distribution — shared scoring for free-for-all mini-games.

Scores spread evenly from +10 (1st place) down to -10 (last place):

    interval = 20 / (player_count - 1)
    score(place k) = 10 - (k - 1) * interval, rounded to nearest int

Rules:
- Ties use competition ranking (1, 2, 2, 4): a tied group shares the best
  place in it, and the next group skips the swallowed places.
- Only 1st place may score +10 and only last place may score -10 — any
  other place that rounds to the extremes is pulled back to ±9 so the
  podium ends stay distinguishable.
- Disqualified players (early tap, AFK, no report) always score -10.
"""

import math

_TOP = 10
_BOTTOM = -10


def uniform_scores(
    ranked_groups: list[list[str]],
    disqualified: list[str] | None = None,
) -> dict[str, int]:
    """Map player ids to scores.

    ranked_groups: tie-groups of player ids ordered best-first; every player
    in a group shares that group's place. Build them with rank_groups().
    disqualified: players with no rankable result — they all take -10.
    """
    dq = disqualified or []
    scores: dict[str, int] = {pid: _BOTTOM for pid in dq}

    total = sum(len(g) for g in ranked_groups) + len(dq)
    if total == 0:
        return scores
    interval = (_TOP - _BOTTOM) / (total - 1) if total > 1 else 0.0

    place = 1
    for group in ranked_groups:
        score = _round_half_away(_TOP - (place - 1) * interval)
        if place > 1:
            score = min(score, _TOP - 1)
        if place < total:
            score = max(score, _BOTTOM + 1)
        for pid in group:
            scores[pid] = score
        place += len(group)

    return scores


def rank_groups(
    metrics: dict[str, float], higher_is_better: bool = False
) -> list[list[str]]:
    """Group player ids by metric into tie-groups ordered best-first."""
    by_value: dict[float, list[str]] = {}
    for pid, value in metrics.items():
        by_value.setdefault(value, []).append(pid)
    return [by_value[v] for v in sorted(by_value, reverse=higher_is_better)]


def _round_half_away(x: float) -> int:
    # round() is banker's rounding; half-away-from-zero keeps the
    # distribution symmetric around 0 (7.5 → 8 and -7.5 → -8)
    return int(math.copysign(math.floor(abs(x) + 0.5), x))
