"""Unit tests for app.engine.eligibility — the server-side mirror of
constants/games.ts's minPlayers field, and the helpers deck.py/room_service.py
use to decide which games a room can currently play."""
import json

import fakeredis
import pytest

from app.engine.eligibility import count_active_players, min_players_for, resolve_effective_games


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
