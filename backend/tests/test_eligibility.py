"""Unit tests for app.engine.eligibility — the server-side mirror of
constants/games.ts's minPlayers field, and the helpers deck.py/room_service.py
use to decide which games a room can currently play."""
import json
import re
from pathlib import Path

import fakeredis
import pytest

from app.engine.eligibility import (
    MIN_PLAYERS,
    count_active_players,
    min_players_for,
    resolve_effective_games,
)


@pytest.fixture
def fake_redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


def test_min_players_for_known_games():
    assert min_players_for("auction") == 5
    assert min_players_for("flying_bomb") == 3
    assert min_players_for("black_box") == 2
    assert min_players_for("dilemma") == 2


def test_min_players_for_unlisted_game_defaults_to_one():
    assert min_players_for("reflex") == 1


def test_crowd_games_carry_a_three_player_floor():
    """majority / minority / sacrifice need a real group: at two players a
    1-1 vote is a coin flip and a 2-0 vote has no losing side at all (see
    app/games/majority.py), and The Sacrifice has nobody to spread the
    chasers across. They shipped with no floor in either catalogue, which is
    why a 2-player room's "Up Next" kept offering them."""
    for game_id in ("majority", "minority", "sacrifice"):
        assert min_players_for(game_id) == 3, game_id


# ── The hand-maintained mirror, checked mechanically ───────────────────────
# MIN_PLAYERS is a copy of constants/games.ts's minPlayers field (REST is
# scoped to room create/join, so the client's catalogue can never reach the
# engine at request time — see this module's own docstring). Parsing the TS
# source is what keeps "keep it in sync by hand" from silently drifting.

_GAMES_TS = Path(__file__).resolve().parents[2] / "frontend" / "constants" / "games.ts"
_ENTRY_RE = re.compile(r"^ {4}id: '(?P<id>[a-z_]+)',$", re.M)
_FLOOR_RE = re.compile(r"^ {4}minPlayers: (?P<floor>\d+),", re.M)


def _frontend_min_players() -> dict[str, int]:
    """Every game in constants/games.ts and the floor it declares — an absent
    minPlayers means 1, exactly like min_players_for's own default."""
    source = _GAMES_TS.read_text(encoding="utf-8")
    entries = list(_ENTRY_RE.finditer(source))
    assert entries, f"parsed no game entries out of {_GAMES_TS}"

    floors: dict[str, int] = {}
    for i, entry in enumerate(entries):
        end = entries[i + 1].start() if i + 1 < len(entries) else len(source)
        declared = _FLOOR_RE.search(source[entry.end():end])
        floors[entry.group("id")] = int(declared.group("floor")) if declared else 1
    return floors


def test_min_players_mirrors_the_frontend_catalog():
    frontend = _frontend_min_players()
    assert {game_id: min_players_for(game_id) for game_id in frontend} == frontend
    # ...and the backend table never names a game the catalogue doesn't have.
    assert set(MIN_PLAYERS) <= set(frontend)


@pytest.mark.asyncio
async def test_count_active_players_returns_none_when_no_players_hash_exists(fake_redis):
    """A non-practice room's player hash is only created lazily by the first
    HANDSHAKE — querying eligibility before that must not be mistaken for
    "genuinely zero players"."""
    assert await count_active_players(fake_redis, "NOPE") is None


@pytest.mark.asyncio
async def test_count_active_players_excludes_disconnected(fake_redis):
    await fake_redis.hset("room:CNT:players", mapping={
        "a": json.dumps({"connected": True}),
        "b": json.dumps({"connected": False}),
        "c": json.dumps({}),  # absent connected field treated as present, like a bot record
    })
    assert await count_active_players(fake_redis, "CNT") == 2


def test_resolve_effective_games_filters_by_floor():
    result = resolve_effective_games(["reflex", "auction"], active_player_count=2, fallback=["reflex", "auction"])
    assert result == ["reflex"]


def test_resolve_effective_games_falls_back_when_nothing_eligible():
    """Never collapse to empty — fall back rather than stranding the deck."""
    result = resolve_effective_games(["auction"], active_player_count=1, fallback=["auction"])
    assert result == ["auction"]
