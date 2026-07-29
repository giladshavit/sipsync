# Total Drinks Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Total Drinks" cumulative leaderboard tab to the existing "Who's Drinking" popup on the podium screen, ranking players by chasers drunk across the whole room session (not just the current round).

**Architecture:** Persist a `total_chasers` counter per player in the same Redis hash that already tracks cumulative `score`, incremented every time round outcomes are enriched. The counter rides the existing `ROOM_STATE`/`PLAYER_JOINED` broadcast paths (no new WebSocket message types). The frontend's `ChasersPopup` gains a two-tab UI: the existing "current round" view unchanged, plus a new sorted "total drinks" view derived from `snapshot.players[*].total_chasers`.

**Tech Stack:** Python 3.12 / FastAPI / Redis (backend), Expo React Native / TypeScript / react-native-reanimated (frontend), pytest + fakeredis (backend tests). No frontend test runner exists in this repo — frontend tasks are verified manually (final task).

## Global Constraints

- Backend package management: `uv` only — no `pip install`, no `requirements.txt`.
- REST endpoints stay limited to `POST /rooms` and `GET /rooms/{code}` — this feature adds none.
- Redis is the single source of truth for room state — no in-process dict substitutes.
- Do not modify `fsm.py`, `deck.py`, `base.py`, or `ws.py` (mini-game isolation) — not applicable here since this isn't a new mini-game, but keep changes confined to `room_service.py`.
- Use `react-native-reanimated` (worklets) for all animation — never block the JS thread.
- Icons: `lucide-react-native` only, imported as named components (e.g. `import { GlassWater } from 'lucide-react-native'`). No emoji, no `@expo/vector-icons`.
- Typography: use `typography.title` / `typography.label` from `frontend/constants/design.ts` for tracked-caps labels — no monospace fonts.
- TypeScript strict mode — no `any`.
- Python: type-hint everything, PEP 8.
- `total_chasers` accumulates for the whole room session (same lifetime as `score`) — no separate reset logic.
- Reuse the existing `GlassWater` icon for chaser/drink counts (not a new "wine" icon, not `Skull`) — confirmed with the user.
- Top-of-leaderboard accent is a colored border + subtle glow (matching the app's existing tier-1 accent language) — no crown icon.

---

### Task 1: Backend — persist `total_chasers` through handshake

**Files:**
- Modify: `backend/app/engine/room_service.py:349-359` (player record write in `handle_handshake`)
- Modify: `backend/app/engine/room_service.py:421-429` (`PLAYER_JOINED` broadcast in `handle_handshake`)
- Test: `backend/tests/test_total_chasers.py` (new file)

**Interfaces:**
- Consumes: nothing new — `redis.hset`/`redis.hget` on `room:{code}:players`, same as existing `score` field.
- Produces: every player record in `room:{code}:players` now always has a `total_chasers: int` field (default `0`, preserved across reconnects). `PLAYER_JOINED` broadcasts now include `"total_chasers": int`. Task 3 (frontend) consumes this field name verbatim.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_total_chasers.py`:

```python
"""Tests for the cumulative total_chasers counter: persisted per player in
room:{code}:players, initialized/preserved across handshakes, and
accumulated (alongside score) every time a round's outcomes are enriched."""
import json

import fakeredis
import pytest

import app.engine.fsm as fsm_module
import app.engine.room_service as rs_module
from app.engine.avatar_pool import AVATAR_POOL
from app.engine.base import BaseMiniGame
from app.engine.fsm import RoomState

CODE = "TOTCD"
PLAYER_A = "player-a"

_svc = rs_module.room_service


class _FakeWebSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, raw: str) -> None:
        self.sent.append(json.loads(raw))


class _ChaserGame(BaseMiniGame):
    """Finishes on the first action, awarding the acting player 3 chasers
    and 5 points — a minimal stand-in for a real mini-game's outcome shape."""
    game_id = "test_chaser_game"
    tutorial_type = "timed_text"
    tutorial_asset = "test"

    def get_initial_state(self, players: list) -> dict:
        return {"done": False}

    def handle_ws_event(self, player_id: str, payload: dict, current_state: dict) -> tuple:
        return {"done": True}, True, {player_id: {"score_delta": 5, "chasers": 3}}


