import json
from collections import Counter

import fakeredis
import pytest

from app.engine.deck import Deck


@pytest.fixture
def fake_redis():
    return fakeredis.FakeAsyncRedis(decode_responses=True)


@pytest.mark.asyncio
async def test_three_cycles_each_game_three_times(fake_redis):
    deck = Deck(redis_client=fake_redis)
    game_ids = ["game_a", "game_b", "game_c"]
    await deck.initialize("TEST", game_ids)

    results = [await deck.pop_next_game("TEST") for _ in range(9)]

    counts = Counter(results)
    assert counts["game_a"] == 3
    assert counts["game_b"] == 3
    assert counts["game_c"] == 3

    for i in range(3):
        cycle = set(results[i * 3 : (i + 1) * 3])
        assert cycle == set(game_ids), (
            f"Cycle {i} missing games: {results[i * 3 : (i + 1) * 3]}"
        )


@pytest.mark.asyncio
async def test_single_game_id_always_returns_it(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("SOLO", ["only_game"])

    for _ in range(5):
        result = await deck.pop_next_game("SOLO")
        assert result == "only_game"


@pytest.mark.asyncio
async def test_empty_game_ids_returns_none(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("EMPTY", [])

    assert await deck.pop_next_game("EMPTY") is None


@pytest.mark.asyncio
async def test_initialize_overwrites_previous_deck(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("REINIT", ["old_game"])
    await deck.initialize("REINIT", ["new_a", "new_b"])

    results = {await deck.pop_next_game("REINIT"), await deck.pop_next_game("REINIT")}
    assert results == {"new_a", "new_b"}


# ── Minimum Players safety net (see room_service._sync_eligible_games for the
# primary enforcement — this is the last-resort net for a game already
# shuffled into the deck before a player-count change pruned it) ───────────

async def _seed_players(fake_redis, room_code: str, count: int, connected: bool = True) -> None:
    mapping = {f"p{i}": json.dumps({"connected": connected}) for i in range(count)}
    await fake_redis.hset(f"room:{room_code}:players", mapping=mapping)


@pytest.mark.asyncio
async def test_pop_next_game_skips_game_needing_more_players_than_present(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("MINP", ["reflex", "auction"])  # auction needs 5
    await _seed_players(fake_redis, "MINP", 2)

    results = [await deck.pop_next_game("MINP") for _ in range(4)]

    assert "auction" not in results
    assert all(r == "reflex" for r in results)


@pytest.mark.asyncio
async def test_pop_next_game_returns_none_when_every_game_needs_more_players(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("ALLIN", ["auction"])  # needs 5
    await _seed_players(fake_redis, "ALLIN", 1)

    assert await deck.pop_next_game("ALLIN") is None


@pytest.mark.asyncio
async def test_disconnected_players_dont_count_toward_the_floor(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("DISC", ["dilemma"])  # needs 2
    await fake_redis.hset("room:DISC:players", mapping={
        "p1": json.dumps({"connected": True}),
        "p2": json.dumps({"connected": False}),
    })

    assert await deck.pop_next_game("DISC") is None


@pytest.mark.asyncio
async def test_peek_agrees_with_pop_when_filtering_ineligible_games(fake_redis):
    deck = Deck(redis_client=fake_redis)
    await deck.initialize("PEEK", ["reflex", "auction"])
    await _seed_players(fake_redis, "PEEK", 2)

    peeked = await deck.peek_next_game("PEEK")
    popped = await deck.pop_next_game("PEEK")

    assert peeked == popped == "reflex"
