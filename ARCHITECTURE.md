# SipSync — System Architecture

## 1. Overview & Philosophy

SipSync is a real-time, BYOD (Bring Your Own Device) multiplayer party drinking game for in-person social gatherings. Every player uses their own phone; there are no physical cards and no shared central screen.

### The "1 to 100+" Mandate
The architecture enforces a strict separation between the **Room & Deck Engine** and **Mini-Game Payloads**. Adding Game #2 or Game #101 requires **zero modifications** to the core room state machine (Open-Closed Principle).

### Authentication: Guest-First
On first launch, the Expo client generates a `UUID` stored in `SecureStore`. This UUID is a fully valid player identity to the backend. The schema is designed so guest UUIDs can be merged into persistent OAuth profiles (Google/Apple) in future versions without losing XP or scores.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React Native (Expo) + `react-native-reanimated` | Native UI thread for 60FPS animations |
| Backend | Python 3.12+ · FastAPI · Uvicorn | |
| Package manager | `uv` | `pip` and `requirements.txt` are **forbidden** |
| State / Pub-Sub | Redis | Active rooms, player sessions, turn queues, WS channels |
| REST API | FastAPI routes | Room creation (`POST /rooms`) & join validation (`GET /rooms/{code}`) only |
| WebSockets | FastAPI WebSocket | Live game loop, timers, state broadcast, reflex actions |

---

## 3. Finite State Machine (FSM)

Each active Room in Redis is a deterministic FSM:

```
[ LOBBY ] ──▶ [ TUTORIAL ] ──▶ [ PLAYING ] ──▶ [ PERSONAL_SUMMARY ] ──▶ [ PODIUM ]
    ▲                                                                           │
    └──────────────────────── (pop next game from deck) ───────────────────────┘
```

### Smart Shuffle Algorithm

The Room object holds:
- `selected_game_ids` — static array of allowed game IDs (set by Admin in LOBBY)
- `deck` — dynamic runtime queue

**On each round start:**
1. `active_game_id = room.deck.pop()`
2. If `deck` is empty → regenerate: `room.deck = shuffle(room.config.selected_game_ids)`, then pop.

This guarantees every configured mini-game plays **exactly once per cycle** before any game repeats.

---

## 4. Plug-and-Play Mini-Game Contract

### Server — `BaseMiniGame` (ABC)

```python
from abc import ABC, abstractmethod
from typing import Tuple, Dict, Any, List

class BaseMiniGame(ABC):
    game_id: str
    tutorial_type: str   # "timed_text" | "video" | "interactive"
    tutorial_asset: str  # URI or i18n key

    @abstractmethod
    def get_initial_state(self, players: List[dict]) -> Dict[str, Any]:
        """Returns the starting payload broadcast to all clients."""

    @abstractmethod
    def handle_ws_event(
        self, player_id: str, payload: dict, current_state: dict
    ) -> Tuple[dict, bool, Dict[str, dict]]:
        """
        Processes a client action.
        Returns: (updated_game_state, is_finished, outcomes_dict)
        When is_finished == True, the FSM strips outcomes_dict and
        transitions the room to PERSONAL_SUMMARY.
        """
```

### Client — `ActiveGameScreen.tsx` Registry

```typescript
const GAME_REGISTRY: Record<string, React.FC<MiniGameProps>> = {
  red_light_green_light: ReflexGameUI,   // MVP mini-game #1
  // Drop future games here — no other file changes needed.
};
```

---

## 5. Room Join Flows

Two entry paths — both land on the same Lobby screen:

1. **Manual code entry** — player types the 6-char room code on the Home screen. The app calls `GET /rooms/{code}` to validate, then navigates to `/room/{code}/lobby`.
2. **Deep-link auto-join** — Admin taps "Share Invite" in the Lobby, which triggers the native share sheet with `sipsync://room/{code}`. Any player who taps the link is taken directly to the Lobby with no manual input. Configured via `scheme: "sipsync"` in `app.json`; Expo Router handles `sipsync://room/[code]` → `/room/[code]/lobby` automatically.

`POST /rooms` returns `{ code, room_id, share_url }` where `share_url = "sipsync://room/{code}"`.

---

## 6. Millisecond Reflex Protocol (Server-as-Judge)

Handles sub-second reflex games over volatile mobile networks.

### Clock Handshake
1. Client connects via WebSocket and emits `{ local_ts: Date.now() }`.
2. Server calculates `client_clock_offset = server_ts - client_ts` and saves it to the player session.

### Epoch Scheduling
- Server **never** sends a live "do it now" command.
- Server broadcasts a future absolute UTC timestamp:
  ```json
  { "event": "TURN_GREEN", "execute_at": 1718386805000 }
  ```
- Every client schedules the UI change locally → the screen turns green at the **exact same physical millisecond** on every device.

### Network-Agnostic Tap Verification
- Client sends: `{ "action": "tap", "local_ts": 1718386805420 }`
- Server applies `client_clock_offset` to compute ground-truth tap time, eliminating latency advantages.

---

## 6. Outcomes Schema & The Drinking Window

### Outcomes Dict (broadcast by the server on `is_finished == True`)

The server reads each player's cumulative score from Redis, applies `delta_score`, writes the updated value back, and broadcasts `total_score` to all clients:

```json
{
  "outcomes": {
    "uuid_gilad": { "status": "WIN",  "delta_score": 100, "chasers": 0, "total_score": 350 },
    "uuid_tomer": { "status": "LOSE", "delta_score": -50, "chasers": 2, "total_score": 150 },
    "uuid_dan":   { "status": "SAFE", "delta_score": 0,   "chasers": 0, "total_score": 200 }
  }
}
```

**Status values:** `WIN` · `LOSE` · `SAFE`

### The 6-Second Drinking Window

Upon entering `PERSONAL_SUMMARY`, each client renders a **personalized, full-screen banner**:
- **WIN** — green: player name, `+{delta_score} pts`, total score
- **LOSE** — red flash: player name, `{chasers} chasers 🥃`, `-{delta_score} pts`, total score
- **SAFE** — neutral: player name, total score
- All statuses display: `Total: {total_score} pts`

The client **must freeze all navigation** and **block Admin overrides** for exactly **6.0 seconds**.
- This enforces a real-world drinking window that cannot be skipped.

---

## 7. MVP Reference Mini-Game: Red Light Green Light

A synchronized reflex game using the Epoch Scheduling protocol above. All players watch their screen; when it turns green they must tap as fast as possible. The slowest player (or anyone who taps during red) loses and receives chasers proportional to their delay.

---

## 8. Project Directory Structure (target)

```
sipsync/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── routers/
│   │   │   ├── rooms.py         # REST: POST /rooms, GET /rooms/{code}
│   │   │   └── ws.py            # WebSocket game loop
│   │   ├── engine/
│   │   │   ├── fsm.py           # Room FSM transitions
│   │   │   ├── deck.py          # Smart shuffle logic
│   │   │   └── base.py          # BaseMiniGame ABC
│   │   ├── games/
│   │   │   └── red_light_green_light.py
│   │   ├── models/              # Pydantic schemas
│   │   └── redis_client.py
│   └── pyproject.toml           # uv-managed dependencies
└── frontend/
    ├── app/                     # Expo Router screens
    ├── components/
    │   ├── games/
    │   │   └── ReflexGameUI.tsx
    │   └── ActiveGameScreen.tsx # GAME_REGISTRY switcher
    ├── hooks/
    └── package.json
```