@pytest.fixture(autouse=True)
def patch_redis_and_broadcast(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rs_module, "redis", r)
    monkeypatch.setattr(fsm_module, "redis", r)

    captured: list[dict] = []

    async def _mock_broadcast(code: str, message: dict) -> None:
        captured.append(message)

    monkeypatch.setattr(_svc, "broadcast", _mock_broadcast)
    monkeypatch.setattr(rs_module, "load_game", lambda _: _ChaserGame())
    monkeypatch.setattr(_svc, "_room_locks", {})
    return r, captured


# ── handle_handshake ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_handshake_initializes_total_chasers_to_zero(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "LOBBY")

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 0


@pytest.mark.asyncio
async def test_handshake_preserves_existing_total_chasers_on_reconnect(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "PLAYING")
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 5, "total_chasers": 7,
        "clock_offset": 0, "avatar": AVATAR_POOL[0],
    }))

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 7


@pytest.mark.asyncio
async def test_handshake_broadcasts_total_chasers_in_player_joined(patch_redis_and_broadcast):
    r, captured = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", "state", "PLAYING")
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 5, "total_chasers": 7,
        "clock_offset": 0, "avatar": AVATAR_POOL[0],
    }))

    await _svc.handle_handshake(CODE, _FakeWebSocket(), {
        "player_id": PLAYER_A,
        "display_name": "Alice",
        "local_ts": 0,
    })

    joined_msgs = [m for m in captured if m["type"] == "PLAYER_JOINED"]
    assert joined_msgs[-1]["total_chasers"] == 7
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_total_chasers.py -v`
Expected: the three handshake tests FAIL with `KeyError: 'total_chasers'` (field doesn't exist yet).

- [ ] **Step 3: Implement the minimal backend change**

In `backend/app/engine/room_service.py`, in `handle_handshake`, update the `redis.hset` call (currently lines 349-359):

```python
            await redis.hset(
                f"room:{code}:players",
                player_id,
                json.dumps({
                    "display_name": display_name,
                    "score": existing.get("score", 0),
                    "total_chasers": existing.get("total_chasers", 0),
                    "clock_offset": clock_offset,
                    "vibe": vibe if vibe is not None else existing.get("vibe"),
                    "avatar": avatar,
                }),
            )
```

Then update the `PLAYER_JOINED` broadcast further down (currently lines 421-429):

```python
        await self.broadcast(code, {
            "type": "PLAYER_JOINED",
            "player_id": player_id,
            "display_name": display_name,
            "score": rejoined.get("score", 0),
            "total_chasers": rejoined.get("total_chasers", 0),
            "clock_offset": rejoined.get("clock_offset", 0),
            "vibe": rejoined.get("vibe"),
            "avatar": rejoined.get("avatar"),
        })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_total_chasers.py -v`
Expected: all three tests PASS.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cd backend && uv run pytest`
Expected: all tests PASS (existing `test_avatar.py` handshake tests are unaffected — they only assert on `avatar`, not the full player blob).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_total_chasers.py
git commit -m "feat: persist total_chasers through room handshake"
```

---

### Task 2: Backend — accumulate `total_chasers` when a round finishes

**Files:**
- Modify: `backend/app/engine/room_service.py:130-142` (`_enrich_scores_and_broadcast`)
- Test: `backend/tests/test_total_chasers.py` (append to the file created in Task 1)

**Interfaces:**
- Consumes: `_ChaserGame` and fixtures defined in Task 1's test file.
- Produces: after any round finishes, `room:{code}:players[pid].total_chasers` increases by that round's `outcome["chasers"]` (default `0` if a mini-game's outcome omits it). The `OUTCOMES` broadcast shape is unchanged (still just `score_delta`/`chasers`/`total_score` plus game-specific fields) — `total_chasers` is never added to it, only to the persisted player record.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_total_chasers.py`:

