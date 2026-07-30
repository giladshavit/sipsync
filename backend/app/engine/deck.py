import random
from typing import Any

from app.engine.eligibility import count_active_players, min_players_for
from app.redis_client import redis as _default_redis


def _is_eligible(game_id: str, active_count: int | None) -> bool:
    # None means "no player data for this room yet" (see
    # count_active_players) — treat as unconstrained rather than failing
    # every game's floor check.
    return active_count is None or min_players_for(game_id) <= active_count


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

    async def get_game_ids(self, room_code: str) -> list[str]:
        """Read the room's stored game catalogue (selection order), no mutation."""
        return await self._redis.lrange(self._game_ids_key(room_code), 0, -1)

    async def peek_next_game(self, room_code: str) -> str | None:
        """
        Return the game `pop_next_game` would return next, without removing
        it. Mirrors pop_next_game's own reshuffle-when-empty branch (and
        persists that reshuffle) so a peek and the pop that follows it always
        agree — a peek that reshuffled only in memory would show one game
        while the next real pop (reshuffling again, independently) handed out
        a different one. Also mirrors pop_next_game's player-count
        eligibility skip (see that method) so a game the room currently
        doesn't have enough people for is never shown as "Up Next" only for
        the real pop to discard it and hand out something else instead.

        Non-destructive: scans the existing deck from its pop end (rpop
        takes from the tail, so this reads back-to-front) rather than
        popping candidates off to inspect them, so a peek never consumes a
        card from the shuffle bag.
        """
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        game_ids: list[str] = await self._redis.lrange(ids_key, 0, -1)
        if not game_ids:
            return None

        active_count = await count_active_players(self._redis, room_code)

        current_deck: list[str] = await self._redis.lrange(deck_key, 0, -1)
        for game_id in reversed(current_deck):
            if _is_eligible(game_id, active_count):
                return game_id

        # Nothing left in the current deck is eligible — either it's
        # genuinely empty, or every remaining card needs more players than
        # are present. Reshuffle from the stored catalogue, same as
        # pop_next_game would, so the two methods keep agreeing.
        shuffled = game_ids.copy()
        random.shuffle(shuffled)
        await self._redis.rpush(deck_key, *shuffled)

        for game_id in reversed(shuffled):
            if _is_eligible(game_id, active_count):
                return game_id

        return None  # every game in the room's catalogue needs more players than are currently present

    async def pop_next_game(self, room_code: str) -> str | None:
        """
        Pop the next eligible game from the deck. When the deck runs out (or
        every card left in it needs more players than the room currently
        has), reshuffles from the stored catalogue and tries again from a
        fresh deck.

        The eligibility check is an extra safety net, not the primary
        enforcement — room_service._sync_eligible_games already prunes a
        room's *selected* game list on join/leave, but a game shuffled into
        this deck before that prune ran isn't retroactively pulled back out
        of it, so this is what actually keeps an under-strength game from
        being dealt out. Returns None only if every game in the room's
        catalogue needs more players than are currently present (or none are
        selected at all).
        """
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        game_ids: list[str] = await self._redis.lrange(ids_key, 0, -1)
        if not game_ids:
            return None

        active_count = await count_active_players(self._redis, room_code)

        # One pass over whatever's currently in the deck, then (if nothing
        # eligible turned up) one reshuffle-and-retry pass over a fresh
        # deck — bounded to these two passes so a room where every game
        # needs more players than are present returns None instead of
        # looping forever.
        for _ in range(2):
            while True:
                game_id = await self._redis.rpop(deck_key)
                if game_id is None:
                    break
                if _is_eligible(game_id, active_count):
                    return game_id
                # else: below the room's current floor — discard and try the next card down

            shuffled = game_ids.copy()
            random.shuffle(shuffled)
            await self._redis.rpush(deck_key, *shuffled)

        return None


deck = Deck()
