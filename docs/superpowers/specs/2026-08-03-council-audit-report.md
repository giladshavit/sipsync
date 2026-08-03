# Council Audit Report

**Scope:** FastAPI backend (`backend/app/`) + Expo React Native web frontend (`frontend/`) + Redis state
**Method:** Direct source audit across three risk categories — concurrency/race conditions, silent failures, client-side state leaks. All findings below are verified against actual file:line references, not inferred.
**Date:** 2026-08-03

---

## 1. Race Conditions & Concurrency

### [CRITICAL] Room mutations are only atomic within a single Uvicorn worker — directly violates CLAUDE.md's own state rule
`backend/app/engine/room_service.py:131-136` guards every state mutation with a process-local `asyncio.Lock` (`self._room_locks: dict[str, asyncio.Lock]`), used at lines 365, 384, 441, 460, 546, 742, 1094, 1153, 1208, 1253 — including `_handle_game_action` (460), the entry point for every player's in-round WebSocket action (taps, votes, answers).

CLAUDE.md is explicit: *"Do not use in-process Python dicts as a substitute for Redis state — it will break under multiple Uvicorn workers."* An `asyncio.Lock` stored in a per-process dict has exactly this failure mode: it only serializes requests landing on the *same* worker process. Under multiple Uvicorn workers (the deployment the pub/sub forwarding architecture at `room_service.py:233-291` was clearly built to support), two players load-balanced onto different workers can:
- Both `hgetall` the same avatar as free during handshake (`room_service.py:552-558`) → both get assigned it, one player's full record (score, `connected` flag) silently clobbers the other's on the second `hset`.
- Both read stale `current_state` in `_handle_game_action` (460-497) → the second write overwrites the first player's recorded answer/tap entirely, with no error to either client.

**Trigger:** Two players on different app instances/workers submit a reflex-timing tap or an answer within the same ~1-tick window. One player's action is silently dropped from game state.

### [CRITICAL] Deck rebuild is a non-atomic delete+rpush with no lock coverage
`room_service.py:498-526` (`_sync_eligible_games`) runs *outside* any `_room_lock` — it's called post-unlock from `handle_handshake` (630-631) and `_finalize_departure` (1066-1068). It reads `current_ids` then calls `deck.initialize` (`deck.py:27-40`), which does `redis.delete(ids_key, deck_key)` followed by two separate `rpush` calls with no `MULTI`/pipeline wrapping.

**Trigger:** Two players join a room within the same event-loop tick right at a game's `MIN_PLAYERS` floor (e.g. `flying_bomb` needs 3, per `eligibility.py:14-20`). Both trigger concurrent deck rebuilds; interleaved delete/rpush pairs can leave `room:{code}:game_ids` and `room:{code}:deck` desynced or duplicated, corrupting the "play-once-per-cycle" smart shuffle guarantee.

### [WARNING] Score double-counting on timeout/action race
`fsm.transition` (`fsm.py:34-44`) is a bare `hget`→`hset` with no WATCH/MULTI/Lua, relying entirely on the caller's (process-local) lock. `_game_timeout` (room_service.py:384-424) and the final action's `_handle_game_action` (460-497) can both read `state == "PLAYING"` before either commits `PERSONAL_SUMMARY`, each independently computing `new_score = old + delta` from its own stale snapshot.

**Trigger:** A round's timer fires at the exact millisecond the last player submits their action, on different workers — that player's score delta gets applied twice.

### [WARNING] Stale-snapshot overwrite on reconnect during scoring
`_enrich_scores_and_broadcast` (room_service.py:293-330) snapshots all players via one `hgetall` (295), then writes each back individually. A concurrent `handle_handshake` reconnect (full-record `hset`, 588-605) landing between the snapshot and the write has its `connected`/`clock_offset` update silently discarded.

**Trigger:** A player's app reconnects (e.g., after backgrounding) in the same instant a round resolves — their reconnect state is overwritten by the stale pre-reconnect copy.

### [NITPICK] GC vs. reconnect ordering in a 2-player room
`handle_disconnect`'s empty-room TTL path (1147-1149, 60s) and a concurrent reconnect's TTL refresh (616-617, 86400s) are unlocked, independent call sequences. Unlucky interleaving in a 2-player room could leave a live room on the short death timer. Narrow window, low real-world likelihood.