```python
# ── _enrich_scores_and_broadcast (via _handle_game_action) ──────────────

@pytest.fixture
async def playing_room(patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast
    await r.hset(f"room:{CODE}", mapping={
        "state": RoomState.PLAYING,
        "admin_id": PLAYER_A,
        "active_game": "test_chaser_game",
    })
    await r.hset(f"room:{CODE}:players", PLAYER_A, json.dumps({
        "display_name": "Alice", "score": 10, "total_chasers": 4, "clock_offset": 0,
    }))
    await r.set(f"room:{CODE}:game", json.dumps({"done": False}))
    return r


@pytest.mark.asyncio
async def test_finished_round_accumulates_total_chasers(playing_room, patch_redis_and_broadcast):
    r, _ = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER_A, {})

    stored = json.loads(await r.hget(f"room:{CODE}:players", PLAYER_A))
    assert stored["total_chasers"] == 7  # 4 base + 3 this round
    assert stored["score"] == 15  # 10 base + 5 delta — unaffected by the new field


@pytest.mark.asyncio
async def test_outcomes_broadcast_does_not_expose_total_chasers(playing_room, patch_redis_and_broadcast):
    """total_chasers accumulates silently server-side — the OUTCOMES payload
    (per-round data only) must keep its existing shape."""
    _, captured = patch_redis_and_broadcast

    await _svc._handle_game_action(CODE, PLAYER_A, {})

    outcomes_msgs = [m for m in captured if m["type"] == "OUTCOMES"]
    player_outcome = outcomes_msgs[0]["outcomes"][PLAYER_A]
    assert "total_chasers" not in player_outcome
    assert player_outcome["total_score"] == 15
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_total_chasers.py -v`
Expected: `test_finished_round_accumulates_total_chasers` FAILS with `KeyError: 'total_chasers'` (field not yet accumulated); `test_outcomes_broadcast_does_not_expose_total_chasers` passes trivially (nothing to add yet) — that's fine, it becomes a real regression guard once Step 3 lands.

- [ ] **Step 3: Implement the minimal backend change**

In `backend/app/engine/room_service.py`, replace `_enrich_scores_and_broadcast` (currently lines 130-142):

```python
    async def _enrich_scores_and_broadcast(self, code: str, outcomes: dict) -> None:
        """Update cumulative player scores and total chasers, broadcast OUTCOMES + FSM_TRANSITION."""
        players_raw = await redis.hgetall(f"room:{code}:players")
        players = {pid: json.loads(d) for pid, d in players_raw.items()}
        enriched: dict[str, dict] = {}
        for pid, outcome in outcomes.items():
            player_data = players.get(pid, {})
            delta = outcome.get("score_delta", 0)
            new_score = int(player_data.get("score", 0)) + delta
            player_data["score"] = new_score
            new_total_chasers = int(player_data.get("total_chasers", 0)) + int(outcome.get("chasers", 0))
            player_data["total_chasers"] = new_total_chasers
            await redis.hset(f"room:{code}:players", pid, json.dumps(player_data))
            enriched[pid] = {**outcome, "total_score": new_score}
        await self.broadcast(code, {"type": "OUTCOMES", "outcomes": enriched})
```

