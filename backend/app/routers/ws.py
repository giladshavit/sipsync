import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.engine import fsm
from app.engine.fsm import RoomState
from app.redis_client import redis

router = APIRouter(tags=["websocket"])

# per-process: room_code -> {player_id -> WebSocket}
_connections: dict[str, dict[str, WebSocket]] = {}
# rooms this worker already has a pub/sub listener for
_subscriptions: set[str] = set()


async def _pubsub_listener(code: str) -> None:
    """Forward Redis pub/sub messages to all locally connected clients in a room."""
    channel = f"pubsub:room:{code}"
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for raw in pubsub.listen():
            if raw["type"] != "message":
                continue
            room_conns = _connections.get(code)
            if not room_conns:
                break
            text: str = raw["data"]
            for ws in list(room_conns.values()):
                try:
                    await ws.send_text(text)
                except Exception:
                    pass
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        _subscriptions.discard(code)


async def broadcast(code: str, message: dict) -> None:
    """Publish a message to all workers serving this room via Redis pub/sub."""
    await redis.publish(f"pubsub:room:{code}", json.dumps(message))


@router.websocket("/ws/{code}")
async def room_ws(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    player_id: str | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            msg: dict = json.loads(raw)
            msg_type: str = msg.get("type", "")

            if msg_type == "HANDSHAKE":
                player_id = msg["player_id"]
                display_name: str = msg["display_name"]
                local_ts: int = msg.get("local_ts", 0)

                clock_offset = int(time.time() * 1000) - local_ts

                await redis.hset(
                    f"room:{code}:players",
                    player_id,
                    json.dumps({
                        "display_name": display_name,
                        "score": 0,
                        "clock_offset": clock_offset,
                    }),
                )

                _connections.setdefault(code, {})[player_id] = websocket

                if code not in _subscriptions:
                    _subscriptions.add(code)
                    asyncio.create_task(_pubsub_listener(code))

                state = await redis.hget(f"room:{code}", "state")
                admin_id = await redis.hget(f"room:{code}", "admin_id")
                players_raw = await redis.hgetall(f"room:{code}:players")
                players = {pid: json.loads(d) for pid, d in players_raw.items()}

                # Send full snapshot directly — before pub/sub listener can race
                await websocket.send_text(json.dumps({
                    "type": "ROOM_STATE",
                    "state": state,
                    "admin_id": admin_id,
                    "players": players,
                }))

                await broadcast(code, {
                    "type": "PLAYER_JOINED",
                    "player_id": player_id,
                    "display_name": display_name,
                })

            elif msg_type == "ADMIN_START":
                admin_id = await redis.hget(f"room:{code}", "admin_id")
                if player_id != admin_id:
                    continue
                try:
                    await fsm.transition(code, RoomState.TUTORIAL)
                except ValueError:
                    continue
                await broadcast(code, {
                    "type": "FSM_TRANSITION",
                    "new_state": RoomState.TUTORIAL.value,
                })

    except WebSocketDisconnect:
        pass
    finally:
        if player_id:
            _connections.get(code, {}).pop(player_id, None)
            await redis.hdel(f"room:{code}:players", player_id)
            await broadcast(code, {
                "type": "PLAYER_LEFT",
                "player_id": player_id,
            })
