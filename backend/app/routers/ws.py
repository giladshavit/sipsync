import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.engine.room_service import room_service
from app.version_gate import WS_CLOSE_UPGRADE_REQUIRED, ws_client_version_ok

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/{code}")
async def room_ws(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    if not ws_client_version_ok(websocket):
        await websocket.close(code=WS_CLOSE_UPGRADE_REQUIRED)
        return
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
                case "START_CUSTOM_QUESTION":
                    await room_service.handle_start_custom_question(
                        code, player_id, msg.get("writer_id", "")
                    )
                case "SUBMIT_CUSTOM_QUESTION":
                    await room_service.handle_submit_custom_question(
                        code, player_id, msg.get("question_data", {})
                    )
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
                    # Fallback to a player_id carried in the message itself:
                    # a deliberate leave pressed while the screen's own
                    # socket is silently dead (iOS Safari kills sockets in
                    # the background without a close frame) is re-sent over
                    # a fresh throwaway connection that never HANDSHAKEs —
                    # so the connection-local player_id is None there. Trust
                    # model is unchanged: HANDSHAKE itself just claims a
                    # player_id, and the guest UUID is the auth token.
                    await room_service.handle_leave(
                        code, player_id or msg.get("player_id")
                    )
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
