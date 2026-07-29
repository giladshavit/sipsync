# SipSync — Project Plan & Rules

---

## Section 1 — Core Instructions

#### 0. THE IRONCLAD NO-REGRESSION MANDATE
**You are strictly forbidden from practicing "Proactive Refactoring".** When assigned a task to implement or refactor Feature X, you will alter *only* the specific lines of code required for Feature X. You will never rewrite working baseline logic, you will never rename existing internal variables, and you will never alter working background tasks (like `_game_timeout`) unless explicitly commanded to do so. If your changes cause a working flow or test to regress, you will revert immediately.

#### 1. Architecture Boundaries
All architectural decisions are documented in [ARCHITECTURE.md](ARCHITECTURE.md). Do not revisit key decisions without explicit discussion.

#### 2. Package Management
- Backend: **`uv` only**. Never use `pip install`. All deps in `pyproject.toml`.
- Frontend: `npm` / `yarn`. Expo managed workflow.

#### 3. State
Redis is the single source of truth. Do not use in-process Python dicts as a substitute.

#### 4. Mini-Game Isolation
Core engine files (`fsm.py`, `deck.py`, `base.py`, `ws.py`) must never be modified to support a new mini-game. New games extend `BaseMiniGame` and register in `GAME_REGISTRY`.

---

## Section 2 — Git Workflow

Branch naming:
- `feature/develop/<description>` — feature branches, always off `develop`
- `fix/develop/<description>` — bug-fix branches

Commit style: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).

PR flow: open PR → link issue → squash-merge into `develop`.

---

## Section 3 — Coding Standards

- Python: PEP 8, type-hint everything, Pydantic for request/response shapes.
- TypeScript: strict mode. No `any` unless unavoidable and commented.
- No commented-out code in commits.
- No multi-line docstrings or comment blocks — one short line max.
- Keep functions small and single-purpose.
