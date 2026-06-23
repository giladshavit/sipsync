# CLAUDE.md — SipSync Development Rules

This file is read automatically by Claude Code at the start of every session.

---

## Project Overview

SipSync is a real-time BYOD party drinking game. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

**Working directory layout:**
- `backend/` — Python 3.12 FastAPI app
- `frontend/` — Expo React Native app

---

## Hard Constraints

### Package Management
- Backend: **`uv` only**. Never use `pip install`, never create `requirements.txt`. All deps go in `pyproject.toml`.
- Frontend: `npm` / `yarn` are fine. Expo managed workflow.

### Architecture Boundaries
- REST endpoints are **strictly limited** to:
  - `POST /rooms` — create room
  - `GET /rooms/{code}` — validate join
- Everything else (game loop, timers, player actions, state broadcast) goes through **WebSocket**.
- Do not add REST endpoints for game actions.

### State
- Redis is the single source of truth for all active room state.
- Do not use in-process Python dicts as a substitute for Redis state — it will break under multiple Uvicorn workers.

### Mini-Game Isolation (Open-Closed)
- Core engine files (`fsm.py`, `deck.py`, `base.py`, `ws.py`) must **never** be modified to support a new mini-game.
- New mini-games extend `BaseMiniGame` in `backend/app/games/` and register a UI component in `GAME_REGISTRY`.

### Animations
- Use `react-native-reanimated` for all animations. Run logic on the **native UI thread** (worklets). Never block the JS thread for visual work.

### Authentication
- Player identity is a `UUID` from `SecureStore`. Treat it as a first-class auth token.
- Do not add login gates. The guest-first model is intentional.

---

## Coding Standards

- Python: follow PEP 8, type-hint everything, use Pydantic models for all request/response shapes.
- TypeScript: strict mode on. No `any` unless genuinely unavoidable and commented.
- No commented-out code in commits.
- Keep functions small and single-purpose.

---

## Git Workflow (Kanban)

We use GitHub Issues + GitHub Projects as a Kanban board.

**Branch naming:**
- Features: `feat/<short-description>`
- Bugs: `fix/<short-description>`
- Chores: `chore/<short-description>`

**Commit style:** conventional commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`

**PR flow:**
1. Open a PR linked to the relevant GitHub Issue.
2. PR title = conventional commit style.
3. Squash-merge into `main`.

---

## Key Architectural Decisions (do not revisit without discussion)

| Decision | Reason |
|---|---|
| Server-as-Judge for reflex timing | Eliminates network latency cheating |
| Clock offset stored per player session | Allows per-client correction without round-trip |
| 6-second drinking window is un-skippable | Core game mechanic — social accountability |
| Smart shuffle (play-once-per-cycle) | Prevents repeat fatigue |
| Guest UUID → OAuth merge path | Zero onboarding friction while preserving future account upgrade |
