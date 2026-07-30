import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.engine.room_service import room_service

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{code}")
async def room_ws(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    player_id: str | None = None

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            match msg_type:
                case "HANDSHAKE":
                    player_id = await room_service.handle_handshake(code, websocket, msg)
                case "ADMIN_START":
                    await room_service.handle_admin_start(code, player_id)
                case "SET_GAMES":
                    await room_service.handle_set_games(
                        code, player_id, msg.get("game_ids", [])
                    )
                case "SET_AVATAR":
                    await room_service.handle_set_avatar(
                        code, player_id, msg.get("avatar", "")
                    )
                case "TUTORIAL_DONE":
                    await room_service.handle_tutorial_done(code, player_id)
                case "NEXT_ROUND":
                    await room_service.handle_next_round(code, player_id)
                case "GOTO_PODIUM":
                    await room_service.handle_goto_podium(code, player_id)
                case "ADMIN_NEXT":
                    await room_service.handle_admin_next(code, player_id)
                case "END_NIGHT":
                    await room_service.handle_end_night(code, player_id)
                case "SKIP_GAME":
                    await room_service.handle_skip_game(code, player_id)
                case "LEAVE_ROOM":
                    await room_service.handle_leave(code, player_id)
                case "GAME_ACTION":
                    await room_service.handle_game_action(
                        code, player_id, msg.get("payload", {})
                    )
                case _:
                    pass

    except WebSocketDisconnect:
        pass
    finally:
        if player_id:
            await room_service.handle_disconnect(code, player_id, websocket)