---

## 2. Silent Failures

### [CRITICAL] Pub/sub forwarding dies silently on any unexpected exception — and the backend has zero logging
`room_service.py:279-280`: `except Exception: break` inside `_pubsub_listener`, with no logging call anywhere — confirmed by grep: **there is no `logging`/`logger` usage anywhere in `backend/app/`.** Any exception from `pubsub.get_message()` other than the two `TimeoutError` variants explicitly handled above it kills that worker's broadcast-forwarding task for the room *permanently*, with zero trace in any log.

Because the underlying client sockets stay technically open (no `onclose` fires), the frontend's reconnect logic never triggers.

**Trigger:** A brief Redis blip mid-round. Every player pinned to that worker stops receiving `GAME_STATE`/`FSM_TRANSITION`/`OUTCOMES` broadcasts and freezes on whatever screen they're on — indistinguishable from a hang, with nothing in production logs to diagnose it.

### [CRITICAL] No React ErrorBoundary anywhere in the frontend
Confirmed by grep: zero `ErrorBoundary` usage across `frontend/app` and `frontend/components`, including no route-level `ErrorBoundary` export (expo-router's built-in mechanism). A render-time throw in any game screen — e.g. an `undefined` field from a malformed `gameState` in a `*GameUI.tsx` component — has nothing to catch it.

**Trigger:** Any unhandled render exception mid-game. Production behavior is an unmanaged crash/blank screen; the only recovery is a full app restart, losing the player's place in the room.

### [WARNING] No visible "reconnecting" state on most screens
`frontend/hooks/useRoomSocket.ts:359-367` retries reconnection every 1500ms indefinitely, but the resulting `isConnected` flag is only consumed in `summary.tsx` (121, 125) — `lobby.tsx`, `game.tsx`, `waiting.tsx`, and `podium.tsx` never render any offline/reconnecting indicator.

**Trigger:** A player's Wi-Fi drops mid-round on the live game screen. The screen sits static with no visual cue anything is wrong — reads identically to a hang even though the client is actively retrying underneath.

### [WARNING] Practice-room creation failure gives no feedback
`frontend/app/games/[id]/index.tsx:306-310` — the catch block on the practice-room `POST /rooms` call only resets local UI flags (`setSimulating(false)`, etc.) with no error state, unlike the equivalent flow in `app/index.tsx:50-51,74-75` which does set one.

**Trigger:** Tapping "Practice vs Bots" while offline — the spinner flashes, the button silently reverts, and the user has no idea why nothing happened.

### [WARNING] In-round action exceptions kill only the acting player's socket, silently
`_handle_game_action`'s call into `game.handle_ws_event` (room_service.py:470-472) has no try/except of its own, and `backend/app/routers/ws.py:13-62` only catches `WebSocketDisconnect` around the message loop. Not all mini-game handlers guard every payload field — e.g. `games/coin_flip.py:101,103` accesses `current_state["flipper_id"]`/`["clock_offsets"]` unguarded. An exception here isn't caught anywhere — it propagates up and kills that one player's socket, with no error message sent and (per the no-logging finding above) nothing recorded server-side.

**Trigger:** A malformed or edge-case payload for a specific mini-game action drops just that one player's connection mid-round with zero diagnostic trail; they see a disconnect and must rely on blind reconnect logic to recover.

### [WARNING] Identity save failure gives no explanation
`frontend/app/onboarding.tsx:36-46` + `frontend/hooks/usePlayerIdentity.ts:75-87` — `handleContinue`'s `try {...} finally {...}` has no `catch`. If `SecureStore.setItemAsync` throws (e.g. Keychain error), it's an unhandled rejection; the `finally` re-enables the button, but nothing tells the user why "Let's Go" silently did nothing.

### [NITPICK] Unguarded JSON.parse on incoming WS frames
`frontend/hooks/useRoomSocket.ts:199` — a malformed frame throws inside `onmessage` and that one update is silently dropped. Self-heals on the next message in practice; low impact.

### [NITPICK] Combined effect of no logging on otherwise-reasonable swallows
`room_service.py:271, 285` — per-socket send failure and pubsub cleanup swallows are individually defensible (a dead socket shouldn't crash the broadcast loop), but combined with zero backend logging anywhere, any real anomaly here is undebuggable in production. This is really an amplifier on findings above rather than a standalone bug.

---

## 3. Client-Side State Leaks

**Overall assessment: this area is well-engineered.** `frontend/hooks/useRoomSocket.ts` — the central WS hook — uses a generation counter (line 145) so a stale socket's `onopen`/`onmessage`/`onclose` become no-ops after `reconnect()` is called, an `unmountedRef` checked before every state update and reconnect scheduling, and the main effect's cleanup (373-378) sets `unmountedRef.current = true`, clears the reconnect timer, and closes the socket. The `visibilitychange` listener (422-436) is correctly added and removed. All 20+ timer-based mini-game components consistently clear their timers on unmount, including a documented prior fix in `BlackBoxGameUI.tsx:1146-1174`. `AudioContext.tsx`'s async storage read (92-104) is correctly guarded with a `cancelled` flag. No duplicate/zombie WebSocket connections and no missing listener cleanup were found.

### [WARNING] `usePlayerIdentity` has no unmount guard on its async load
`frontend/hooks/usePlayerIdentity.ts:50` — the identity-load effect has no `isMounted` guard, and since the hook is instantiated fresh per-screen (no shared context), rapid FSM-driven navigation (lobby → tutorial → game → summary → podium) can unmount a screen before its `SecureStore`/`localStorage` read resolves, firing setters post-unmount.

**Trigger:** Fast-forwarding through the tutorial screen before it finishes its identity load — a benign React warning today, but a real bug if this hook's data ever gains a side effect beyond local UI state.

### [WARNING] Uncleared copy-toast timeouts, two locations
`frontend/app/room/[code]/lobby.tsx:96` and `frontend/app/room/[code]/podium.tsx:513` — both have a `setTimeout(() => setCopied(false), 1500)` with no cleanup. Since both screens can navigate away on an FSM state change within that window (`lobby.tsx:59-90`), copying the room code or a share link right before the game auto-advances fires a post-unmount `setState`.

**Trigger:** Tap "Copy Code" in the lobby, and the host starts the game within 1.5s — the fired timeout calls `setCopied` on the now-unmounted lobby screen.

No CRITICAL findings in this category.

---

## Summary Table

| # | Category | Finding | Severity |
|---|---|---|---|
| 1 | Concurrency | Per-worker `asyncio.Lock` used as the only guard on Redis read-modify-write across the whole room service | CRITICAL |
| 2 | Concurrency | Non-atomic deck delete+rpush rebuild outside any lock | CRITICAL |
| 3 | Silent Failures | `_pubsub_listener` dies silently on unexpected exceptions; zero logging in the entire backend | CRITICAL |
| 4 | Silent Failures | No React ErrorBoundary anywhere in the frontend | CRITICAL |
| 5 | Concurrency | Score double-counting: timeout vs. last-action race | WARNING |
| 6 | Concurrency | Stale-snapshot overwrite of reconnect state during scoring | WARNING |
| 7 | Silent Failures | No "reconnecting/offline" UI on most screens despite active retry logic | WARNING |
| 8 | Silent Failures | Practice-room creation failure gives no user feedback | WARNING |
| 9 | Silent Failures | Unguarded mini-game payload fields can silently kill one player's socket | WARNING |
| 10 | Silent Failures | Identity save failure (SecureStore) gives no explanation | WARNING |
| 11 | State Leaks | `usePlayerIdentity` async load has no unmount guard | WARNING |
| 12 | State Leaks | Uncleared copy-toast `setTimeout` in lobby + podium | WARNING |
| 13 | Concurrency | GC-TTL vs. reconnect-TTL ordering in a 2-player room | NITPICK |
| 14 | Silent Failures | Unguarded `JSON.parse` on incoming WS frames | NITPICK |
| 15 | Silent Failures | Reasonable-in-isolation swallows amplified by zero logging | NITPICK |

**Headline read:** the two systemic CRITICALs are architectural, not per-line bugs — (a) concurrency correctness rests on a lock that doesn't survive the multi-worker deployment the rest of the system (pub/sub forwarding) was built for, and (b) there is no observability layer at all in the backend, which turns every other silent failure in this report from "debuggable" into "invisible in production." Client-side state hygiene (item 3's category) is the strongest area of the codebase — no fixes needed there beyond the two low-severity timeout leaks.
