import asyncio
import json
import random
import time

import redis.exceptions as redis_exceptions
from fastapi import WebSocket

from app.engine import bot_engine, fsm
from app.engine.deck import deck
from app.engine.fsm import RoomState
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.models.room import normalize_game_ids
from app.redis_client import redis

_bot_rng = random.Random()


def _round_fingerprint(state: dict) -> tuple:
    """Generic staleness key for scheduled bot-action tasks — same idea as
    _game_timeout's `timeout_at` check, generalized to also cover roulette's
    per-turn `turn_deadline_at`/`current_player_id` so a bot task scheduled
    for turn N no-ops if the round has moved to turn N+1 (or finished) by the
    time it wakes up. `status` is included too — black_box's single fixed
    `timeout_at` (set once at round start, never extended per-phase) doesn't
    change across its BOX_SELECTION/BLUFFING/DISTRIBUTING phases on its own,
    so a stale task from an earlier phase needs `status` to actually be
    caught here rather than falling through to handle_ws_event's own (also
    safe, just less immediate) status-gated no-op."""
    return (
        state.get("timeout_at"),
        state.get("turn_deadline_at"),
        state.get("current_player_id"),
        state.get("status"),
    )

# Generous last-resort safety net for PERSONAL_SUMMARY -> PODIUM: the real
# trigger is any client's GOTO_PODIUM (see handle_goto_podium, no longer
# admin-gated — any one client's signal is enough, so no single stalled
# client can block the room). This timer only exists in case *every* client
# somehow fails to signal. It's deliberately generous rather than matching
# the frontend's ~6s mandatory window exactly: different mini-games hold
# players on their own end-of-round reveal for different lengths of time
# (0-8s, e.g. closest_average) before a client even reaches the summary
# screen to start its own local lock — the server has no visibility into
# that per-game client-side delay, so a tight server deadline would fire
# before slower games' clients ever get there.
_SUMMARY_SAFETY_NET_MS = 25_000


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
        """Forward Redis pub/sub messages to all locally connected clients in
        a room, for the life of this worker process.

        Deliberately never exits just because this worker happens to have
        zero locally connected clients for the room at some instant — every
        round transition (game -> summary -> podium -> tutorial -> game)
        closes and reopens each client's socket via router.replace, so a
        broadcast landing while a client is mid-transition is routine, not a
        sign the room is abandoned. Exiting on that transient gap used to
        permanently kill this worker's forwarding for the room the instant it
        raced with a reconnecting client's handshake (both only checking
        `_subscriptions`, with nothing serializing the two): the listener
        would discard itself from `_subscriptions` in its `finally`, and if
        that happened right as a client's handshake had just observed the
        code as "already subscribed" and skipped spawning a replacement, the
        room was left with zero forwarders — silently swallowing every future
        broadcast (including the PERSONAL_SUMMARY -> PODIUM transition) for
        whoever connected to this worker, even though Redis's own room state
        kept advancing correctly.
        """
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

                    text: str = msg["data"]
                    for ws in list(self._connections.get(code, {}).values()):
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

        safety_net_at = int(time.time() * 1000) + _SUMMARY_SAFETY_NET_MS
        asyncio.create_task(self._summary_timeout(code, safety_net_at))

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

    async def _summary_timeout(self, code: str, safety_net_at: int) -> None:
        """Last-resort fallback for PERSONAL_SUMMARY -> PODIUM — see
        _SUMMARY_SAFETY_NET_MS. Normally a client's GOTO_PODIUM (any player,
        not just admin) gets there first; this only fires if every client
        somehow fails to signal."""
        delay_s = max(0.0, (safety_net_at - int(time.time() * 1000)) / 1000)
        await asyncio.sleep(delay_s)

        async with self._room_lock(code):
            if await redis.hget(f"room:{code}", "state") != RoomState.PERSONAL_SUMMARY:
                return  # already moved on (or room dissolved)
            try:
                await fsm.transition(code, RoomState.PODIUM)
            except ValueError:
                return

        await self.broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.PODIUM.value,
        })

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

            # Stale task from an earlier round that finished (and a new round
            # started) before this task's sleep elapsed — every game keeps
            # timeout_at fixed for the life of its round, so a mismatch means
            # this task no longer owns the room's active round.
            if current_state.get("timeout_at") != timeout_at:
                return

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

        # Broadcast the final game state before the outcomes so clients can
        # play their end-of-game animations (e.g. the poison card flip) —
        # without this, timeout-resolved rounds jump straight to the verdict.
        await self.broadcast(code, {
            "type": "GAME_STATE",
            "game_id": active_game_id,
            "state": new_state,
        })
        await self._enrich_scores_and_broadcast(code, outcomes)

    async def _maybe_schedule_bot_actions(self, code: str, game_id: str, state: dict) -> None:
        if await redis.hget(f"room:{code}", "practice") != "1":
            return
        players_raw = await redis.hgetall(f"room:{code}:players")
        bot_ids = [pid for pid, d in players_raw.items() if json.loads(d).get("is_bot")]
        if not bot_ids:
            return
        fingerprint = _round_fingerprint(state)
        for delay_ms, bot_id, payload in bot_engine.plan_bot_actions(game_id, state, bot_ids, _bot_rng):
            asyncio.create_task(self._run_bot_action(code, delay_ms, bot_id, payload, fingerprint))

    async def _run_bot_action(
        self, code: str, delay_ms: int, bot_id: str, payload: dict, fingerprint: tuple
    ) -> None:
        await asyncio.sleep(max(0.0, delay_ms / 1000))
        async with self._room_lock(code):
            if await redis.hget(f"room:{code}", "state") != RoomState.PLAYING:
                return
            current_state = await self._get_game_state(code)
            if _round_fingerprint(current_state) != fingerprint:
                return  # stale — round/turn already moved on (mirrors _game_timeout's timeout_at guard)
        # Lock released above — handle_game_action re-acquires it itself (not reentrant).
        await self.handle_game_action(code, bot_id, payload)

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
        elif bot_engine.needs_reschedule_on_action(game_id):
            await self._maybe_schedule_bot_actions(code, game_id, new_state)

    # ── Public handle_* interface ─────────────────────────────────────────────

    async def handle_handshake(
        self, code: str, websocket: WebSocket, msg: dict
    ) -> str:
        player_id: str = msg["player_id"]
        display_name: str = msg["display_name"]
        vibe: str | None = msg.get("vibe")
        preferred_avatar: str | None = msg.get("preferred_avatar")
        local_ts: int = msg.get("local_ts", 0)

        clock_offset = int(time.time() * 1000) - local_ts

        # Preserve existing score/avatar across reconnects (screen
        # transitions close and reopen the WebSocket, so both must survive).
        # The avatar-assignment read-then-write needs the room lock: two
        # players handshaking at once must never both land on the same
        # still-free avatar.
        async with self._room_lock(code):
            existing_raw = await redis.hget(f"room:{code}:players", player_id)
            existing = json.loads(existing_raw) if existing_raw else {}

            avatar = existing.get("avatar")
            if avatar is None:
                players_raw = await redis.hgetall(f"room:{code}:players")
                used = {
                    json.loads(d).get("avatar")
                    for pid, d in players_raw.items()
                    if pid != player_id
                }
                used.discard(None)
                avatar = pick_avatar(used, preferred_avatar)

            await redis.hset(
                f"room:{code}:players",
                player_id,
                json.dumps({
                    "display_name": display_name,
                    "score": existing.get("score", 0),
                    "clock_offset": clock_offset,
                    "vibe": vibe if vibe is not None else existing.get("vibe"),
                    "avatar": avatar,
                }),
            )

        self._connections.setdefault(code, {})[player_id] = websocket

        if code not in self._subscriptions:
            self._subscriptions.add(code)
            asyncio.create_task(self._pubsub_listener(code))

        state = await redis.hget(f"room:{code}", "state")
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        active_game_id = await redis.hget(f"room:{code}", "active_game")
        players_raw = await redis.hgetall(f"room:{code}:players")
        players = {pid: json.loads(d) for pid, d in players_raw.items()}

        # Reconnecting mid-TUTORIAL (e.g. a client that missed the PODIUM
        # round entirely and is catching up) needs the tutorial identity too —
        # the FSM_TRANSITION broadcast that carried it is long gone, and
        # without it the client can only render a generic placeholder.
        tutorial_fields: dict = {}
        if state == RoomState.TUTORIAL:
            game_cls = GAME_REGISTRY.get(active_game_id) if active_game_id else None
            if game_cls:
                tutorial_fields = {
                    "tutorial_type": game_cls.tutorial_type,
                    "tutorial_asset": game_cls.tutorial_asset,
                }

        game_ids = await deck.get_game_ids(code)
        practice = await redis.hget(f"room:{code}", "practice") == "1"

        # Send full snapshot directly — before pub/sub listener can race.
        # active_game is included whenever set (not just mid-round) so a
        # client that reconnects during PERSONAL_SUMMARY (e.g. summary.tsx
        # opening its own fresh socket) still knows which game was just
        # played — practice mode needs this to route back to that game's
        # rules screen instead of the podium.
        await websocket.send_text(json.dumps({
            "type": "ROOM_STATE",
            "state": state,
            "admin_id": admin_id,
            "players": players,
            "game_ids": game_ids,
            "practice": practice,
            "active_game": active_game_id,
            **tutorial_fields,
        }))

        # If a game is already running, send its current state so
        # late-joining or reconnecting clients don't miss the broadcast
        if state == RoomState.PLAYING:
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
            "vibe": rejoined.get("vibe"),
            "avatar": rejoined.get("avatar"),
        })

        return player_id

    async def handle_admin_start(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await self._trigger_next_game_tutorial(code)

    async def handle_set_games(
        self, code: str, player_id: str | None, game_ids: list[str]
    ) -> None:
        """Admin-only, lobby-only: replace the room's game selection and
        reshuffle the deck from it. Broadcasts the new selection so every
        player's lobby screen updates, not just the admin's."""
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        if await redis.hget(f"room:{code}", "state") != RoomState.LOBBY:
            return
        try:
            normalized = normalize_game_ids(game_ids)
        except ValueError:
            return
        await deck.initialize(code, normalized)
        await self.broadcast(code, {"type": "GAME_IDS_UPDATED", "game_ids": normalized})

    async def handle_set_avatar(self, code: str, player_id: str | None, avatar: str) -> None:
        """Self-service: any player may change their own room avatar, as long
        as it's a real pool entry no other current player already has."""
        if player_id is None:
            return
        if avatar not in AVATAR_POOL:
            return

        async with self._room_lock(code):
            players_raw = await redis.hgetall(f"room:{code}:players")
            own_raw = players_raw.get(player_id)
            if own_raw is None:
                return
            used = {
                json.loads(d).get("avatar")
                for pid, d in players_raw.items()
                if pid != player_id
            }
            if avatar in used:
                return
            own = json.loads(own_raw)
            own["avatar"] = avatar
            await redis.hset(f"room:{code}:players", player_id, json.dumps(own))

        await self.broadcast(code, {
            "type": "PLAYER_AVATAR_CHANGED",
            "player_id": player_id,
            "avatar": avatar,
        })

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

        # Generic per-room "don't repeat content within a cycle" pool: any
        # game whose state carries a `current_question` string participates
        # (currently majority/minority, which share one question bank —
        # what a player would recognize as "asked again" is the question
        # text itself, regardless of which scoring variant is attached to it
        # this round). Games that don't use `current_question` just ignore
        # the injected set, same as the `admin_id`-style fields above.
        asked_key = f"room:{code}:asked_questions"
        asked_questions = await redis.smembers(asked_key)

        players_list = [
            {"player_id": pid, "asked_questions": asked_questions, **json.loads(d)}
            for pid, d in players_raw.items()
        ]
        initial_state = game.get_initial_state(players_list)

        if await redis.hget(f"room:{code}", "practice") == "1":
            initial_state = bot_engine.guarantee_human_first_turn(game_id, initial_state, admin_id)
            role_hint = await redis.hget(f"room:{code}", "practice_role_hint")
            initial_state = bot_engine.apply_practice_role_preference(game_id, initial_state, admin_id, role_hint)

        # A game signals "the pool was exhausted, I started a fresh cycle" by
        # setting this — strip it before it's ever persisted/broadcast, and
        # reset the room's pool so the new cycle gets its own no-repeat
        # guarantee instead of finding everything already "asked" forever.
        if initial_state.pop("reset_question_cycle", False):
            await redis.delete(asked_key)
        if initial_state.get("current_question"):
            await redis.sadd(asked_key, initial_state["current_question"])

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

        bot_ids = [p["player_id"] for p in players_list if p.get("is_bot")]
        if bot_ids:
            fingerprint = _round_fingerprint(initial_state)
            for delay_ms, bot_id, bot_payload in bot_engine.plan_bot_actions(
                game_id, initial_state, bot_ids, _bot_rng
            ):
                asyncio.create_task(
                    self._run_bot_action(code, delay_ms, bot_id, bot_payload, fingerprint)
                )

    async def handle_next_round(self, code: str, player_id: str | None) -> None:
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        await self._trigger_next_game_tutorial(code)

    async def handle_goto_podium(self, code: str, player_id: str | None) -> None:
        """Any player (not just admin) can signal the room is ready to move
        on from PERSONAL_SUMMARY — deliberately not admin-gated, so a single
        stalled/backgrounded client (even the admin's) can't block everyone
        else. Each client sends this once its own local mandatory-window
        timer expires (see summary.tsx); the first one to arrive wins, the
        rest are harmless no-ops via the ValueError catch below."""
        if player_id is None:
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

    async def handle_leave(self, code: str, player_id: str | None) -> None:
        """
        Explicit, permanent departure (lobby back button) — unlike a transient
        disconnect, the player's record is deleted. If the host leaves, hosting
        passes to a random remaining player; if the room empties, it dissolves.
        """
        if player_id is None:
            return

        await redis.hdel(f"room:{code}:players", player_id)
        self._connections.get(code, {}).pop(player_id, None)

        await self.broadcast(code, {
            "type": "PLAYER_LEFT",
            "player_id": player_id,
        })

        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if admin_id != player_id:
            return

        players_raw = await redis.hgetall(f"room:{code}:players")
        if not players_raw:
            # Host left an empty room — nothing to hand over, clean up
            await redis.delete(
                f"room:{code}",
                f"room:{code}:players",
                f"room:{code}:deck",
                f"room:{code}:game_ids",
                f"room:{code}:game",
            )
            return

        new_admin = random.choice(list(players_raw.keys()))
        await redis.hset(f"room:{code}", "admin_id", new_admin)

        # Full snapshot so every client picks up the new host in one message
        state = await redis.hget(f"room:{code}", "state")
        players = {pid: json.loads(d) for pid, d in players_raw.items()}
        game_ids = await deck.get_game_ids(code)
        await self.broadcast(code, {
            "type": "ROOM_STATE",
            "state": state,
            "admin_id": new_admin,
            "players": players,
            "game_ids": game_ids,
        })

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
