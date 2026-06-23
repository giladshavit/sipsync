import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.engine import fsm
from app.engine.deck import deck
from app.engine.fsm import RoomState
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.redis_client import redis

router = APIRouter(tags=["websocket"])

# per-process: room_code -> {player_id -> WebSocket}
_connections: dict[str, dict[str, WebSocket]] = {}
# rooms this worker already has a pub/sub listener for
_subscriptions: set[str] = set()
# per-room asyncio locks serialise concurrent GAME_ACTION handlers within a worker
_room_locks: dict[str, asyncio.Lock] = {}


def _room_lock(code: str) -> asyncio.Lock:
    if code not in _room_locks:
        _room_locks[code] = asyncio.Lock()
    return _room_locks[code]


async def _get_game_state(code: str) -> dict:
    raw = await redis.get(f"room:{code}:game")
    return json.loads(raw) if raw else {}


async def _set_game_state(code: str, state: dict) -> None:
    await redis.set(f"room:{code}:game", json.dumps(state))


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


async def _handle_game_action(code: str, player_id: str, payload: dict) -> None:
    """
    Atomically read game state, apply the player's action, persist the result,
    and broadcast. If the game finishes, enriches outcomes with total_score,
    persists updated scores, and drives the FSM to PERSONAL_SUMMARY.
    """
    result: tuple | None = None

    async with _room_lock(code):
        if await redis.hget(f"room:{code}", "state") != RoomState.PLAYING:
            return

        active_game_id = await redis.hget(f"room:{code}", "active_game")
        if not active_game_id:
            return

        current_state = await _get_game_state(code)
        game = load_game(active_game_id)
        new_state, is_finished, outcomes = game.handle_ws_event(
            player_id, payload, current_state
        )
        await _set_game_state(code, new_state)

        finished = False
        if is_finished:
            try:
                await fsm.transition(code, RoomState.PERSONAL_SUMMARY)
                finished = True
            except ValueError:
                pass  # another coroutine already transitioned

        result = (active_game_id, new_state, outcomes, finished)

    game_id, new_state, outcomes, finished = result

    await broadcast(code, {
        "type": "GAME_STATE",
        "game_id": game_id,
        "state": new_state,
    })

    if finished:
        players_raw = await redis.hgetall(f"room:{code}:players")
        players = {pid: json.loads(d) for pid, d in players_raw.items()}

        enriched: dict[str, dict] = {}
        for pid, outcome in outcomes.items():
            player_data = players.get(pid, {})
            delta = outcome.get("score_delta", 0)
            new_score = int(player_data.get("score", 0)) + delta
            player_data["score"] = new_score
            await redis.hset(f"room:{code}:players", pid, json.dumps(player_data))
            enriched[pid] = {**outcome, "total_score": new_score}

        await broadcast(code, {"type": "OUTCOMES", "outcomes": enriched})
        await broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.PERSONAL_SUMMARY.value,
        })


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

                # If a game is already running, send its current state so
                # late-joining or reconnecting clients don't miss the broadcast
                if state == RoomState.PLAYING:
                    active_game_id = await redis.hget(f"room:{code}", "active_game")
                    current_game_state = await _get_game_state(code)
                    if active_game_id and current_game_state:
                        await websocket.send_text(json.dumps({
                            "type": "GAME_STATE",
                            "game_id": active_game_id,
                            "state": current_game_state,
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

                # Select the next game now so tutorial info can be broadcast
                game_id = await deck.pop_next_game(code)
                if game_id is None:
                    continue
                await redis.hset(f"room:{code}", "active_game", game_id)

                try:
                    await fsm.transition(code, RoomState.TUTORIAL)
                except ValueError:
                    continue

                game_cls = GAME_REGISTRY.get(game_id)
                await broadcast(code, {
                    "type": "FSM_TRANSITION",
                    "new_state": RoomState.TUTORIAL.value,
                    **(
                        {
                            "tutorial_type": game_cls.tutorial_type,
                            "tutorial_asset": game_cls.tutorial_asset,
                        }
                        if game_cls
                        else {}
                    ),
                })

            elif msg_type == "TUTORIAL_DONE":
                admin_id = await redis.hget(f"room:{code}", "admin_id")
                if player_id != admin_id:
                    continue

                # Game was selected during ADMIN_START
                game_id = await redis.hget(f"room:{code}", "active_game")
                if game_id is None:
                    continue

                game = load_game(game_id)
                players_raw = await redis.hgetall(f"room:{code}:players")
                players_list = [
                    {"player_id": pid, **json.loads(d)}
                    for pid, d in players_raw.items()
                ]
                initial_state = game.get_initial_state(players_list)
                await _set_game_state(code, initial_state)

                try:
                    await fsm.transition(code, RoomState.PLAYING)
                except ValueError:
                    continue

                await broadcast(code, {
                    "type": "FSM_TRANSITION",
                    "new_state": RoomState.PLAYING.value,
                })
                await broadcast(code, {
                    "type": "GAME_STATE",
                    "game_id": game_id,
                    "state": initial_state,
                })

            elif msg_type == "GAME_ACTION":
                if player_id is None:
                    continue
                await _handle_game_action(code, player_id, msg.get("payload", {}))

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
