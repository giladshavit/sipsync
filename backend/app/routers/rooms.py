import json
import secrets
import string
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.engine import bot_engine
from app.engine.deck import deck
from app.engine.room_service import room_service
from app.models.room import CreateRoomRequest, CreateRoomResponse, RoomInfoResponse
from app.redis_client import redis
from app.version_gate import require_client_version

router = APIRouter(
    prefix="/rooms", tags=["rooms"], dependencies=[Depends(require_client_version)]
)

_CODE_ALPHABET = string.ascii_uppercase.replace("O", "").replace("I", "") + string.digits.replace("0", "").replace("1", "")
_CODE_LENGTH = 6
_MAX_RETRIES = 10


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
            await deck.initialize(code, body.game_ids)
            # Minimum Players: the admin's real intent, tracked separately
            # from deck.py's own game_ids so a game later auto-pruned by
            # room_service._sync_eligible_games (e.g. auction, needing more
            # players than join at first) can come back on its own once the
            # room grows past its floor — see handle_set_games/
            # _sync_eligible_games in room_service.py.
            await redis.rpush(f"room:{code}:admin_game_ids", *body.game_ids)

            if body.practice:
                bot_records = bot_engine.build_bot_player_records(
                    bot_engine.bot_headcount(body.game_ids[0]), used_avatars=set()
                )
                if bot_records:
                    await redis.hset(
                        f"room:{code}:players",
                        mapping={bid: json.dumps(rec) for bid, rec in bot_records.items()},
                    )

            # Room Garbage Collection: applied last, after every room-scoped
            # key above has been written — see room_service.refresh_room_ttl.
            await room_service.refresh_room_ttl(code)

            return CreateRoomResponse(
                code=code,
                room_id=room_id,
                share_url=f"https://quicklegame.com/room/{code}",
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
