from pydantic import BaseModel, Field
from app.engine.fsm import RoomState


class CreateRoomRequest(BaseModel):
    admin_id: str = Field(..., description="Player UUID from SecureStore")


class CreateRoomResponse(BaseModel):
    code: str = Field(..., description="6-char uppercase room code")
    room_id: str = Field(..., description="Internal UUID for the room")
    share_url: str = Field(..., description="Deep-link: sipsync://room/{code}")


class RoomInfoResponse(BaseModel):
    exists: bool
    player_count: int
    state: RoomState | None
