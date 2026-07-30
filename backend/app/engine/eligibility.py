"""Game eligibility by active player count.

REST is scoped to room create/join only (see CLAUDE.md), so there's no
endpoint through which the client's own frontend/constants/games.ts catalog
could inform the engine at request time — this module is the server-side
copy of just the one field (minPlayers) the room-management engine
(deck.py, room_service.py) needs. Keep MIN_PLAYERS in sync by hand whenever
a game's minPlayers changes in constants/games.ts.
"""

import json
from typing import Any

MIN_PLAYERS: dict[str, int] = {
    "flying_bomb": 3,
    "auction": 5,
    "black_box": 2,
    "dilemma": 2,
}


def min_players_for(game_id: str) -> int:
    return MIN_PLAYERS.get(game_id, 1)


async def count_active_players(redis_client: Any, room_code: str) -> int | None:
    """Players actually present right now — mirrors the frontend's own
    `connected !== false` filter (see lobby.tsx/podium.tsx's
    connectedPlayers) so client-side locks and server-side enforcement agree
    on the same number. A disconnected player mid-grace-period still holds
    their seat (see room_service._DISCONNECT_GRACE_MS) but shouldn't count
    toward whether the room has enough people for a game's floor. Bots have
    no `connected` field at all, defaulting to counted-as-present, same as
    a real player who's never disconnected.

    Returns None, not 0, when `room:{code}:players` doesn't exist at all —
    a non-practice room's player hash is only created lazily by the first
    HANDSHAKE, so it's possible (briefly, or in a test exercising deck.py in
    isolation) for a room's deck to be queried before any player record has
    ever been written. Treating that as "genuinely zero players" would fail
    every game's floor check and silently strand pop_next_game returning
    None; callers should treat None as "no player data to enforce a floor
    against yet" and skip eligibility filtering rather than block on it."""
    key = f"room:{room_code}:players"
    if not await redis_client.exists(key):
        return None
    players_raw = await redis_client.hgetall(key)
    return sum(
        1
        for raw in players_raw.values()
        if json.loads(raw).get("connected", True) is not False
    )


def resolve_effective_games(
    admin_ids: list[str], active_player_count: int, fallback: list[str]
) -> list[str]:
    """The subset of the admin's chosen games playable at the room's current
    headcount, order preserved. Falls back to `fallback` rather than ever
    returning an empty list — collapsing a room to zero playable games over
    a headcount dip would strand next_game_id at None until someone edits
    the selection by hand; deck.pop_next_game's own eligibility skip is the
    last-resort net for anything already queued when that happens."""
    eligible = [g for g in admin_ids if min_players_for(g) <= active_player_count]
    return eligible or fallback
