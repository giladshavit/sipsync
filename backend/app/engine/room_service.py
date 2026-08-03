import asyncio
import json
import random
import time

import redis.exceptions as redis_exceptions
from fastapi import WebSocket

from app.engine import bot_engine, fsm
from app.engine.deck import deck
from app.engine.eligibility import count_active_players, resolve_effective_games
from app.engine.fsm import RoomState
from app.engine.avatar_pool import AVATAR_POOL, pick_avatar
from app.engine.game_loader import GAME_REGISTRY, load_game
from app.models.room import normalize_game_ids
from app.redis_client import redis

_bot_rng = random.Random()


def _select_new_admin(players_raw: dict[str, str]) -> str:
    """Host Migration: random new admin when the current one permanently
    departs (explicit LEAVE_ROOM or their own disconnect-grace-period
    expiry — see _finalize_departure, called from both). Prefers currently
    ACTIVE (connected, and not a Late Join still waiting_for_next_game)
    players — a player who is themselves mid-grace-period isn't actually
    present to do anything host-only, and a late joiner on the Waiting Room
    screen has no admin-gated controls to reach either, so handing either
    of them the room would just orphan it a second time. Falls back in
    tiers (connected-and-not-waiting -> connected -> anyone) so the room
    still has *a* admin_id even in a room made up entirely of
    disconnected/waiting players, rather than being left with none."""
    parsed = {pid: json.loads(raw) for pid, raw in players_raw.items()}
    connected_ids = [pid for pid, p in parsed.items() if p.get("connected", True)]
    fully_active_ids = [
        pid for pid in connected_ids if not parsed[pid].get("waiting_for_next_game")
    ]
    return random.choice(fully_active_ids or connected_ids or list(players_raw.keys()))


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

# Session Resilience: how long a disconnected player's seat, score, and
# avatar stay reserved before they're permanently removed. Covers brief
# network blips / app backgrounding without a client having to rejoin from
# scratch — see handle_disconnect / _disconnect_grace_timeout.
_DISCONNECT_GRACE_MS = 60_000

# Host Migration: how long a disconnected admin gets before someone else is
# handed the room — deliberately far shorter than _DISCONNECT_GRACE_MS, but
# generous enough to absorb both an ordinary screen-transition reconnect
# (every round transition closes and reopens each client's own socket,
# including the admin's) and a brief mobile-network blip, so a micro-drop
# doesn't trigger an unwarranted, jarring admin handoff. See
# _admin_migration_timeout, spawned from handle_disconnect.
_ADMIN_MIGRATION_GRACE_MS = 10_000

# Room Garbage Collection: Redis TTL applied to every room-scoped key.
# Refreshed to this value on room creation and on every WebSocket
# HANDSHAKE (join or reconnect) — see refresh_room_ttl, called from
# rooms.create_room and handle_handshake.
_ACTIVE_ROOM_TTL_SECONDS = 86_400

# Practice rooms (solo vs. bots) keep this much shorter ceiling instead —
# refreshed the same way as _ACTIVE_ROOM_TTL_SECONDS, so a *live* practice
# session doesn't expire mid-play, but a room is never promoted from this
# short-lived sandbox lifetime to the full 24h one.
_PRACTICE_ROOM_TTL_SECONDS = 1_800

# Grace period applied to every room-scoped key once the last WebSocket
# connection to the room closes (room:{code}:conn_count reaches 0) — see
# _apply_empty_room_ttl. If nobody reconnects in time, Redis deletes the
# room's keys natively; a reconnect within the window (handle_handshake)
# restores _ACTIVE_ROOM_TTL_SECONDS / _PRACTICE_ROOM_TTL_SECONDS instead.
# This is a backstop for the explicit room-teardown paths below
# (handle_end_night, _finalize_departure) — not a replacement for them.
_EMPTY_ROOM_TTL_SECONDS = 60


