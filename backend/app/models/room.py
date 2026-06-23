from pydantic import BaseModel, Field
from app.engine.fsm import RoomState
from app.engine.game_loader import GAME_REGISTRY


class CreateRoomRequest(BaseModel):
    admin_id: str = Field(..., description="Player UUID from SecureStore")
    game_ids: list[str] = Field(
        default_factory=lambda: list(GAME_REGISTRY.keys()),
        description="Ordered list of game IDs to include in this room's deck",
    )


class CreateRoomResponse(BaseModel):
    code: str = Field(..., description="6-char uppercase room code")
    room_id: str = Field(..., description="Internal UUID for the room")
    share_url: str = Field(..., description="Deep-link: sipsync://room/{code}")


class RoomInfoResponse(BaseModel):
    exists: bool
    player_count: int
    state: RoomState | None