(The rest of the method — the `FSM_TRANSITION` broadcast and safety-net task — is unchanged; only the body above the `OUTCOMES` broadcast changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_total_chasers.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `cd backend && uv run pytest`
Expected: all tests PASS — in particular `test_ws_game.py::test_finished_game_outcomes_include_total_score` and `test_finished_game_persists_updated_score` still pass unchanged (their `_CountdownGame` outcome has no `chasers` key, so `total_chasers` simply accumulates by `0` for those tests — harmless).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engine/room_service.py backend/tests/test_total_chasers.py
git commit -m "feat: accumulate total_chasers when a round finishes"
```

---

### Task 3: Frontend — extend `Player` type and `PLAYER_JOINED` handler

**Files:**
- Modify: `frontend/hooks/useRoomSocket.ts:7-17` (`Player` interface)
- Modify: `frontend/hooks/useRoomSocket.ts:181-199` (`PLAYER_JOINED` case)

**Interfaces:**
- Consumes: the `total_chasers` field now present on every player record from the backend (Task 1 + Task 2).
- Produces: `Player.total_chasers: number`, readable via `snapshot.players[pid].total_chasers` anywhere in the app. Task 4 consumes this directly.

- [ ] **Step 1: Extend the `Player` interface**

In `frontend/hooks/useRoomSocket.ts`, update the interface (currently lines 7-17):

```typescript
export interface Player {
  display_name: string;
  score: number;
  /** Cumulative chasers this player has drunk across the whole room session. */
  total_chasers: number;
  clock_offset: number;
  /** Key into VIBE_ICONS — the icon the player picked at onboarding. */
  vibe?: string | null;
  /** This room's visual identifier for the player — a key into
   * AVATAR_IMAGES, server-assigned, unique per room, swappable by the
   * player themself. */
  avatar?: string | null;
}
```

- [ ] **Step 2: Populate it in the `PLAYER_JOINED` handler**

Update the `PLAYER_JOINED` case (currently lines 181-199):

```typescript
          case 'PLAYER_JOINED':
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    players: {
                      ...prev.players,
                      [msg.player_id]: {
                        display_name: msg.display_name,
                        score: msg.score ?? 0,
                        total_chasers: msg.total_chasers ?? 0,
                        clock_offset: msg.clock_offset ?? 0,
                        vibe: msg.vibe ?? null,
                        avatar: msg.avatar ?? null,
                      },
                    },
                  }
                : prev,
            );
            break;
```

(The `ROOM_STATE` case at line 157, `players: msg.players ?? {}`, needs no change — it already spreads the full server player object, and `total_chasers` rides along automatically now that the backend sends it.)

- [ ] **Step 3: Verify the frontend still typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (No frontend test runner exists in this repo — this is a compile-only check; full behavioral verification happens manually in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add frontend/hooks/useRoomSocket.ts
git commit -m "feat: surface total_chasers on the Player type"
```

---

