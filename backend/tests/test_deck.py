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
