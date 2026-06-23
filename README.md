# SipSync 🥃

> Real-time, BYOD multiplayer party drinking game — no cards, no shared screen, pure phone chaos.

## What is SipSync?

SipSync synchronizes mini-games across every player's phone at a party. A host creates a room, players join by code, and the app runs fast-paced games where the losers drink. The server acts as a neutral judge, correcting for network latency so no one wins by having a better signal.

## Tech Stack

- **Frontend:** React Native (Expo) + `react-native-reanimated`
- **Backend:** Python 3.12 · FastAPI · Uvicorn
- **State:** Redis (rooms, sessions, WebSocket pub/sub)
- **Package manager:** `uv` (no pip, no requirements.txt)

## Getting Started

### Prerequisites

- Node.js 20+ and Expo CLI
- Python 3.12+
- [`uv`](https://github.com/astral-sh/uv) installed
- Redis running locally (`redis-server`)

### Backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npx expo start
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, FSM, reflex protocol, and mini-game contract.

## Contributing & Development Rules

See [CLAUDE.md](CLAUDE.md) for coding standards, constraints, and the AI-assisted workflow rules.

## Game Flow

```
LOBBY → TUTORIAL → PLAYING → PERSONAL_SUMMARY → PODIUM → (next round)
```

Each round: the server pops a game from a shuffled deck, broadcasts the game state to all clients, and runs the live loop over WebSocket. When the game ends, every player sees a 6-second personalized outcome screen before the next round can begin.

## Adding a New Mini-Game

**Server:** Create a class in `backend/app/games/` that inherits `BaseMiniGame` and implements `get_initial_state` and `handle_ws_event`.

**Client:** Import the UI component and add one line to `GAME_REGISTRY` in `frontend/components/ActiveGameScreen.tsx`.

No other files need to change.
