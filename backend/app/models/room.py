from typing import Literal

from pydantic import BaseModel, Field, field_validator
from app.engine.fsm import RoomState
from app.engine.game_loader import GAME_REGISTRY


def normalize_game_ids(game_ids: list[str]) -> list[str]:
    """Dedupe (order-preserving) and validate against the game registry.

    Shared by CreateRoomRequest's validator and the in-room SET_GAMES action
    so both entry points reject the same malformed input the same way.
    """
    unknown = [g for g in game_ids if g not in GAME_REGISTRY]
    if unknown:
        raise ValueError(f"Unknown game_ids: {unknown}")
    deduped = list(dict.fromkeys(game_ids))
    if not deduped:
        raise ValueError("At least one game_id is required")
    return deduped


class CreateRoomRequest(BaseModel):
    admin_id: str = Field(..., description="Player UUID from SecureStore")
    game_ids: list[str] = Field(
        default_factory=lambda: list(GAME_REGISTRY.keys()),
        description="Ordered list of game IDs to include in this room's deck",
    )
    practice: bool = Field(
        default=False,
        description="Solo practice-vs-bots room: seeds bot players and uses a shorter TTL",
    )
    practice_role: Literal["player_1", "player_2", "spectator"] | None = Field(
        default=None,
        description=(
            "Practice-vs-bots only, for a game that picks a small number of "
            "participants at random each round (currently black_box): which "
            "seat the human takes, instead of leaving it to chance. Ignored "
            "when practice=False or the active game doesn't use this hook."
        ),
    )

    @field_validator("game_ids")
    @classmethod
    def validate_game_ids(cls, v: list[str]) -> list[str]:
        return normalize_game_ids(v)


class CreateRoomResponse(BaseModel):
    code: str = Field(..., description="6-char uppercase room code")
    room_id: str = Field(..., description="Internal UUID for the room")
    share_url: str = Field(..., description="Deep-link: sipsync://room/{code}")


class RoomInfoResponse(BaseModel):
    exists: bool
    player_count: int
    state: RoomState | None
