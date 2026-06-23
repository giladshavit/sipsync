import random
from typing import Any

from app.redis_client import redis as _default_redis


class Deck:
    def __init__(self, redis_client: Any = None) -> None:
        self._redis = redis_client if redis_client is not None else _default_redis

    @staticmethod
    def _deck_key(room_code: str) -> str:
        return f"room:{room_code}:deck"

    @staticmethod
    def _game_ids_key(room_code: str) -> str:
        return f"room:{room_code}:game_ids"

    async def initialize(self, room_code: str, game_ids: list[str]) -> None:
        """Persist the game catalogue and push a shuffled deck into Redis."""
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        await self._redis.delete(ids_key, deck_key)
        if not game_ids:
            return

        await self._redis.rpush(ids_key, *game_ids)

        shuffled = game_ids.copy()
        random.shuffle(shuffled)
        await self._redis.rpush(deck_key, *shuffled)

    async def pop_next_game(self, room_code: str) -> str | None:
        """
        Pop the next game from the deck.
        When the deck is empty, reshuffles from the stored catalogue and continues.
        """
        deck_key = self._deck_key(room_code)

        game_id = await self._redis.rpop(deck_key)
        if game_id is not None:
            return game_id

        ids_key = self._game_ids_key(room_code)
        game_ids: list[str] = await self._redis.lrange(ids_key, 0, -1)
        if not game_ids:
            return None

        shuffled = game_ids.copy()
        random.shuffle(shuffled)
        await self._redis.rpush(deck_key, *shuffled)

        return await self._redis.rpop(deck_key)


deck = Deck()
