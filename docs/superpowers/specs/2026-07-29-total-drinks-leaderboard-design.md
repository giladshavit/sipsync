# Total Drinks Leaderboard — Design

## Summary

Add a "Total Drinks" cumulative leaderboard to the existing "Who's Drinking" popup shown on the podium screen (`ChasersPopup` in `frontend/app/room/[code]/podium.tsx`). A new tab bar lets the room switch between the popup's current behavior (this round's chasers) and a new sorted, room-lifetime view of total chasers drunk per player.

## Scope

- Backend: persist a per-player `total_chasers` counter in Redis, alongside the existing `score` field, updated every time round outcomes are enriched.
- Frontend: surface that counter through the existing snapshot/player data path, and add a tabbed UI to `ChasersPopup`.
- Out of scope: any new REST endpoint (none needed — this rides the existing WebSocket/Redis path), any change to per-round outcome computation in individual mini-games, any change to the podium's own points-based ranking (`score`), any new icon system.

## Backend changes

`backend/app/engine/room_service.py`:

1. **`handle_handshake`** (player record write, ~line 349-359): add `"total_chasers": existing.get("total_chasers", 0)` to the JSON blob written to `room:{code}:players`, so the field survives reconnects the same way `score` does.
2. **`_enrich_scores_and_broadcast`** (~line 130-146): for each outcome, alongside the existing `score` accumulation, do:
   ```python
   new_total_chasers = int(player_data.get("total_chasers", 0)) + int(outcome.get("chasers", 0))
   player_data["total_chasers"] = new_total_chasers
   ```
   and persist it in the same `redis.hset` call that already persists `score`. `outcome["chasers"]` is already guaranteed present on every mini-game's outcome dict (per `BaseMiniGame` interface).
3. **PLAYER_JOINED broadcast** (~line 421-429): add `"total_chasers": rejoined.get("total_chasers", 0)` to the broadcast payload, mirroring how `score` is echoed there.

No change needed to the `ROOM_STATE` handshake response — it already serializes the full player JSON blob as-is (`players = {pid: json.loads(d) for pid, d in players_raw.items()}`), so `total_chasers` flows through automatically once present in Redis.

**Lifetime:** `total_chasers` accumulates for the entire room session, exactly like `score` — no separate reset logic needed; it inherits the existing per-room Redis key lifecycle (cleared only when the room itself is dissolved/reset).

**Constraint check:** this only touches `room_service.py`, not `fsm.py`/`deck.py`/`base.py`/`ws.py` — consistent with CLAUDE.md's mini-game isolation rule (which doesn't apply here anyway, since this isn't a new mini-game). No REST endpoints added, in line with the REST allowlist.

## Frontend changes

`frontend/hooks/useRoomSocket.ts`:

- `Player` interface: add `total_chasers: number`.
- `PLAYER_JOINED` case: add `total_chasers: msg.total_chasers ?? 0` to the constructed player object (the `ROOM_STATE` case needs no change — it already spreads `msg.players` wholesale, and the new field rides along).

`frontend/app/room/[code]/podium.tsx` (`ChasersPopup`):

- Add local state `const [tab, setTab] = useState<'ROUND' | 'TOTAL'>('ROUND')`. Reset to `'ROUND'` whenever the popup transitions from closed to open (existing `showChasers` open/dismiss flow), so it never opens back up mid-scroll on the wrong tab from a prior round.
- **Tab bar**: a two-segment pill control rendered directly under the "Who's Drinking" title, before the row list. Visual language matches the popup's existing light/cream "front door" palette (`CARD`, `INK`, `AMBER`, `HAIRLINE`, `typography.label`) rather than the dark in-round palette:
  - Segment labels: `CURRENT ROUND` / `TOTAL DRINKS`.
  - Selected segment: `AMBER` fill, `INK` text.
  - Unselected segment: transparent/`BG` fill, `MUTED` text, `HAIRLINE` border.
- **`CURRENT ROUND` tab**: unchanged — renders the existing `rows` prop (`ChaserRow[]`) exactly as today.
- **`TOTAL DRINKS` tab**: a new derived list, computed from `snapshot?.players`:
  ```ts
  const totalRows = Object.entries(snapshot?.players ?? {})
    .map(([pid, p]) => ({ pid, name: p.display_name, avatar: p.avatar ?? null, total: p.total_chasers ?? 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  ```
  Each row: `AvatarCircle` (room-scoped avatar, same component/props as the current-round rows) — name (`flex: 1`, truncated) — right-aligned bold `x{total}` text — one filled `GlassWater` icon immediately after it (same icon already used for chasers throughout the app; explicitly not a new "wine"-style icon, and not `Skull`).
  - **Top-row accent**: the row at `index === 0` (post-sort — ties keep stable order, first row wins) gets an `AMBER` border (replacing the default `HAIRLINE`) plus a subtle `shadowColor: AMBER` glow, matching the existing tier-1 accent language used elsewhere in this same screen (podium bars) and file (`RoundResultCard.tsx`'s amber crown badge tone). No crown icon — border/glow only, per approved design.
  - Empty state (no one has drunk anything yet this session): render the same "no rows" affordance style as the current-round tab would need if `rows` were empty (currently this can't happen for `ROUND` since the popup only opens when `rows.length > 0`, but `TOTAL` can legitimately be empty on an early round) — a simple centered muted text line, e.g. "Nobody's had a drink yet."
- **Smooth height transition**: wrap the row-list container in `Animated.View` with `layout={LinearTransition}` (already imported in this file from `react-native-reanimated` and used for the podium's own reorder animation), so switching tabs — where `TOTAL DRINKS` may have more or fewer rows than `CURRENT ROUND` — resizes the popup card smoothly rather than snapping.

## Data flow recap

1. Round resolves → mini-game returns `outcomes` with `chasers` per player → `_enrich_scores_and_broadcast` bumps both `score` and `total_chasers` in Redis, broadcasts `OUTCOMES` (unchanged shape) + `FSM_TRANSITION`.
2. Client navigates `game → summary → podium` (existing flow); `podium.tsx`'s `useRoomSocket` hook opens a fresh WebSocket connection, sends `HANDSHAKE`, receives `ROOM_STATE` with each player's current `score` and `total_chasers` straight from Redis.
3. `ChasersPopup` renders `CURRENT ROUND` from the route-param `outcomes` (this round only, unchanged) or `TOTAL DRINKS` from `snapshot.players[*].total_chasers` (room-lifetime), depending on the selected tab.

## Testing

No automated test suite exists for this popup (manually-verified RN/Expo UI throughout the codebase). Verification: run the app, play at least two rounds across two different mini-games (to confirm accumulation across game types, not just within one), open the popup, confirm:
- `CURRENT ROUND` behaves exactly as before.
- `TOTAL DRINKS` shows correct sums, correct descending sort, correct top-row accent, and a sensible empty state before anyone has drunk.
- Switching tabs mid-open resizes the card smoothly with no layout snap or clipped content.
