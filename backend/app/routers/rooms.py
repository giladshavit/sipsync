import json
import secrets
import string
import uuid

from fastapi import APIRouter, HTTPException

from app.engine import bot_engine
from app.engine.deck import deck
from app.models.room import CreateRoomRequest, CreateRoomResponse, RoomInfoResponse
from app.redis_client import redis

router = APIRouter(prefix="/rooms", tags=["rooms"])

_CODE_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "").replace("1", "")
_CODE_LENGTH = 6
_MAX_RETRIES = 10
_ROOM_TTL_SECONDS = 86_400
_PRACTICE_TTL_SECONDS = 1_800


def _generate_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))


@router.post("", response_model=CreateRoomResponse, status_code=201)
async def create_room(body: CreateRoomRequest) -> CreateRoomResponse:
    for _ in range(_MAX_RETRIES):
        code = _generate_code()
        key = f"room:{code}"
        room_id = str(uuid.uuid4())

        created = await redis.hsetnx(key, "state", "LOBBY")
        if created:
            room_fields = {
                "room_id": room_id,
                "admin_id": body.admin_id,
                "state": "LOBBY",
                "practice": "1" if body.practice else "0",
            }
            if body.practice and body.practice_role:
                room_fields["practice_role_hint"] = body.practice_role
            await redis.hset(key, mapping=room_fields)
            await redis.expire(key, _PRACTICE_TTL_SECONDS if body.practice else _ROOM_TTL_SECONDS)
            await deck.initialize(code, body.game_ids)

            if body.practice:
                bot_records = bot_engine.build_bot_player_records(
                    bot_engine.bot_headcount(body.game_ids[0]), used_avatars=set()
                )
                if bot_records:
                    await redis.hset(
                        f"room:{code}:players",
                        mapping={bid: json.dumps(rec) for bid, rec in bot_records.items()},
                    )

            return CreateRoomResponse(
                code=code,
                room_id=room_id,
                share_url=f"sipsync://room/{code}",
            )

    raise HTTPException(status_code=503, detail="Could not allocate a unique room code")


@router.get("/{code}", response_model=RoomInfoResponse)
async def get_room(code: str) -> RoomInfoResponse:
    key = f"room:{code}"
    state = await redis.hget(key, "state")

    if state is None:
        return RoomInfoResponse(exists=False, player_count=0, state=None)

    player_count = await redis.hlen(f"room:{code}:players")
    return RoomInfoResponse(exists=True, player_count=player_count, state=state)
