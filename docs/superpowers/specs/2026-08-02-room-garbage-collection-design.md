# Room Garbage Collection — Design

## Problem

Redis is the single source of truth for room state, but not every room-scoped
key is guaranteed to be cleaned up. Two gaps exist today:

1. **Keys with no TTL at all.** `POST /rooms` sets a TTL only on the
   `room:{code}` hash, and only *after* it's created — `room:{code}:deck`,
   `room:{code}:game_ids`, `room:{code}:admin_game_ids`, and any practice-bot
   entries in `room:{code}:players` are written with no expiry. If
   `room:{code}` itself expires (24h) or the room is abandoned before anyone
   connects over WebSocket, these keys live forever.
2. **Explicit teardown relies on one code path succeeding.** Room cleanup
   today happens via explicit `DEL` calls in `handle_end_night` and in
   `_finalize_departure`'s "host left an empty room" branch — the latter only
   fires when the *departing* player happens to be `admin_id`. Both call
   sites also already omit `room:{code}:asked_questions`, so that key leaks
   on every teardown regardless of this task. If the explicit path is skipped
   (crash, race, an edge case in admin reassignment), nothing else reclaims
   the room.

This is a "ghost room" memory leak: rooms nobody is in, and nobody will ever
reconnect to, can accumulate in Redis indefinitely.

## Non-goals / hard constraint

This task does **not** touch per-player disconnect handling. The existing
60-second per-player grace period (`_DISCONNECT_GRACE_MS`,
`_disconnect_grace_timeout`) and 10-second admin migration grace
(`_ADMIN_MIGRATION_GRACE_MS`, `_admin_migration_timeout`) are unchanged —
they govern an individual player's score/avatar/seat, which is a separate
concern from the room's own Redis footprint. `fsm.py`, `deck.py`, and
`base.py` are not modified.

## Design

### 1. Canonical room-key list

A single helper in `room_service.py`, used everywhere a room's Redis
footprint needs to be listed (TTL refresh, TTL grace-period, and both
existing explicit-delete call sites):

```python
def _room_redis_keys(code: str) -> tuple[str, ...]:
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
```

`handle_end_night` and `_finalize_departure`'s empty-room cleanup both switch
to this list (fixing the pre-existing `asked_questions` leak as a side
effect). `EXPIRE`/`DEL` on a key that doesn't exist yet (e.g.
`asked_questions` before any custom question round) is a documented Redis
no-op, so calling this unconditionally is safe.

### 2. TTL policy

```python
_ACTIVE_ROOM_TTL_SECONDS = 86_400   # 24h, unchanged from today's normal-room value
_PRACTICE_ROOM_TTL_SECONDS = 1_800  # 30 min, unchanged from today's practice-room value
_EMPTY_ROOM_TTL_SECONDS = 60        # grace period once every connection drops
```

Two helpers:

- `_refresh_room_ttl(code)` — reads the room's `practice` field, picks
  `_ACTIVE_ROOM_TTL_SECONDS` or `_PRACTICE_ROOM_TTL_SECONDS`, pipelines
  `EXPIRE` across every key from `_room_redis_keys`. Practice rooms keep
  their existing 30-minute ceiling even while actively connected — this
  refresh keeps a *live* practice session from expiring mid-play, but never
  promotes it to the 24h normal-room lifetime.
- `_apply_empty_room_ttl(code)` — same pipeline, fixed `60`.

### 3. Connection counting

A new Redis key, `room:{code}:conn_count`, is the cross-worker source of
truth for "is anyone connected to this room right now" — not
`self._connections`, which is per-process only (see CLAUDE.md's constraint
against in-process dicts standing in for Redis state under multiple Uvicorn
workers).

- **Increment:** in `handle_handshake`, at the same point
  `self._connections[code][player_id]` is registered — `INCR
  room:{code}:conn_count`, then `_refresh_room_ttl(code)`.
- **Decrement:** at the two exact points a player is actually removed from
  `self._connections` — inside `handle_disconnect`'s existing
  identity-checked branch (`room_conns.get(player_id) is websocket`), and
  inside `handle_leave`. This mirrors the existing screen-transition race
  guard: a reconnect whose new HANDSHAKE lands before the old socket's close
  is detected already skips incrementing/decrementing twice today via that
  same identity check, so conn_count stays paired correctly.
- If a `DECR` result is `<= 0`, call `_apply_empty_room_ttl(code)`.

This is purely additive bookkeeping — no changes to what `handle_disconnect`
or `handle_leave` do for the player's own record.

### 4. Room creation

`rooms.py`'s `create_room` currently calls `redis.expire(key, ...)`
immediately after creating `room:{code}`, before `deck.initialize`,
`admin_game_ids`, or practice-bot `players` entries are written — so those
have always been created with no TTL. The TTL step moves to the end of
`create_room`, after every key exists, and calls `_refresh_room_ttl(code)`
(imported from `room_service`) instead of its own inline `redis.expire`,
removing the duplicated `_ROOM_TTL_SECONDS` / `_PRACTICE_TTL_SECONDS`
constants from `rooms.py` in favor of the single definitions in
`room_service.py`.

## Data flow summary

| Event | conn_count | Room key TTL |
|---|---|---|
| `POST /rooms` | n/a | 24h (or 1800s practice) |
| Player HANDSHAKE (join or reconnect) | `+1` | reset to 24h (or 1800s practice) |
| Player disconnect / LEAVE_ROOM, others still connected | `-1` (> 0) | unchanged |
| Player disconnect / LEAVE_ROOM, was last connection | `-1` (= 0) | set to 60s |
| Reconnect within the 60s window | `+1` | restored to 24h (or 1800s practice) |
| No reconnect within 60s | — | Redis deletes all room keys natively |
| `END_NIGHT` / host-leaves-empty-room | — | explicit `DEL` via `_room_redis_keys`, immediate |

## Testing

- Unit test `_room_redis_keys` returns the full fixed set.
- Unit test `_refresh_room_ttl` picks 86400 for normal rooms, 1800 for
  practice rooms, and touches every key.
- Integration-style test against a real/fakeredis instance: create a room,
  connect one player, assert TTL is 24h/1800s on all keys; disconnect,
  assert TTL flips to 60s on all keys; reconnect within the window, assert
  TTL is restored; disconnect and let 60s elapse (or manually expire),
  assert keys are gone.
- Regression test: `handle_end_night` and the empty-room cleanup path in
  `_finalize_departure` now also delete `room:{code}:asked_questions` and
  `room:{code}:conn_count`.
