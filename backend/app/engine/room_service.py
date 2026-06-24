import asyncio
import json
import time

import redis.exceptions as redis_exceptions
from fastapi import WebSocket

from app.engine import fsm
from app.engine.deck import deck
from app.engine.fsm import RoomState
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.redis_client import redis


class RoomService:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}
        self._subscriptions: set[str] = set()
        self._room_locks: dict[str, asyncio.Lock] = {}

    def _room_lock(self, code: str) -> asyncio.Lock:
        if code not in self._room_locks:
            self._room_locks[code] = asyncio.Lock()
        return self._room_locks[code]

    async def _get_game_state(self, code: str) -> dict:
        raw = await redis.get(f"room:{code}:game")
        return json.loads(raw) if raw else {}

    async def _set_game_state(self, code: str, state: dict) -> None:
        await redis.set(f"room:{code}:game", json.dumps(state))

    async def _pubsub_listener(self, code: str) -> None:
        """Forward Redis pub/sub messages to all locally connected clients in a room."""
        channel = f"pubsub:room:{code}"
        pubsub = redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            while code in self._subscriptions:
                try:
                    # Polling with 1s timeout. Swallows network silence without killing the Task.
                    msg = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if msg is None:
                        continue

                    room_conns = self._connections.get(code)
                    if not room_conns:
                        break

                    text: str = msg["data"]
                    for ws in list(room_conns.values()):
                        try:
                            await ws.send_text(text)
                        except Exception:
                            pass

                except (TimeoutError, redis_exceptions.TimeoutError):
                    await asyncio.sleep(0.1)
                    continue
                except asyncio.CancelledError:
                    break
                except Exception:
                    break
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await pubsub.aclose()
            except Exception:
                pass
            self._subscriptions.discard(code)

    async def broadcast(self, code: str, message: dict) -> None:
        """Publish a message to all workers serving this room via Redis pub/sub."""
        await redis.publish(f"pubsub:room:{code}", json.dumps(message))

    async def _enrich_scores_and_broadcast(self, code: str, outcomes: dict) -> None:
        """Update cumulative player scores and broadcast OUTCOMES + FSM_TRANSITION."""
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
        await self.broadcast(code, {"type": "OUTCOMES", "outcomes": enriched})
        await self.broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.PERSONAL_SUMMARY.value,
        })

    async def _trigger_next_game_tutorial(self, code: str) -> bool:
        """Pop the next game, persist it, transition FSM to TUTORIAL, and broadcast."""
        game_id = await deck.pop_next_game(code)
        if game_id is None:
            return False
        await redis.hset(f"room:{code}", "active_game", game_id)
        try:
            await fsm.transition(code, RoomState.TUTORIAL)
        except ValueError:
            return False
        game_cls = GAME_REGISTRY.get(game_id)
        await self.broadcast(code, {
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
        return True

    async def _game_timeout(self, code: str, timeout_at: int) -> None:
        """Auto-resolve the game once the tap window closes for any non-tapping players."""
        delay_s = max(0.0, (timeout_at - int(time.time() * 1000)) / 1000)
        await asyncio.sleep(delay_s)

        async with self._room_lock(code):
            if await redis.hget(f"room:{code}", "state") != RoomState.PLAYING:
                return  # already finished via normal taps

            active_game_id = await redis.hget(f"room:{code}", "active_game")
            if not active_game_id:
                return

            current_state = await self._get_game_state(code)
            taps: dict = current_state.get("taps", {})
            clock_offsets: dict = current_state.get("clock_offsets", {})

            if set(taps.keys()) >= set(clock_offsets.keys()):
                return  # all tapped already — normal path handled it

            game = load_game(active_game_id)
            new_state, outcomes = game.on_timeout(current_state)
            await self._set_game_state(code, new_state)

            try:
                await fsm.transition(code, RoomState.PERSONAL_SUMMARY)
            except ValueError:
                return

        await self._enrich_scores_and_broadcast(code, outcomes)

    async def _handle_game_action(
        self, code: str, player_id: str, payload: dict
    ) -> None:
        """
        Atomically read game state, apply the player's action, persist the result,
        and broadcast. If the game finishes, enriches outcomes with total_score,
        persists updated scores, and drives the FSM to PERSONAL_SUMMARY.
        """
        result: tuple | None = None

        async with self._room_lock(code):
            if await redis.hget(f"room:{code}", "state") != RoomState.PLAYING:
                return

            active_game_id = await redis.hget(f"room:{code}", "active_game")
            if not active_game_id:
                return

            current_state = await self._get_game_state(code)
            game = load_game(active_game_id)
            new_state, is_finished, outcomes = game.handle_ws_event(
                player_id, payload, current_state
            )
            await self._set_game_state(code, new_state)

            finished = False
            if is_finished:
                try:
                    await fsm.transition(code, RoomState.PERSONAL_SUMMARY)
                    finished = True
                except ValueError:
                    pass  # another coroutine already transitioned

            result = (active_game_id, new_state, outcomes, finished)

        game_id, new_state, outcomes, finished = result

        await self.broadcast(code, {
            "type": "GAME_STATE",
            "game_id": game_id,
            "state": new_state,
        })

        if finished:
            await self._enrich_scores_and_broadcast(code, outcomes)

    # ── Public handle_* interface ─────────────────────────────────────────────

    async def handle_handshake(
        self, code: str, websocket: WebSocket, msg: dict
    ) -> str:
        player_id: str = msg["player_id"]
        display_name: str = msg["display_name"]
        local_ts: int = msg.get("local_ts", 0)

        clock_offset = int(time.time() * 1000) - local_ts

        # Preserve existing score across reconnects (screen transitions
        # close and reopen the WebSocket, so score must survive).
        existing_raw = await redis.hget(f"room:{code}:players", player_id)
        existing = json.loads(existing_raw) if existing_raw else {}
        await redis.hset(
            f"room:{code}:players",
            player_id,
            json.dumps({
                "display_name": display_name,
                "score": existing.get("score", 0),
                "clock_offset": clock_offset,
            }),
        )

        self._connections.setdefault(code, {})[player_id] = websocket

        if code not in self._subscriptions:
            self._subscriptions.add(code)
            asyncio.create_task(self._pubsub_listener(code))

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
            current_game_state = await self._get_game_state(code)
            if active_game_id and current_game_state:
                await websocket.send_text(json.dumps({
                    "type": "GAME_STATE",
                    "game_id": active_game_id,
                    "state": current_game_state,
                }))

        # Re-read the player record so the broadcast includes the
        # correct score (not zero) when reconnecting after a round.
        rejoined_raw = await redis.hget(f"room:{code}:players", player_id)
        rejoined = json.loads(rejoined_raw) if rejoined_raw else {}
        await self.broadcast(code, {
            "type": "PLAYER_JOINED",
            "player_id": player_id,
            "display_name": display_name,
            "score": rejoined.get("score", 0),
            "clock_offset": rejoined.get("clock_offset", 0),
        })

        return player_id

    async def handle_admin_start(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await self._trigger_next_game_tutorial(code)

    async def handle_tutorial_done(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return

        # Game was selected during ADMIN_START / NEXT_ROUND
        game_id = await redis.hget(f"room:{code}", "active_game")
        if game_id is None:
            return

        game = load_game(game_id)
        players_raw = await redis.hgetall(f"room:{code}:players")
        players_list = [
            {"player_id": pid, **json.loads(d)}
            for pid, d in players_raw.items()
        ]
        initial_state = game.get_initial_state(players_list)
        await self._set_game_state(code, initial_state)

        try:
            await fsm.transition(code, RoomState.PLAYING)
        except ValueError:
            return

        await self.broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.PLAYING.value,
        })
        await self.broadcast(code, {
            "type": "GAME_STATE",
            "game_id": game_id,
            "state": initial_state,
        })

        timeout_at: int | None = initial_state.get("timeout_at")
        if timeout_at:
            asyncio.create_task(self._game_timeout(code, timeout_at))

    async def handle_next_round(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await self._trigger_next_game_tutorial(code)

    async def handle_goto_podium(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        try:
            await fsm.transition(code, RoomState.PODIUM)
        except ValueError:
            return
        await self.broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.PODIUM.value,
        })

    async def handle_admin_next(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await self._trigger_next_game_tutorial(code)

    async def handle_end_night(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await redis.delete(
            f"room:{code}",
            f"room:{code}:players",
            f"room:{code}:deck",
            f"room:{code}:game_ids",
            f"room:{code}:game",
        )
        await self.broadcast(code, {"type": "ROOM_DISSOLVED"})

    async def handle_game_action(
        self, code: str, player_id: str | None, payload: dict
    ) -> None:
        if player_id is None:
            return
        await self._handle_game_action(code, player_id, payload)

    async def handle_disconnect(
        self, code: str, player_id: str, websocket: WebSocket
    ) -> None:
        room_conns = self._connections.get(code, {})
        # Only remove this websocket if it is still the registered connection for
        # this player. Screen transitions (router.replace) mount the new screen
        # before unmounting the old one, so the new screen's HANDSHAKE may have
        # already replaced this entry in _connections. Removing it blindly would
        # sever the new connection and drop all subsequent broadcasts.
        if room_conns.get(player_id) is websocket:
            room_conns.pop(player_id, None)
            # Only announce departure when we actually removed the connection;
            # the new screen's PLAYER_JOINED already covers the screen-transition case.
            await self.broadcast(code, {
                "type": "PLAYER_LEFT",
                "player_id": player_id,
            })


room_service = RoomService()