### Task 4: Frontend — `ChasersPopup` tabs, Total Drinks leaderboard, smooth resize

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx:164-295` (`ChasersPopup` component)
- Modify: `frontend/app/room/[code]/podium.tsx:314-321` (add a `totalDrinkRows` derivation next to the existing `chasersRows`)
- Modify: `frontend/app/room/[code]/podium.tsx:454` (widen the header reopen button's visibility condition)
- Modify: `frontend/app/room/[code]/podium.tsx:652-654` (pass the new prop at the call site)

**Interfaces:**
- Consumes: `ChaserRow` (existing, unchanged), `snapshot.players[pid].total_chasers` (Task 3), `AvatarCircle` from `@/components/games/SharedChaserDistributor`, `AVATAR_COLORS` from `@/constants/avatars`, `LinearTransition` from `react-native-reanimated` (already imported in this file), `typography` from `@/constants/design` (already imported).
- Produces: nothing consumed by later tasks — this is the final UI surface.

- [ ] **Step 1: Add the `TotalDrinkRow` type and derive `totalDrinkRows` in `PodiumScreen`**

In `frontend/app/room/[code]/podium.tsx`, add this type near the existing `ChaserRow` interface (currently line 171):

```typescript
interface ChaserRow { pid: string; name: string; avatar: string | null; chasers: number }
interface TotalDrinkRow { pid: string; name: string; avatar: string | null; total: number }
```

Then, in `PodiumScreen`, immediately after the existing `chasersRows` derivation (currently lines 314-321), add:

```typescript
  // Room-lifetime total, sorted descending — the "Total Drinks" tab of the
  // same popup. Ties keep Object.entries' insertion order, so the first
  // row after sorting is unambiguous (that's who gets the top-of-list accent).
  const totalDrinkRows: TotalDrinkRow[] = Object.entries(snapshot?.players ?? {})
    .map(([pid, p]) => ({
      pid,
      name: p.display_name,
      avatar: p.avatar ?? null,
      total: p.total_chasers ?? 0,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);
```

- [ ] **Step 2: Rewrite `ChasersPopup` with the tab bar and both tabs**

Replace the entire `ChasersPopup` function (currently lines 173-295) with:

```typescript
function ChasersPopup({
  rows, totalRows, onDismiss,
}: { rows: ChaserRow[]; totalRows: TotalDrinkRow[]; onDismiss: () => void }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);
  const [tab, setTab] = useState<'ROUND' | 'TOTAL'>('ROUND');

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    scale.value = withSequence(
      withTiming(1.04, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 130 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          // Opaque enough that whatever happens to be behind it (which row
          // is highlighted as "you" differs per viewer) never shows through
          // and makes the popup look inconsistent from player to player.
          backgroundColor: 'rgba(10,10,15,0.94)',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
        },
        overlayStyle,
      ]}
    >
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onDismiss}
      />
      <Animated.View
        style={[
          {
            backgroundColor: CARD,
            borderWidth: 2,
            borderColor: INK,
            width: 300,
            maxWidth: '86%',
            paddingVertical: 24,
            paddingHorizontal: 22,
            // Belt-and-suspenders: whatever the cause of a child rendering
            // wider/taller than this box on a given platform, nothing should
            // ever be able to visually poke out past the card's own fill —
            // that's what exposes the dark scrim behind it as an ugly gap.
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Text
          style={{
            ...typography.label,
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 4,
            textAlign: 'center',
          }}
        >
          {tab === 'ROUND' ? 'This round' : 'All night'}
        </Text>
        <Text
          style={{
            fontWeight: '900',
            color: INK,
            fontSize: 24,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginBottom: 18,
          }}
        >
          Who&apos;s Drinking
        </Text>

        {/* Tab bar — switches the list below between this round's chasers
            and the room-lifetime total, without closing the popup. */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {(['ROUND', 'TOTAL'] as const).map((key) => {
            const selected = tab === key;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  alignItems: 'center',
                  backgroundColor: selected ? AMBER : BG,
                  borderWidth: 1.5,
                  borderColor: selected ? AMBER : HAIRLINE,
                }}
              >
                <Text
                  style={{
                    ...typography.label,
                    fontSize: 10,
                    color: selected ? INK : MUTED,
                  }}
                >
                  {key === 'ROUND' ? 'Current Round' : 'Total Drinks'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* layout={LinearTransition} makes the card resize smoothly when the
            two tabs' row counts differ, instead of snapping to the new
            height. */}
        <Animated.View layout={LinearTransition.duration(260)} style={{ gap: 10 }}>
          {tab === 'ROUND' &&
            rows.map((row) => (
              <View
                key={row.pid}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  backgroundColor: BG,
                  borderWidth: 1,
                  borderColor: HAIRLINE,
                  gap: 10,
                }}
              >
                <AvatarCircle
                  name={row.name}
                  avatar={row.avatar}
                  size={30}
                  ringColor={row.avatar ? AVATAR_COLORS[row.avatar] : STOP}
                />
                <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 15, fontWeight: '700' }}>
                  {row.name}
                </Text>
                <GlassWater size={16} color={STOP} strokeWidth={2.5} style={{ marginRight: 6 }} />
                <Text style={{ color: STOP, fontSize: 15, fontWeight: '800' }}>{row.chasers}</Text>
              </View>
            ))}

          {tab === 'TOTAL' && totalRows.length === 0 && (
            <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 8 }}>
              Nobody&apos;s had a drink yet.
            </Text>
          )}

          {tab === 'TOTAL' &&
            totalRows.map((row, index) => {
              const isTop = index === 0;
              return (
                <View
                  key={row.pid}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    backgroundColor: BG,
                    borderWidth: isTop ? 2 : 1,
                    borderColor: isTop ? AMBER : HAIRLINE,
                    shadowColor: isTop ? AMBER : 'transparent',
                    shadowOpacity: isTop ? 0.45 : 0,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: isTop ? 4 : 0,
                    gap: 10,
                  }}
                >
                  <AvatarCircle
                    name={row.name}
                    avatar={row.avatar}
                    size={30}
                    ringColor={row.avatar ? AVATAR_COLORS[row.avatar] : STOP}
                  />
                  <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 15, fontWeight: '700' }}>
                    {row.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ color: STOP, fontSize: 16, fontWeight: '900' }}>x{row.total}</Text>
                    <GlassWater size={16} color={STOP} strokeWidth={2.5} />
                  </View>
                </View>
              );
            })}
        </Animated.View>

        <Pressable
          onPress={onDismiss}
          style={{ marginTop: 20, backgroundColor: AMBER, paddingVertical: 13, alignItems: 'center' }}
          className="active:opacity-80"
        >
          <Text className="text-ink text-sm font-bold tracking-[0.15em] uppercase">Got it</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
