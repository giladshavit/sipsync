# CLAUDE.md — SipSync Development Rules

This file is read automatically by Claude Code at the start of every session.

---

## Project Overview

SipSync is a real-time BYOD party drinking game. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

**Working directory layout:**
- `backend/` — Python 3.12 FastAPI app
- `frontend/` — Expo React Native app

---

## Deployment & Environments

**Production (live):**
- Frontend: https://www.quicklegame.com — Vercel project, auto-deploys from `main` (Root Directory=`frontend`, build command `npm run build`, output `dist`).
- Backend: https://backend-production-f4b22.up.railway.app — Railway project `quickle-backend`, auto-deploys from `main` (Root Directory=`backend`, Dockerfile builder). Redis runs as a separate service in the same project.

**Local development still uses `localhost`.** The frontend defaults to `http://localhost:8000` in dev builds (via `__DEV__` in `frontend/constants/api.ts`), overridable with `EXPO_PUBLIC_API_URL` for LAN/physical-device testing. The production URLs above are the already-deployed live app — they don't reflect uncommitted local changes, so use `localhost` for iterating on code, not the production URLs.

Backend CORS allows: `https://quicklegame.com`, `https://www.quicklegame.com`, any `*.vercel.app` origin, and `http://localhost:\d+`.

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

### Icons
- Use **`lucide-react-native`** (SVG-based, built on `react-native-svg`) for all icons — it is the maintained successor of Feather with the same clean line style and a much larger set.
- Import icons as named components: `import { Beer, Skull } from 'lucide-react-native'` → `<Beer size={20} color={...} strokeWidth={2} />`.
- Never use raw emoji as icon substitutes in UI components — no system emoji anywhere in the UI; every glyph comes from Lucide.
- Do not add `@expo/vector-icons` imports in new code; migrate old Feather usages to Lucide when touching a file.

### Typography
- Never use `fontFamily: 'Courier New'` (or any monospace font) for UI text. It was the app's de facto default for small tracked-caps labels for a long time and reads too thin at those sizes — swept out app-wide; don't reintroduce it.
- Use the two shared treatments from `frontend/constants/design.ts`'s `typography` export instead, spread into the `Text` style alongside `color`/`fontSize`/etc.:
  - `typography.title` — a standalone screen/section heading with no bigger heading following it (e.g. a mini-game's own name shown as its in-round eyebrow, like "Prisoner's Dilemma" or "The Sacrifice"). Bold (900), tracked, uppercase.
  - `typography.label` — everything else: supporting stat readouts, kickers above a *different* larger heading, inline data, section sub-headers. Semibold (700), tracked, uppercase.
- Exceptions (deliberate, functional, not oversights): a shared room **code** (`frontend/app/room/[code]/lobby.tsx`) stays monospace — fixed character widths and 1/I/l disambiguation are real wins for a code someone has to read aloud or retype. A live-ticking countdown digit display (`frontend/components/games/CountdownRing.tsx`) uses `fontVariant: ['tabular-nums']` instead of a monospace font — same fixed-digit-width benefit (no jitter as it counts down) without the thin monospace look.

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
