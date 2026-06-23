from enum import StrEnum

from app.redis_client import redis


class RoomState(StrEnum):
    LOBBY = "LOBBY"
    TUTORIAL = "TUTORIAL"
    PLAYING = "PLAYING"
    PERSONAL_SUMMARY = "PERSONAL_SUMMARY"
    PODIUM = "PODIUM"


_ALLOWED: dict[RoomState, set[RoomState]] = {
    RoomState.LOBBY:            {RoomState.TUTORIAL},
    RoomState.TUTORIAL:         {RoomState.PLAYING},
    RoomState.PLAYING:          {RoomState.PERSONAL_SUMMARY},
    RoomState.PERSONAL_SUMMARY: {RoomState.PODIUM, RoomState.LOBBY},
    RoomState.PODIUM:           {RoomState.LOBBY},
}


def can_transition(from_state: RoomState, to_state: RoomState) -> bool:
    return to_state in _ALLOWED.get(from_state, set())


async def transition(code: str, to_state: RoomState) -> RoomState:
    """Read current state from Redis and atomically write to_state if the transition is allowed."""
    key = f"room:{code}"
    current = await redis.hget(key, "state")
    if current is None:
        raise ValueError(f"Room {code} does not exist")
    from_state = RoomState(current)
    if not can_transition(from_state, to_state):
        raise ValueError(f"Cannot transition {from_state} → {to_state}")
    await redis.hset(key, "state", to_state.value)
    return to_state