```

- [ ] **Step 3: Pass the new prop at the call site**

In `frontend/app/room/[code]/podium.tsx`, update the render call (currently lines 652-654):

```typescript
      {showChasers && (
        <ChasersPopup rows={chasersRows} totalRows={totalDrinkRows} onDismiss={() => setShowChasers(false)} />
      )}
```

- [ ] **Step 4: Widen the header reopen button so Total Drinks stays reachable**

The header's reopen button (currently line 454, `{chasersRows.length > 0 && (...)}`) is gated on this-round chasers only. That means on any round where nobody drinks (`chasersRows` empty) but earlier rounds already have total-drinks data, there'd be no way to reopen the popup at all to check the `TOTAL DRINKS` tab. Widen the gate:

```typescript
          {(chasersRows.length > 0 || totalDrinkRows.length > 0) && (
            <Pressable
              onPress={() => setShowChasers(true)}
              style={{ borderWidth: 1.5, borderColor: INK, padding: 8 }}
              className="active:opacity-60"
            >
              <GlassWater size={18} color={INK} strokeWidth={2} />
            </Pressable>
          )}
```

Leave the *auto-open* `useEffect` (around line 330, gated on `chasersRows.length === 0`) unchanged — auto-popping the popup is specifically the "here's what you owe this round" reveal, and should stay tied to this round's chasers, not the lifetime total.

- [ ] **Step 5: Verify the frontend still typechecks**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "feat: add Total Drinks tab to the Who's Drinking popup"
```

---

### Task 5: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** N/A.

- [ ] **Step 1: Start Redis and the backend**

Run: `redis-server` (if not already running), then in a separate terminal `cd backend && uv sync && uv run uvicorn app.main:app --reload` (per this repo's README).

- [ ] **Step 2: Start the frontend**

Run: `cd frontend && npm install && npx expo start` and open the app (simulator, device, or web).

- [ ] **Step 3: Play at least two rounds across two different mini-games**

Create/join a room with 2+ players (bots are fine), play a round of one mini-game where at least one player drinks, then play a round of a *different* mini-game where at least one player drinks (confirms accumulation works across game types, not just within one).

- [ ] **Step 4: Open the popup and check "Current Round"**

On the podium screen, open (or wait for the auto-shown) "Who's Drinking" popup. Confirm the `CURRENT ROUND` tab is selected by default and behaves exactly as before this change (same rows, same styling).

- [ ] **Step 5: Switch to "Total Drinks" and verify correctness**

Tap the `TOTAL DRINKS` tab. Confirm:
- Rows are sorted descending by total chasers.
- The top row has the amber border + glow accent.
- Each row shows the avatar, name, `x{N}` multiplier, and one `GlassWater` icon.
- The numbers match the sum of chasers across both rounds played in Step 3.

- [ ] **Step 6: Verify the empty state and the widened reopen button**

In a fresh room, play one round where nobody drinks anything (`chasersRows` empty) — confirm the popup does not auto-open (unchanged behavior) and, since `totalDrinkRows` is also still empty at this point, the header reopen button is not shown either. Then play a round where someone does drink, dismiss the popup, then play a further round where nobody drinks: confirm the header reopen button is now visible (because `totalDrinkRows` is non-empty from the earlier round even though this round's `chasersRows` is empty), and that opening it and switching to `TOTAL DRINKS` shows the correct accumulated rows instead of "Nobody's had a drink yet."

- [ ] **Step 7: Verify the height transition**

With `CURRENT ROUND` and `TOTAL DRINKS` showing different numbers of rows (e.g. one player drank this round but three have drunk across the session), switch between tabs a few times and confirm the popup card resizes smoothly (no snap, no clipped/overflowing content).

- [ ] **Step 8: Report results**

If everything above passes, the feature is complete. If anything fails, note the exact repro steps and fix before considering this plan done — do not commit a fix without re-running the affected manual steps.