def _room_redis_keys(code: str) -> tuple[str, ...]:
    """Every Redis key scoped to a single room. Single source of truth for
    TTL refresh (refresh_room_ttl / _apply_empty_room_ttl) and explicit
    teardown (handle_end_night, _finalize_departure) alike — previously
    each of those listed keys inline and both omitted
    room:{code}:asked_questions, leaking it on every room teardown."""
    return (
        f"room:{code}",
        f"room:{code}:players",
        f"room:{code}:deck",
        f"room:{code}:game_ids",
        f"room:{code}:admin_game_ids",
        f"room:{code}:game",
        f"room:{code}:asked_questions",
        f"room:{code}:conn_count",
    )


class RoomService:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}
        self._subscriptions: set[str] = set()
        self._room_locks: dict[str, asyncio.Lock] = {}

    def _room_lock(self, code: str) -> asyncio.Lock:
        if code not in self._room_locks:
            self._room_locks[code] = asyncio.Lock()
        return self._room_locks[code]

    async def refresh_room_ttl(self, code: str) -> None:
        """Sets every room-scoped Redis key's TTL to the active-room value
        (or the shorter practice-room one) — called on room creation
        (rooms.create_room) and on every HANDSHAKE, i.e. every join or
        reconnect (handle_handshake). EXPIRE on a key that doesn't exist
        yet (e.g. room:{code}:asked_questions before any custom question)
        is a no-op, so this is safe to call unconditionally."""
        is_practice = await redis.hget(f"room:{code}", "practice") == "1"
        ttl = _PRACTICE_ROOM_TTL_SECONDS if is_practice else _ACTIVE_ROOM_TTL_SECONDS
        async with redis.pipeline(transaction=False) as pipe:
            for key in _room_redis_keys(code):
                pipe.expire(key, ttl)
            await pipe.execute()

    async def _apply_empty_room_ttl(self, code: str) -> None:
        """Room Garbage Collection: called once room:{code}:conn_count drops
        to 0 (the last WebSocket connection to the room closed, from either
        handle_disconnect or handle_leave). Gives a departed room
        _EMPTY_ROOM_TTL_SECONDS to be reclaimed by a reconnect
        (refresh_room_ttl) before Redis deletes its keys natively — a
        backstop for handle_end_night / _finalize_departure's own explicit,
        immediate deletes."""
        async with redis.pipeline(transaction=False) as pipe:
            for key in _room_redis_keys(code):
                pipe.expire(key, _EMPTY_ROOM_TTL_SECONDS)
            await pipe.execute()

    async def _get_game_state(self, code: str) -> dict:
        raw = await redis.get(f"room:{code}:game")
        return json.loads(raw) if raw else {}

    async def _set_game_state(self, code: str, state: dict) -> None:
        await redis.set(f"room:{code}:game", json.dumps(state))

    async def _build_room_state_payload(self, code: str, admin_id: str | None) -> dict:
        """Canonical full ROOM_STATE payload — the frontend's ROOM_STATE
        handler does a wholesale snapshot replace, not a merge, so every
        field the client depends on (active_game, practice, tutorial_type/
        tutorial_asset when mid-TUTORIAL) must be present on *every*
        ROOM_STATE this server ever sends, not just the handshake's own.
        Originally only handle_handshake built this; Host Migration's
        re-broadcast (_broadcast_new_admin_snapshot) grew its own
        independent, narrower payload that silently dropped active_game —
        breaking the round for every other client the instant an admin
        migration landed mid-game. Centralizing it here is what actually
        prevents that class of bug recurring, not just this one instance of
        it."""
        state = await redis.hget(f"room:{code}", "state")
        active_game_id = await redis.hget(f"room:{code}", "active_game")
        players_raw = await redis.hgetall(f"room:{code}:players")
        players = {pid: json.loads(d) for pid, d in players_raw.items()}
        game_ids = await deck.get_game_ids(code)
        practice = await redis.hget(f"room:{code}", "practice") == "1"

        # Reconnecting (or, for Host Migration, simply being re-synced)
        # mid-TUTORIAL needs the tutorial identity too — the FSM_TRANSITION
        # broadcast that normally carries it is long gone by the time a
        # later ROOM_STATE goes out, so without this the client can only
        # render a generic placeholder.
        tutorial_fields: dict = {}
        if state == RoomState.TUTORIAL:
            game_cls = GAME_REGISTRY.get(active_game_id) if active_game_id else None
            if game_cls:
                tutorial_fields = {
                    "tutorial_type": game_cls.tutorial_type,
                    "tutorial_asset": game_cls.tutorial_asset,
                }

        # Custom Question: reconnecting (or being re-synced) mid-input needs
        # to know who's writing, same reasoning as tutorial_fields above — the
        # FSM_TRANSITION broadcast that normally carries writer_id is long
        # gone by the time a later ROOM_STATE goes out.
        custom_question_fields: dict = {}
        if state == RoomState.CUSTOM_QUESTION_INPUT:
            custom_question_fields = {
                "writer_id": await redis.hget(f"room:{code}", "custom_question_writer_id"),
            }

        return {
            "type": "ROOM_STATE",
            "state": state,
            "admin_id": admin_id,
            "players": players,
            "game_ids": game_ids,
            "practice": practice,
            "active_game": active_game_id,
            # Up Next preview (podium.tsx): present on every ROOM_STATE, not
            # just while actually on PODIUM — cheap to compute and other
            # screens simply ignore it, same reasoning as the other fields
            # on this canonical payload (see this method's own docstring).
            "next_game_id": await deck.peek_next_game(code),
            **tutorial_fields,
            **custom_question_fields,
        }

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
            # Total Drinks: cumulative chasers owed across the whole night,
            # separate from any single round's outcome — the "TOTAL" tab in
            # the Who's Drinking popup reads this directly off the player
            # record rather than replaying every round's outcomes.
            new_total_chasers = int(player_data.get("total_chasers", 0)) + outcome.get("chasers", 0)
            player_data["total_chasers"] = new_total_chasers
            await redis.hset(f"room:{code}:players", pid, json.dumps(player_data))
            enriched[pid] = {**outcome, "total_score": new_score}

        # Late Join: anyone who joined mid-round was excluded from this
        # round's players_list (see handle_tutorial_done), so never appears
        # in `outcomes` above — they've now waited out the round they
        # missed, so clear the flag here rather than leaving them stuck
        # waiting through every subsequent round too.
        for pid, player_data in players.items():
            if pid in outcomes or not player_data.get("waiting_for_next_game"):
                continue
            player_data["waiting_for_next_game"] = False
            await redis.hset(f"room:{code}:players", pid, json.dumps(player_data))

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
            "next_game_id": await deck.peek_next_game(code),
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

    async def _sync_eligible_games(self, code: str, active_player_count: int) -> None:
        """Keeps the room's *effective* game_ids (the deck.py list actually
        used to shuffle/pop rounds, and what every client's GamesSheet reads
        as "selected") in step with the admin's real intent as the room's
        active headcount changes.

        The admin's actual choice is tracked separately in
        room:{code}:admin_game_ids, untouched by this method — that's what
        lets a game pruned out here because the room shrank come back on its
        own once enough players return, instead of the admin having to
        reselect it by hand. Triggered from handle_handshake (a join can
        grow the room back past a floor) and _finalize_departure (a
        permanent leave/grace-period expiry can shrink it below one).
        handle_set_games writes admin_game_ids itself and recomputes the
        effective list inline rather than calling this, since an explicit
        admin edit should always reshuffle/broadcast even when the effective
        set happens not to change — see that method."""
        admin_ids = await redis.lrange(f"room:{code}:admin_game_ids", 0, -1)
        if not admin_ids:
            return  # room hasn't had its games set yet

        current_ids = await deck.get_game_ids(code)
        new_ids = resolve_effective_games(admin_ids, active_player_count, fallback=admin_ids)

        if new_ids == current_ids:
            return  # no actual change — don't reshuffle the deck or broadcast for nothing

        await deck.initialize(code, new_ids)
        await self.broadcast(code, {"type": "GAME_IDS_UPDATED", "game_ids": new_ids})

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
            state = await redis.hget(f"room:{code}", "state")
            existing_raw = await redis.hget(f"room:{code}:players", player_id)
            existing = json.loads(existing_raw) if existing_raw else {}
            is_new_player = existing_raw is None

            players_raw = await redis.hgetall(f"room:{code}:players")
            used = {
                json.loads(d).get("avatar")
                for pid, d in players_raw.items()
                if pid != player_id
            }
            used.discard(None)

            avatar = existing.get("avatar")
            # Avatar Conflict Guard: normally a disconnected player's record
            # (and its avatar) stays reserved for the whole grace period, so
            # `avatar in used` shouldn't happen — but if it does (e.g. their
            # slot was already reaped and a new player claimed the id before
            # this reconnect landed), fall back to a fresh available avatar
            # instead of colliding with whoever has it now.
            if avatar is None or avatar in used:
                avatar = pick_avatar(used, preferred_avatar)

            # Late Join: a brand-new player_id connecting while a round is
            # already underway (TUTORIAL or PLAYING) can't retroactively be
            # part of it — its initial state was already computed from
            # whoever was present at the time (see handle_tutorial_done's
            # own exclusion of waiting_for_next_game players). They're added
            # to the roster immediately at 0 score like any new player, just
            # flagged so their own client shows a Waiting Room instead of a
            # live tutorial/board it has no data for them in. An existing
            # player's own reconnect must never re-derive this from the
            # *current* state (they might be reconnecting mid-round as a
            # full participant) — it only ever carries forward whatever this
            # player's record already had, cleared once the round they
            # missed actually ends (_enrich_scores_and_broadcast).
            if is_new_player:
                waiting_for_next_game = state in (RoomState.TUTORIAL, RoomState.PLAYING)
            else:
                waiting_for_next_game = existing.get("waiting_for_next_game", False)

            await redis.hset(
                f"room:{code}:players",
                player_id,
                json.dumps({
                    "display_name": display_name,
                    "score": existing.get("score", 0),
                    "clock_offset": clock_offset,
                    "vibe": vibe if vibe is not None else existing.get("vibe"),
                    "avatar": avatar,
                    "connected": True,
                    "disconnected_at": None,
                    "waiting_for_next_game": waiting_for_next_game,
                    # Total Drinks: this write replaces the whole player
                    # record, so anything not carried forward here from
                    # `existing` is silently lost on every reconnect.
                    "total_chasers": existing.get("total_chasers", 0),
                }),
            )

        self._connections.setdefault(code, {})[player_id] = websocket

        if code not in self._subscriptions:
            self._subscriptions.add(code)
            asyncio.create_task(self._pubsub_listener(code))

        # Minimum Players: a join can bring the room back up to a game's
        # floor (e.g. auction dropping out earlier because the room shrank).
        # Run before building the snapshot below so this client's own first
        # ROOM_STATE already reflects the corrected list, instead of a flash
        # of the stale one followed by a GAME_IDS_UPDATED broadcast a moment
        # later.
        active_count = await count_active_players(redis, code)
        if active_count is not None:
            await self._sync_eligible_games(code, active_count)

        admin_id = await redis.hget(f"room:{code}", "admin_id")

        # Send full snapshot directly — before pub/sub listener can race.
        # active_game is included whenever set (not just mid-round) so a
        # client that reconnects during PERSONAL_SUMMARY (e.g. summary.tsx
        # opening its own fresh socket) still knows which game was just
        # played — practice mode needs this to route back to that game's
        # rules screen instead of the podium.
        payload = await self._build_room_state_payload(code, admin_id)
        await websocket.send_text(json.dumps(payload))

        # If a game is already running, send its current state so
        # late-joining or reconnecting clients don't miss the broadcast
        if payload["state"] == RoomState.PLAYING:
            active_game_id = payload["active_game"]
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
            # Always true here — this event fires for both brand-new joins and
            # reconnects (see the comment above handle_disconnect); it's what
            # flips a client's local "disconnected" flag back off.
            "connected": True,
            # Late Join: lets other clients' own rosters reflect a new
            # arrival's waiting status too, not just the joiner's own screen
            # (which decides its routing from the ROOM_STATE snapshot).
            "waiting_for_next_game": rejoined.get("waiting_for_next_game", False),
            # Total Drinks: reconnecting must not reset the "TOTAL" tab's
            # tally for this player on every other client's popup.
            "total_chasers": rejoined.get("total_chasers", 0),
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
        """Admin-only: replace the room's game selection and reshuffle the
        deck from it. Broadcasts the new selection so every player's screen
        updates, not just the admin's. Allowed from LOBBY (before the night
        starts) and from PODIUM (Mid-Session Game Editing — the admin can
        adjust the lineup between rounds without restarting the room).

        Minimum Players: `normalized` is persisted verbatim as the admin's
        real intent (room:{code}:admin_game_ids) — untouched by player-count
        changes — so _sync_eligible_games can restore a game that's later
        auto-pruned once the room grows back past its floor. What's actually
        pushed into the deck and broadcast is the *effective* subset playable
        at the room's current headcount right now (falling back to the full
        `normalized` list if every one of the admin's picks needs more
        players than are present, rather than ever collapsing to empty).
        Deliberately always reshuffles/broadcasts on this explicit admin
        action, even on the rare edit where the effective set doesn't
        actually change — unlike _sync_eligible_games's own no-op-if-
        unchanged guard, which exists only to keep automatic join/leave syncs
        from spamming reshuffles."""
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        if await redis.hget(f"room:{code}", "state") not in (RoomState.LOBBY, RoomState.PODIUM):
            return
        try:
            normalized = normalize_game_ids(game_ids)
        except ValueError:
            return

        await redis.delete(f"room:{code}:admin_game_ids")
        await redis.rpush(f"room:{code}:admin_game_ids", *normalized)

        active_count = await count_active_players(redis, code)
        effective = (
            normalized
            if active_count is None
            else resolve_effective_games(normalized, active_count, fallback=normalized)
        )

        await deck.initialize(code, effective)
        await self.broadcast(code, {"type": "GAME_IDS_UPDATED", "game_ids": effective})

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

        # Late Join: exclude anyone still waiting_for_next_game — they
        # joined mid-TUTORIAL (after this round's game was already picked)
        # or mid-PLAYING and were flagged in handle_handshake precisely so
        # they're never part of a round's initial state computed without
        # them. They become eligible starting the round after this one,
        # once _enrich_scores_and_broadcast clears the flag at round end.
        players_list = []
        for pid, d in players_raw.items():
            parsed = json.loads(d)
            if parsed.get("waiting_for_next_game"):
                continue
            players_list.append({"player_id": pid, "asked_questions": asked_questions, **parsed})
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

    # Custom Question games (majority/minority only) — admin-gated pair that
    # lets the room write its own prompt instead of drawing one from the deck
    # pool. See RoomState.CUSTOM_QUESTION_INPUT.
    _CUSTOM_QUESTION_GAME_IDS = ("majority", "minority")

    async def handle_start_custom_question(
        self, code: str, player_id: str | None, writer_id: str
    ) -> None:
        """Admin-only, TUTORIAL-only: instead of handle_tutorial_done's
        random draw from the deck pool, hands one connected player the pen.
        Transitions to CUSTOM_QUESTION_INPUT and broadcasts who's writing so
        every other client can render its own waiting screen naming them."""
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        if await redis.hget(f"room:{code}", "state") != RoomState.TUTORIAL:
            return

        game_id = await redis.hget(f"room:{code}", "active_game")
        if game_id not in self._CUSTOM_QUESTION_GAME_IDS:
            return

        writer_raw = await redis.hget(f"room:{code}:players", writer_id)
        if writer_raw is None:
            return
        writer_record = json.loads(writer_raw)
        # Late Join: a player still waiting_for_next_game is excluded from
        # this round's own players_list (see handle_submit_custom_question)
        # and has no route to the writer's input screen — picking them would
        # strand the room in CUSTOM_QUESTION_INPUT with no one able to submit.
        if not writer_record.get("connected", True) or writer_record.get("waiting_for_next_game"):
            return

        try:
            await fsm.transition(code, RoomState.CUSTOM_QUESTION_INPUT)
        except ValueError:
            return

        await redis.hset(f"room:{code}", "custom_question_writer_id", writer_id)
        await self.broadcast(code, {
            "type": "FSM_TRANSITION",
            "new_state": RoomState.CUSTOM_QUESTION_INPUT.value,
            "writer_id": writer_id,
        })

    async def handle_submit_custom_question(
        self, code: str, player_id: str | None, question_data: dict
    ) -> None:
        """Writer-only, CUSTOM_QUESTION_INPUT-only: seeds the round from the
        submitted question/options — via MajorityGame.get_initial_state's
        `custom_question` param — instead of a random deck draw, then
        proceeds exactly like handle_tutorial_done from there (same FSM
        target, same GAME_STATE broadcast, same timeout scheduling)."""
        if player_id is None:
            return
        if await redis.hget(f"room:{code}", "state") != RoomState.CUSTOM_QUESTION_INPUT:
            return
        writer_id = await redis.hget(f"room:{code}", "custom_question_writer_id")
        if player_id != writer_id:
            return

        question = str(question_data.get("question", "")).strip()
        option_a = str(question_data.get("option_a", "")).strip()
        option_b = str(question_data.get("option_b", "")).strip()
        if not question or not option_a or not option_b:
            return

        game_id = await redis.hget(f"room:{code}", "active_game")
        if game_id not in self._CUSTOM_QUESTION_GAME_IDS:
            return
        game = load_game(game_id)

        players_raw = await redis.hgetall(f"room:{code}:players")
        players_list = [
            {"player_id": pid, **json.loads(d)}
            for pid, d in players_raw.items()
            if not json.loads(d).get("waiting_for_next_game")
        ]
        initial_state = game.get_initial_state(
            players_list,
            custom_question={"question": question, "option_a": option_a, "option_b": option_b},
        )

        await self._set_game_state(code, initial_state)
        await redis.hdel(f"room:{code}", "custom_question_writer_id")

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
            "next_game_id": await deck.peek_next_game(code),
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
            f"room:{code}:admin_game_ids",
            f"room:{code}:game",
        )
        await self.broadcast(code, {"type": "ROOM_DISSOLVED"})

    async def handle_skip_game(self, code: str, player_id: str | None) -> None:
        """Admin-only, PODIUM-only: burns the currently-queued Up Next game
        (deck.pop_next_game) and broadcasts whichever game is now up next, so
        every client's preview card updates without a full ROOM_STATE
        round-trip."""
        admin_id = await redis.hget(f"room:{code}", "admin_id")
        if player_id != admin_id:
            return
        if await redis.hget(f"room:{code}", "state") != RoomState.PODIUM:
            return
        await deck.pop_next_game(code)
        new_next_game_id = await deck.peek_next_game(code)
        await self.broadcast(code, {
            "type": "NEXT_GAME_UPDATED",
            "next_game_id": new_next_game_id,
        })

    async def handle_game_action(
        self, code: str, player_id: str | None, payload: dict
    ) -> None:
        if player_id is None:
            return
        await self._handle_game_action(code, player_id, payload)

    async def _broadcast_new_admin_snapshot(self, code: str, new_admin_id: str) -> None:
        """Full ROOM_STATE so every client picks up the new host in one
        message. Shared by both immediate Host Migration (the admin's own
        socket drops — see handle_disconnect, which can't afford to wait out
        the full disconnect grace period since admin-gated actions would
        freeze the room the whole time) and the eventual permanent-departure
        reassignment (_finalize_departure, explicit LEAVE_ROOM or grace
        period expiry). Caller must have already persisted `admin_id` in
        Redis.

        Uses the same _build_room_state_payload as handle_handshake — the
        frontend replaces its entire snapshot wholesale on ROOM_STATE, not a
        merge, so a narrower ad-hoc payload here would silently blank out
        whatever fields it left out (active_game, practice, tutorial_*) for
        every other connected client the instant this lands.
        """
        payload = await self._build_room_state_payload(code, new_admin_id)
        await self.broadcast(code, payload)

        # ROOM_STATE never carries live round data (gameState) — only a
        # companion GAME_STATE message does, and unlike the fields above,
        # the frontend's snapshot replace can't "forget" gameState from a
        # payload that never had a chance to include it in the first place.
        # Re-broadcasting it here, mirroring the same pairing handle_handshake
        # sends a reconnecting client directly, is what keeps every other
        # client's live round intact across a migration landing mid-game
        # instead of everyone falling back to a blank "no active game" state.
        if payload["state"] == RoomState.PLAYING:
            active_game_id = payload["active_game"]
            current_game_state = await self._get_game_state(code)
            if active_game_id and current_game_state:
                await self.broadcast(code, {
                    "type": "GAME_STATE",
                    "game_id": active_game_id,
                    "state": current_game_state,
                })

    async def _finalize_departure(self, code: str, player_id: str) -> None:
        """Broadcasts a departing player's permanent removal and, if they were
        admin, reassigns host (or dissolves an emptied room). Caller must have
        already deleted the player's Redis record. Shared by explicit
        LEAVE_ROOM and disconnect-grace-period expiry — the two paths that
        actually remove a player, as opposed to just marking them
        disconnected."""
        await self.broadcast(code, {
            "type": "PLAYER_LEFT",
            "player_id": player_id,
        })

        # Minimum Players: a permanent departure can shrink the room below a
        # game's floor (e.g. auction/flying_bomb dropping out). Caller has
        # already deleted this player's Redis record, so the fresh count
        # here already excludes them.
        active_count = await count_active_players(redis, code)
        if active_count:
            await self._sync_eligible_games(code, active_count)

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
                f"room:{code}:admin_game_ids",
                f"room:{code}:game",
            )
            return

        new_admin = _select_new_admin(players_raw)
        await redis.hset(f"room:{code}", "admin_id", new_admin)
        await self._broadcast_new_admin_snapshot(code, new_admin)

    async def handle_leave(self, code: str, player_id: str | None) -> None:
        """
        Explicit, permanent departure (lobby back button) — unlike a transient
        disconnect, the player's record is deleted immediately, no grace
        period. If the host leaves, hosting passes to a random remaining
        player; if the room empties, it dissolves.
        """
        if player_id is None:
            return

        async with self._room_lock(code):
            await redis.hdel(f"room:{code}:players", player_id)
            self._connections.get(code, {}).pop(player_id, None)

        await self._finalize_departure(code, player_id)

    async def handle_disconnect(
        self, code: str, player_id: str, websocket: WebSocket
    ) -> None:
        """
        Session Resilience: a dropped socket does NOT remove the player. Their
        record (score, avatar, accumulated drinks) is kept and just marked
        DISCONNECTED with a timestamp; handle_handshake restores them to
        ACTIVE if they reconnect within _DISCONNECT_GRACE_MS. Only
        _disconnect_grace_timeout, once the grace period actually elapses
        without a reconnect, performs the permanent removal.

        Host Migration is the one exception to "just wait out the grace
        period": nearly every room-progressing action (ADMIN_START,
        TUTORIAL_DONE, SET_GAMES, NEXT_ROUND, ...) is admin-gated, so a
        disconnected admin would freeze the room for the full 60s — or
        longer, since a bad connection often won't reconnect within it
        either. If the disconnecting player is the admin, a new one is
        picked after _ADMIN_MIGRATION_GRACE_MS (see
        _admin_migration_timeout), not the full 60s. Their own player
        record (score, avatar) is unaffected either way and still gets the
        normal grace period like any other player — only `admin_id` moves.
        """
        room_conns = self._connections.get(code, {})
        # Only act on this websocket if it is still the registered connection
        # for this player. Screen transitions (router.replace) mount the new
        # screen before unmounting the old one, so the new screen's HANDSHAKE
        # may have already replaced this entry in _connections. Treating that
        # race as a real disconnect would mark a still-present player
        # DISCONNECTED right after their own reconnect set them ACTIVE.
        if room_conns.get(player_id) is not websocket:
            return
        room_conns.pop(player_id, None)

        disconnected_at = int(time.time() * 1000)
        was_admin = False
        async with self._room_lock(code):
            raw = await redis.hget(f"room:{code}:players", player_id)
            if raw is None:
                return
            player = json.loads(raw)
            player["connected"] = False
            player["disconnected_at"] = disconnected_at
            await redis.hset(f"room:{code}:players", player_id, json.dumps(player))
            was_admin = await redis.hget(f"room:{code}", "admin_id") == player_id

        await self.broadcast(code, {
            "type": "PLAYER_DISCONNECTED",
            "player_id": player_id,
            "grace_period_ms": _DISCONNECT_GRACE_MS,
        })

        # Full 60s removal timer regardless of admin status — untouched by
        # the admin-migration timeout below, which only ever concerns *who
        # holds admin_id*, never whether/when this player's own record gets
        # permanently deleted.
        asyncio.create_task(
            self._disconnect_grace_timeout(code, player_id, disconnected_at)
        )

        if was_admin:
            asyncio.create_task(
                self._admin_migration_timeout(code, player_id, disconnected_at)
            )

    async def _admin_migration_timeout(
        self, code: str, player_id: str, disconnected_at: int
    ) -> None:
        """Host Migration: hands the room to someone else once a
        disconnected admin has been gone for _ADMIN_MIGRATION_GRACE_MS —
        far short of the full _DISCONNECT_GRACE_MS (so the room doesn't
        freeze on every admin-gated action for a minute), but comfortably
        longer than an ordinary reconnect round trip or a mobile micro-drop
        (so those don't trigger an unwarranted handoff either).

        The identity check in handle_disconnect filters out a screen
        transition ONLY when the new screen's HANDSHAKE happens to register
        before the old socket's close reaches the server — in practice the
        old socket's close is usually the faster of the two (no network
        round trip needed), so that ordering can't be relied on alone. This
        timeout, and its staleness re-check below, is what actually
        distinguishes "mid screen-transition (or a brief network blip)" from
        "really gone" — mirrors the same sleep-then-recheck idiom as
        _disconnect_grace_timeout.
        """
        delay_s = max(
            0.0,
            (disconnected_at + _ADMIN_MIGRATION_GRACE_MS - int(time.time() * 1000)) / 1000,
        )
        await asyncio.sleep(delay_s)

        async with self._room_lock(code):
            room_exists = await redis.exists(f"room:{code}")
            raw = await redis.hget(f"room:{code}:players", player_id)
            if not room_exists or raw is None:
                return  # room dissolved or player already permanently removed
            player = json.loads(raw)
            if player.get("connected", True):
                return  # reconnected within the grace period
            if player.get("disconnected_at") != disconnected_at:
                return  # they reconnected and dropped again — a newer timer owns this
            if await redis.hget(f"room:{code}", "admin_id") != player_id:
                return  # no longer admin for some other reason

            players_raw = await redis.hgetall(f"room:{code}:players")
            candidates = {
                pid: raw for pid, raw in players_raw.items() if pid != player_id
            }
            if not candidates:
                return  # no one left to hand off to

            new_admin = _select_new_admin(candidates)
            await redis.hset(f"room:{code}", "admin_id", new_admin)

        # _broadcast_new_admin_snapshot builds the payload from
        # _build_room_state_payload — the same canonical snapshot handshake
        # uses, so active_game (and practice/tutorial_*) is always included,
        # never the narrower ad-hoc payload that used to blank other
        # clients' "no active game" state on a mid-round migration.
        await self._broadcast_new_admin_snapshot(code, new_admin)

    async def _disconnect_grace_timeout(
        self, code: str, player_id: str, disconnected_at: int
    ) -> None:
        """Permanently removes a player once _DISCONNECT_GRACE_MS has elapsed
        since they disconnected, unless they've since reconnected (`connected`
        flipped back to True by handle_handshake) or disconnected again more
        recently (a newer task owns that `disconnected_at` and will do the
        removal instead — mirrors the staleness-recheck pattern used by
        _summary_timeout/_game_timeout)."""
        delay_s = max(
            0.0,
            (disconnected_at + _DISCONNECT_GRACE_MS - int(time.time() * 1000)) / 1000,
        )
        await asyncio.sleep(delay_s)

        async with self._room_lock(code):
            raw = await redis.hget(f"room:{code}:players", player_id)
            if raw is None:
                return  # already removed (e.g. explicit LEAVE_ROOM)
            player = json.loads(raw)
            if player.get("connected", True):
                return  # reconnected within the grace period
            if player.get("disconnected_at") != disconnected_at:
                return  # superseded by a more recent disconnect's own timer
            await redis.hdel(f"room:{code}:players", player_id)
            self._connections.get(code, {}).pop(player_id, None)

        await self._finalize_departure(code, player_id)


room_service = RoomService()
