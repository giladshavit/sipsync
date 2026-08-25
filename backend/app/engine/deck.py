import random
from typing import Any

from app.engine.eligibility import (
    DISCONNECT_GRACE_MS,
    count_active_players,
    min_players_for,
)
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
        """Persist the game catalogue and push a shuffled deck into Redis,
        as a single atomic MULTI/EXEC transaction — a concurrent reader
        (get_game_ids / peek_next_game / pop_next_game, possibly racing
        from another worker) must never observe game_ids and deck rebuilt
        out of step with each other."""
        ids_key = self._game_ids_key(room_code)
        deck_key = self._deck_key(room_code)

        if not game_ids:
            await self._redis.delete(ids_key, deck_key)
            return

        shuffled = game_ids.copy()
        random.shuffle(shuffled)

        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.delete(ids_key, deck_key)
            pipe.rpush(ids_key, *game_ids)
            pipe.rpush(deck_key, *shuffled)
            await pipe.execute()

    async def _active_count(self, room_code: str) -> int | None:
        """Headcount every eligibility decision in this module is made
        against. Counts a player who dropped less than DISCONNECT_GRACE_MS
        ago as still present: every screen transition closes and reopens each
        client's socket, and treating that momentary gap as a departure used
        to make the deck disagree with itself between one connection and the
        next (see count_active_players' own docstring)."""
        return await count_active_players(
            self._redis, room_code, grace_ms=DISCONNECT_GRACE_MS
        )

    async def get_game_ids(self, room_code: str) -> list[str]:
        """Read the room's stored game catalogue (selection order), no mutation."""
        return await self._redis.lrange(self._game_ids_key(room_code), 0, -1)

    async def peek_next_game(self, room_code: str) -> str | None:
        """
        Return the game `pop_next_game` would deal next, without removing it
        and without touching Redis at all — a pure read.

        It used to mirror pop_next_game's reshuffle-when-exhausted branch
        *and persist that reshuffle*, so that a peek and the pop after it
        agreed. That made every reader a writer: ROOM_STATE peeked once per
        WebSocket connection, so a room whose whole catalogue sat above its
        headcount grew its Redis deck by a full catalogue on every single
        handshake (4 → 6 → 8 → 10 → ...) and still returned None. Peek/pop
        agreement is a stored room fact now — room:{code}:next_game, written
        by room_service._refresh_next_game at the moments the queue genuinely
        changes — and `ensure_next_game` below is the single place allowed to
        replenish the deck on the way to computing it.

        Non-destructive: scans the existing deck from its pop end (rpop takes
        from the tail, so this reads back-to-front) rather than popping
        candidates off to inspect them. Returns None when nothing currently
        in the deck is playable at the room's headcount — a caller that wants
        a replenished deck asks for one explicitly.
        """
        game_ids: list[str] = await self._redis.lrange(self._game_ids_key(room_code), 0, -1)
        if not game_ids:
            return None

        active_count = await self._active_count(room_code)

        current_deck: list[str] = await self._redis.lrange(self._deck_key(room_code), 0, -1)
        for game_id in reversed(current_deck):
            if _is_eligible(game_id, active_count):
                return game_id

        return None

    async def ensure_next_game(self, room_code: str) -> str | None:
        """The game `pop_next_game` will deal next, reshuffling the deck from
        the stored catalogue first if nothing left in it is playable at the
        room's current headcount — so the end of a shuffle cycle advertises a
        real card instead of a blank one.

        Mutating, unlike `peek_next_game`: call it only from the write paths
        that hold the room lock and persist the result
        (room_service._refresh_next_game), never once per connection.
        Returns None *without touching the deck* when the room's whole
        catalogue needs more players than are present, so a room parked in
        that state can't grow an unbounded Redis list.
        """
        game_ids: list[str] = await self._redis.lrange(self._game_ids_key(room_code), 0, -1)
        if not game_ids:
            return None

        active_count = await self._active_count(room_code)
        if not any(_is_eligible(game_id, active_count) for game_id in game_ids):
            return None

        already_queued = await self.peek_next_game(room_code)
        if already_queued is not None:
            return already_queued

        shuffled = game_ids.copy()
        random.shuffle(shuffled)
        await self._redis.rpush(self._deck_key(room_code), *shuffled)
        return await self.peek_next_game(room_code)

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

        active_count = await self._active_count(room_code)

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
