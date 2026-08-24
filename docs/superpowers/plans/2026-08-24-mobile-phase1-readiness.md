# Mobile Phase 1 — Technical Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app store-ready on the technical side: real app icons/splash from the duck mascot, a first-launch 18+ consent stage, a server-authoritative game kill switch, a client compatibility gate with a forced-update screen, OTA updates wired, keep-awake during rounds, and fresh dev builds for both platforms.

**Architecture:** Backend changes are registry/route-level only (`game_loader.py`, `models/room.py`, `routers/rooms.py`, `routers/ws.py`, new `version_gate.py`) — core engine files (`fsm.py`, `deck.py`, `base.py`, `engine/room_service.py` internals) are untouched except where a task names an exact function. Frontend changes split into: generated assets + `app.json` wiring; an onboarding consent stage; a catalog `enabled` flag consumed only by listing screens; a `lib/api.ts` fetch wrapper + socket close-code handling feeding a blocking `update-required` route. EAS Update is configured before the dev builds so the new binaries embed it.

**Tech Stack:** Expo SDK 57 / RN 0.86, expo-router, expo-updates, expo-keep-awake, EAS Build; FastAPI + Redis (fakeredis in tests); Pillow via `uv run --with pillow` for asset generation; Playwright smoke (`npm run verify:web`) as the web gate.

Spec: `docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md` (Phase 1, sections 1.1–1.6). 1.1 (env wiring) and the encryption flag from 1.2 are already done (Phase 0 / PR #124).

## Global Constraints

- Frontend commands run from `frontend/`; backend uses **`uv` only** (`uv run pytest`, never pip). Backend deps live in `pyproject.toml`.
- REST endpoints stay exactly two: `POST /rooms`, `GET /rooms/{code}`. The version gate rides on headers/query params — **no new endpoints**.
- Core engine files must not be modified: `backend/app/engine/{fsm,deck,base}.py`. `routers/ws.py` may only gain the pre-handshake version check; `engine/room_service.py` is not modified at all in this phase.
- Storage keys keep the legacy `sipsync.` prefix (`sipsync.age_confirmed` for the new consent key).
- Never import `expo-router/head` directly — use `@/lib/head`.
- Icons: UI glyphs come from `lucide-react-native` only; no emoji.
- Typography: use `typography.title` / `typography.label` from `frontend/constants/design.ts`; never monospace.
- Gates for every frontend task: `npx tsc --noEmit` clean; `npm run verify:web` 5/5 PASS with zero case-sensitive `WARN` lines. Backend tasks: `uv run pytest` green.
- Exact values: EAS projectId `1e06dfb5-0c89-405a-9c8a-95e43e674320`; Railway URL `https://backend-production-f4b22.up.railway.app`; brand colors cream `#FFF8E1`, dark `#0f172a`; WS close code for the gate `4426`; frontend `CLIENT_VERSION = 1`; backend `MIN_CLIENT_VERSION = 0` at launch (see Task 6 rationale — this deliberately deviates from the spec's `= 1`).
- Commits: conventional style, each with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer. PR body first line `Closes #<issue>`.
- Merge gate (same as Phase 0): Vercel preview smoke 5/5 + production smoke after merge.
- Local dev ports: backend on **8010** (8000 is occupied by an unrelated project); `EXPO_PUBLIC_API_URL=http://localhost:8010` (simulator) or `http://<Mac-LAN-IP>:8010` (phone).

---

### Task 0: Branch + tracking issue

**Files:** none (git/GitHub only)

- [ ] **Step 1: Merge this plan to main first**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git checkout -b chore/mobile-phase1-plan main
git add docs/superpowers/plans/2026-08-24-mobile-phase1-readiness.md
git commit -m "docs: phase 1 (technical readiness) implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin chore/mobile-phase1-plan
ISSUE=$(gh issue create --title "docs: mobile phase 1 plan" --body "Implementation plan for Phase 1 of docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md" | grep -o '[0-9]*$')
gh pr create --title "docs: mobile phase 1 implementation plan" --body "Closes #$ISSUE

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --squash --delete-branch
```

- [ ] **Step 2: Create the Phase 1 issue and execution branch**

```bash
git checkout main && git pull --ff-only origin main
gh issue create --title "feat: mobile phase 1 — assets, consent, kill switch, version gate, OTA" --body "Phase 1 of the mobile store rollout. Plan: docs/superpowers/plans/2026-08-24-mobile-phase1-readiness.md"
# note the number as <ISSUE>
git checkout -b feat/mobile-phase1
```

---

### Task 1: App icons + splash from the duck mascot

**Files:**
- Input (must exist before starting): `frontend/assets/duck-wave-source.png` — the chaser-less waving duck, 2048×2048, cream background, provided by Gilad. **If missing, STOP and report BLOCKED.**
- Create: `frontend/scripts/generate-app-assets.py`
- Create (generated): `frontend/assets/app-icon.png`, `frontend/assets/app-icon-dark.png`, `frontend/assets/app-icon-tinted.png`, `frontend/assets/adaptive-icon.png`, `frontend/assets/adaptive-icon-monochrome.png`, `frontend/assets/splash-icon.png`, `frontend/assets/duck-wave.png`
- Modify: `frontend/app.json` (icon/ios.icon/android.adaptiveIcon/splash plugin)

**Interfaces:**
- Produces: the asset filenames above, referenced verbatim from `app.json`. Task 9's builds embed them.

- [ ] **Step 1: Write `frontend/scripts/generate-app-assets.py`**

```python
"""One-off asset pipeline: derive every store/app icon from the waving duck.

Run:  uv run --with pillow python3 scripts/generate-app-assets.py   (from frontend/)

Source: assets/duck-wave-source.png — 2048x2048, flat cream background,
duck with dark-brown outline, small white Gemini watermark near the
bottom-right corner. The background is OPAQUE (checkerboard-style fake
transparency was already debunked for the avatar sheets — same here).
"""
from pathlib import Path
from PIL import Image, ImageOps

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SRC = ASSETS / "duck-wave-source.png"
CREAM = (255, 248, 225)   # #FFF8E1 — app cream
DARK = (15, 23, 42)       # #0f172a — app dark

src = Image.open(SRC).convert("RGBA")
W, H = src.size
px = src.load()

# --- 1. Erase the watermark: sample the true background color from a corner,
# then repaint every pixel in the bottom-right 20% quadrant whose color is
# near-white (the sparkle) with the sampled background.
bg = px[40, 40][:3]
def near(c, t, tol):
    return all(abs(c[i] - t[i]) <= tol for i in range(3))
for y in range(int(H * 0.80), H):
    for x in range(int(W * 0.80), W):
        r, g, b, a = px[x, y]
        if near((r, g, b), (255, 255, 255), 18):
            px[x, y] = (*bg, 255)

# --- 2. Background removal by edge flood-fill (NOT global chroma-key: the
# duck's eye-whites must survive). BFS from the four corners over pixels
# within tolerance of the sampled background color; everything reached is
# made transparent.
from collections import deque
TOL = 26
visited = bytearray(W * H)
q = deque([(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)])
while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= W or y >= H or visited[y * W + x]:
        continue
    visited[y * W + x] = 1
    c = px[x, y]
    if not near(c[:3], bg, TOL):
        continue
    px[x, y] = (0, 0, 0, 0)
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
duck = src  # RGBA, transparent background, watermark gone

# Tight bbox of the duck for centering
bbox = duck.getbbox()
duck_c = duck.crop(bbox)

def on_canvas(size, bg_rgba, duck_scale):
    """Duck centered on a square canvas at duck_scale of the canvas height."""
    canvas = Image.new("RGBA", (size, size), bg_rgba)
    target_h = int(size * duck_scale)
    ratio = target_h / duck_c.height
    d = duck_c.resize((int(duck_c.width * ratio), target_h), Image.LANCZOS)
    canvas.alpha_composite(d, ((size - d.width) // 2, (size - d.height) // 2))
    return canvas

# --- 3. Outputs
# Cleaned full-frame duck (opaque cream) for web/marketing reuse
on_canvas(1024, (*CREAM, 255), 0.86).convert("RGB").save(ASSETS / "duck-wave.png")
# iOS light icon: opaque, no alpha channel (Apple rejects transparency)
on_canvas(1024, (*CREAM, 255), 0.82).convert("RGB").save(ASSETS / "app-icon.png")
# iOS dark icon: dark bg (Apple composes its own rounding)
on_canvas(1024, (*DARK, 255), 0.82).convert("RGB").save(ASSETS / "app-icon-dark.png")
# iOS tinted icon: grayscale content on TRANSPARENT bg (per Apple spec)
tint = on_canvas(1024, (0, 0, 0, 0), 0.82)
gray = ImageOps.grayscale(tint)
tinted = Image.merge("RGBA", (*[gray] * 3, tint.split()[3]))
tinted.save(ASSETS / "app-icon-tinted.png")
# Android adaptive foreground: transparent, duck inside the 66% safe zone
on_canvas(1024, (0, 0, 0, 0), 0.60).save(ASSETS / "adaptive-icon.png")
# Android 13+ monochrome: solid-white silhouette from the alpha channel
mono_src = on_canvas(1024, (0, 0, 0, 0), 0.60)
alpha = mono_src.split()[3]
white = Image.new("RGBA", mono_src.size, (255, 255, 255, 0))
white.putalpha(alpha)
white.save(ASSETS / "adaptive-icon-monochrome.png")
# Splash: transparent duck, generous margins (plugin scales with `contain`)
on_canvas(1024, (0, 0, 0, 0), 0.55).save(ASSETS / "splash-icon.png")
print("done:", [p.name for p in sorted(ASSETS.glob('app-icon*'))])
```

- [ ] **Step 2: Run it and eyeball every output**

Run: `cd frontend && uv run --with pillow python3 scripts/generate-app-assets.py`
Then open each generated PNG (the Read tool renders images): the duck must be whole (no eaten eye-whites or outline gaps from the flood fill — if the interior got eaten, lower `TOL` and rerun), centered, watermark gone, and `app-icon.png` must have **no alpha**: `uv run --with pillow python3 -c "from PIL import Image; im=Image.open('assets/app-icon.png'); print(im.mode)"` → `RGB`.

- [ ] **Step 3: Wire `app.json`**

Replace the relevant keys (leave everything else untouched):

```json
"icon": "./assets/app-icon.png",
"ios": {
  "supportsTablet": false,
  "bundleIdentifier": "com.quicklegame.app",
  "infoPlist": { "ITSAppUsesNonExemptEncryption": false },
  "icon": {
    "light": "./assets/app-icon.png",
    "dark": "./assets/app-icon-dark.png",
    "tinted": "./assets/app-icon-tinted.png"
  }
},
"android": {
  "adaptiveIcon": {
    "foregroundImage": "./assets/adaptive-icon.png",
    "monochromeImage": "./assets/adaptive-icon-monochrome.png",
    "backgroundColor": "#FFF8E1"
  },
  "package": "com.quicklegame.app",
  "permissions": []
},
```
and the splash plugin entry becomes:
```json
["expo-splash-screen", {
  "image": "./assets/splash-icon.png",
  "imageWidth": 200,
  "backgroundColor": "#FFF8E1",
  "dark": { "backgroundColor": "#0f172a" }
}]
```
(`android.permissions: []` pins the manifest to library-derived permissions only — the earlier eas-cli auto-add of RECORD_AUDIO must not come back.)

- [ ] **Step 4: Verify config + gates**

Run: `npx expo config --type public | grep -E 'icon|splash|foreground|monochrome'` → all paths resolve, no schema errors. Then `npx tsc --noEmit` and `npm run verify:web` → clean / 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-app-assets.py assets/app-icon*.png assets/adaptive-icon*.png assets/splash-icon.png assets/duck-wave.png assets/duck-wave-source.png app.json
git commit -m "feat: app icons, adaptive icon, and splash generated from the duck mascot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: First-launch 18+ consent stage

**Files:**
- Modify: `frontend/app/onboarding.tsx`

**Interfaces:**
- Consumes: `getItemAsync/setItemAsync` from `@/lib/secureStorage`; `colors`, `typography` from `@/constants/design`.
- Produces: storage key `sipsync.age_confirmed` = `'1'`. No other task reads it.

Design: the consent is a stage **inside** onboarding — the single choke point both entry paths (home and join-link `redirectToRoom`) already pass through. Existing onboarded users (web) never see it; every fresh install does. The stage shows before the name/avatar stage whenever the key is absent.

- [ ] **Step 1: Add the consent state + gate to `onboarding.tsx`**

Add to the imports: `Wine`, `ShieldCheck` from `lucide-react-native` (already the icon library), and `getItemAsync, setItemAsync` are already imported via the identity hook file's pattern — import directly: `import * as SecureStore from '@/lib/secureStorage';`

Inside the component, before the existing return:

```tsx
const AGE_KEY = 'sipsync.age_confirmed'; // legacy prefix on purpose — see usePlayerIdentity
const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);

useEffect(() => {
  SecureStore.getItemAsync(AGE_KEY)
    .then((v) => setAgeConfirmed(v === '1'))
    .catch(() => setAgeConfirmed(false));
}, []);

async function handleConfirmAge() {
  try { await SecureStore.setItemAsync(AGE_KEY, '1'); } catch { /* still let them in — storage may be blocked */ }
  setAgeConfirmed(true);
}
```

While `ageConfirmed === null`, render the same centered `ActivityIndicator` pattern used in `app/index.tsx` (spinner on `colors.ink` background). While `ageConfirmed === false`, render the consent stage instead of the name form (same `LinearGradient` backdrop as the existing screen):

```tsx
<View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
  <Text style={{ ...typography.title, color: colors.amber, fontSize: 40, textAlign: 'center' }}>
    Quickle
  </Text>
  <Text style={{ ...typography.label, color: colors.fog, fontSize: 12, textAlign: 'center', marginTop: 8, marginBottom: 28 }}>
    A party game for adults
  </Text>
  <Text style={{ color: colors.chalk, fontSize: 17, lineHeight: 26, textAlign: 'center' }}>
    Quickle is a social party game with drinking-game mechanics, intended for
    players of legal drinking age. It plays just as well with any beverage —
    alcoholic or not.
  </Text>
  <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 16 }}>
    If you drink, drink responsibly. Never drink and drive.
  </Text>
  <Pressable
    onPress={handleConfirmAge}
    style={{ marginTop: 32, backgroundColor: colors.amber, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
  >
    <Text style={{ ...typography.label, color: colors.ink, fontSize: 15 }}>I'm 18 or older — let's play</Text>
  </Pressable>
</View>
```
The exact visual polish (icons, spacing) may follow the screen's existing style; the three text blocks and the button label are the required content. `Platform`/unused imports must not be left dangling.

- [ ] **Step 2: Verify the web smoke anchor survives**

`npm run smoke:web` asserts `Quickle` renders on `/` for a fresh profile — the consent stage's title keeps that true. Run `npx tsc --noEmit` then `npm run verify:web` → clean / 5 PASS.

- [ ] **Step 3: Manual check (web + simulator)**

Web: `EXPO_PUBLIC_API_URL=http://localhost:8010 npx expo start --web`, open an incognito tab → consent shows → confirm → name stage → reload → consent does NOT show again. Simulator: `npm run start:go -- --ios`, wipe state via a fresh onboarding (the simulator may already be onboarded — use the Profile screen's identity or reinstall Expo Go app data; if impractical, the web check plus code review suffices — say which was done).

- [ ] **Step 4: Commit**

```bash
git add app/onboarding.tsx
git commit -m "feat: first-launch 18+ consent stage in onboarding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Game kill switch — backend

**Files:**
- Modify: `backend/app/engine/game_loader.py` (add `DISABLED_GAME_IDS` + `enabled_game_ids()`)
- Modify: `backend/app/models/room.py` (`normalize_game_ids`, `CreateRoomRequest.game_ids` default)
- Test: `backend/tests/test_kill_switch.py`

**Interfaces:**
- Produces: `DISABLED_GAME_IDS: frozenset[str]` and `enabled_game_ids() -> list[str]` in `game_loader.py`. `normalize_game_ids` now silently drops disabled ids and raises only when nothing playable remains (unknown ids still raise).
- `engine/room_service.py` is NOT modified: `handle_set_games` already funnels through `normalize_game_ids`? — it does its own validation via the same helper only if it imports it; **verify**: `grep -n "normalize_game_ids" backend/app/engine/room_service.py`. If SET_GAMES does not use the helper, the only in-scope change is in `models/room.py` and the SET_GAMES call path must be traced and reported (⚠ to the controller) — do not edit room_service.py.

- [ ] **Step 1: Write the failing tests**

```python
"""Game kill switch: DISABLED_GAME_IDS silently drops disabled games at the
two entry points that accept game lists, without touching engine files.
Strategy mirrors test_room_gc.py: no engine, pure model/loader tests plus
monkeypatched DISABLED_GAME_IDS.
"""
import pytest

import app.engine.game_loader as loader
import app.models.room as room_models
from app.models.room import CreateRoomRequest, normalize_game_ids


@pytest.fixture
def disable_reflex(monkeypatch):
    monkeypatch.setattr(loader, "DISABLED_GAME_IDS", frozenset({"reflex"}))


def test_normalize_drops_disabled_silently(disable_reflex):
    assert normalize_game_ids(["reflex", "tap_race"]) == ["tap_race"]


def test_normalize_still_raises_on_unknown(disable_reflex):
    with pytest.raises(ValueError, match="Unknown game_ids"):
        normalize_game_ids(["definitely_not_a_game"])


def test_normalize_raises_when_nothing_playable_remains(disable_reflex):
    with pytest.raises(ValueError, match="at least one enabled game"):
        normalize_game_ids(["reflex"])


def test_create_room_default_excludes_disabled(disable_reflex):
    req = CreateRoomRequest(admin_id="a")
    assert "reflex" not in req.game_ids
    assert "tap_race" in req.game_ids


def test_all_games_enabled_by_default():
    assert loader.DISABLED_GAME_IDS == frozenset()
    assert normalize_game_ids(["reflex"]) == ["reflex"]
```

- [ ] **Step 2: Run to verify failure** — `cd backend && uv run pytest tests/test_kill_switch.py -q` → fails: `DISABLED_GAME_IDS` doesn't exist.

- [ ] **Step 3: Implement**

`game_loader.py`, after `GAME_REGISTRY`:

```python
# Game kill switch: ids listed here vanish from defaults and are silently
# dropped from any client-supplied list (a stale client that still knows a
# disabled game must not be broken by it). Disabling a game = add its id
# here and deploy. Registry-level feature: fsm/deck/base/ws untouched.
DISABLED_GAME_IDS: frozenset[str] = frozenset()


def enabled_game_ids() -> list[str]:
    return [g for g in GAME_REGISTRY if g not in DISABLED_GAME_IDS]
```

`models/room.py` — `normalize_game_ids` becomes (note: read `game_loader.DISABLED_GAME_IDS` via the module attribute so tests can monkeypatch it):

```python
import app.engine.game_loader as game_loader
from app.engine.game_loader import GAME_REGISTRY, enabled_game_ids


def normalize_game_ids(game_ids: list[str]) -> list[str]:
    """Dedupe (order-preserving), validate against the registry, and silently
    drop kill-switched games. Shared by CreateRoomRequest and SET_GAMES."""
    unknown = [g for g in game_ids if g not in GAME_REGISTRY]
    if unknown:
        raise ValueError(f"Unknown game_ids: {unknown}")
    deduped = [g for g in dict.fromkeys(game_ids) if g not in game_loader.DISABLED_GAME_IDS]
    if not deduped:
        raise ValueError("game_ids must contain at least one enabled game")
    return deduped
```
and `CreateRoomRequest.game_ids`'s default becomes `default_factory=enabled_game_ids`.

- [ ] **Step 4: Run all backend tests** — `uv run pytest -q` → everything green (the full suite guards the SET_GAMES path).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine/game_loader.py backend/app/models/room.py backend/tests/test_kill_switch.py
git commit -m "feat: server-authoritative game kill switch (DISABLED_GAME_IDS)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Game kill switch — frontend mirror

**Files:**
- Modify: `frontend/constants/games.ts` (`enabled?: boolean` on `GameMeta`; export `ACTIVE_GAME_CATALOG`)
- Modify: `frontend/app/index.tsx`, `frontend/app/games/index.tsx`, `frontend/components/GamesSheet.tsx`, `frontend/components/HomeWebSections.tsx` (listing surfaces only)

**Interfaces:**
- Produces: `export const ACTIVE_GAME_CATALOG = GAME_CATALOG.filter((g) => g.enabled !== false);`
- Rule: **listing/selection surfaces** use `ACTIVE_GAME_CATALOG`; **lookups by id** (`lobby.tsx`, `podium.tsx`, `games/[id]/*`, `constants/tutorials.ts`) stay on `GAME_CATALOG` so a room that still carries a just-disabled game (or an SEO link to it) renders instead of crashing.

- [ ] **Step 1: Add the flag + export in `games.ts`**

To `GameMeta`, after `accentColor`:
```ts
// Game kill switch mirror of the backend's DISABLED_GAME_IDS: set to false
// to hide a game from the catalog grid, home carousel, and lobby picker.
// Rooms that already contain the game keep rendering it (lookups by id use
// GAME_CATALOG). Web picks this up on deploy; installed apps via OTA.
enabled?: boolean;
```
After the `GAME_CATALOG` array:
```ts
export const ACTIVE_GAME_CATALOG = GAME_CATALOG.filter((g) => g.enabled !== false);
```

- [ ] **Step 2: Swap the four listing surfaces**

In each of `app/index.tsx` (the `gameIds` list sent on Create Room), `app/games/index.tsx` (grid source), `components/GamesSheet.tsx` (`editGames`, `allowedIds` — line ~77 and ~91; `viewPool` stays on `GAME_CATALOG` because it renders the room's actual selection), `components/HomeWebSections.tsx`: replace the `GAME_CATALOG` reference used for listing with `ACTIVE_GAME_CATALOG` (add the import). Verify no by-id lookup was swapped: `grep -n "ACTIVE_GAME_CATALOG" frontend/app frontend/components -r` output must show only these four files.

- [ ] **Step 3: Gates** — `npx tsc --noEmit`; `npm run verify:web` (5 PASS). Then a functional spot check: temporarily set `enabled: false` on `reflex` in the catalog, run `npm run smoke:web` — the `/games/reflex` check still PASSES (detail pages stay reachable) — then **revert the temporary flag** and rerun the smoke (5 PASS, no diff in `git status` beyond the intended files).

- [ ] **Step 4: Commit**

```bash
git add constants/games.ts app/index.tsx app/games/index.tsx components/GamesSheet.tsx components/HomeWebSections.tsx
git commit -m "feat: frontend kill-switch mirror — ACTIVE_GAME_CATALOG for listing surfaces

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: EAS Update (OTA) configuration

**Files:**
- Modify: `frontend/package.json` / lockfile (expo-updates)
- Modify: `frontend/app.json` (`updates.url`, `runtimeVersion`)
- Modify: `frontend/eas.json` (channels)

**Interfaces:**
- Produces: `expo-updates` installed and configured; channels `preview` and `production`. Task 7's update-required screen imports `expo-updates`. Task 9's builds embed the config.

- [ ] **Step 1: Install** — `npx expo install expo-updates` (SDK-57 pin). If it auto-edits `app.json`, keep only what Step 2 specifies and revert the rest (it has previously auto-added plugins).

- [ ] **Step 2: Configure `app.json`** — add at the `expo` top level:

```json
"updates": { "url": "https://u.expo.dev/1e06dfb5-0c89-405a-9c8a-95e43e674320" },
"runtimeVersion": { "policy": "fingerprint" }
```
(`fingerprint` ties OTA compatibility to the actual native fingerprint — correct for CNG; a JS-only change keeps the fingerprint, a native change forks it automatically.)

- [ ] **Step 3: Channels in `eas.json`** — add `"channel": "preview"` to the `preview` profile and `"channel": "production"` to the `production` profile (development profile gets none — dev clients load from Metro).

- [ ] **Step 4: Validate** — `eas config --profile production --platform ios` resolves with the channel and updates URL; `npx expo-doctor` clean; `npx tsc --noEmit`; `npm run verify:web` (expo-updates must not affect web) → 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app.json eas.json
git commit -m "feat: wire EAS Update — fingerprint runtime policy, preview/production channels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Client compatibility gate — backend

**Files:**
- Create: `backend/app/version_gate.py`
- Modify: `backend/app/routers/rooms.py` (router-level dependency)
- Modify: `backend/app/routers/ws.py` (pre-loop check only)
- Test: `backend/tests/test_version_gate.py`

**Interfaces:**
- Produces: `MIN_CLIENT_VERSION: int`, `WS_CLOSE_UPGRADE_REQUIRED = 4426`, `require_client_version` (FastAPI dependency), `ws_client_version_ok(websocket) -> bool`.
- Contract with Task 7: REST reads header `X-Client-Version`; WS reads query param `cv`; sub-minimum REST ⇒ `426` with `{"detail": "upgrade_required", "min_client_version": N}`; sub-minimum WS ⇒ accept then close with code `4426`.
- **Launch value: `MIN_CLIENT_VERSION = 0`** — deliberate deviation from the spec's `= 1`: at `1`, the moment the backend deploys, every already-open web tab (old bundle, no header ⇒ version 0) would be killed mid-room and its old JS has no update screen to land on. At `0` the whole pipeline ships armed but permissive; the first real forced update bumps frontend `CLIENT_VERSION` and backend `MIN_CLIENT_VERSION` together once the deployed web population already sends the header. Update the spec's 1.6 bullet accordingly in this task.

- [ ] **Step 1: Write the failing tests**

```python
"""Client compatibility gate: X-Client-Version on REST, ?cv= on WS.
Uses FastAPI's TestClient against the real app with the router-level
dependency; redis calls in the touched endpoints are patched with
fakeredis per test_room_gc.py's strategy.
"""
import fakeredis
import pytest
from fastapi.testclient import TestClient

import app.routers.rooms as rooms_module
import app.version_gate as vg
from app.main import app


@pytest.fixture(autouse=True)
def patch_redis(monkeypatch):
    r = fakeredis.FakeAsyncRedis(decode_responses=True)
    monkeypatch.setattr(rooms_module, "redis", r)
    return r


@pytest.fixture
def strict_gate(monkeypatch):
    monkeypatch.setattr(vg, "MIN_CLIENT_VERSION", 1)


client = TestClient(app)


def test_get_room_allows_current_version(strict_gate):
    res = client.get("/rooms/NOPE42", headers={"X-Client-Version": "1"})
    assert res.status_code == 200          # gate passed; room simply doesn't exist
    assert res.json()["exists"] is False


def test_missing_header_is_version_zero_and_gated(strict_gate):
    res = client.get("/rooms/NOPE42")
    assert res.status_code == 426
    assert res.json()["detail"]["min_client_version"] == 1


def test_garbage_header_is_gated(strict_gate):
    res = client.get("/rooms/NOPE42", headers={"X-Client-Version": "banana"})
    assert res.status_code == 426


def test_post_rooms_gated(strict_gate):
    res = client.post("/rooms", json={"admin_id": "a"}, headers={"X-Client-Version": "0"})
    assert res.status_code == 426


def test_default_min_is_permissive():
    assert vg.MIN_CLIENT_VERSION == 0
    res = client.get("/rooms/NOPE42")     # no header at all
    assert res.status_code == 200


def test_ws_low_version_closed_with_4426(strict_gate):
    with client.websocket_connect("/ws/ANYCODE?cv=0") as ws:
        # Starlette surfaces the server close on the next receive
        with pytest.raises(Exception) as exc:
            ws.receive_text()
    assert "4426" in str(exc.value) or getattr(exc.value, "code", None) == 4426


def test_ws_current_version_stays_open(strict_gate):
    with client.websocket_connect("/ws/ANYCODE?cv=1") as ws:
        ws.send_text('{"type": "PING"}')   # unknown type: server ignores, connection lives
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_version_gate.py -q` → import error on `app.version_gate`.

- [ ] **Step 3: Implement `backend/app/version_gate.py`**

```python
"""Client compatibility gate (spec 1.6): an integer compatibility number,
independent of marketing versions. Raise MIN_CLIENT_VERSION together with
the frontend's CLIENT_VERSION in the same PR whenever a change would break
older clients (e.g. a new mini-game their bundle can't render).
"""
import sys

from fastapi import HTTPException, Request, WebSocket

MIN_CLIENT_VERSION = 0
WS_CLOSE_UPGRADE_REQUIRED = 4426


def _parse(raw: str | None) -> int:
    try:
        return int(raw or 0)
    except ValueError:
        return 0


async def require_client_version(request: Request) -> None:
    module = sys.modules[__name__]  # read via module so tests can monkeypatch
    if _parse(request.headers.get("X-Client-Version")) < module.MIN_CLIENT_VERSION:
        raise HTTPException(
            status_code=426,
            detail={"detail": "upgrade_required", "min_client_version": module.MIN_CLIENT_VERSION},
        )


def ws_client_version_ok(websocket: WebSocket) -> bool:
    module = sys.modules[__name__]
    return _parse(websocket.query_params.get("cv")) >= module.MIN_CLIENT_VERSION
```
(Adjust the 426 body so `res.json()["detail"]["min_client_version"]` holds — FastAPI wraps `detail` as given.)

`routers/rooms.py`: `router = APIRouter(prefix="/rooms", tags=["rooms"], dependencies=[Depends(require_client_version)])` (+imports).
`routers/ws.py`, immediately after `await websocket.accept()`:

```python
if not ws_client_version_ok(websocket):
    await websocket.close(code=WS_CLOSE_UPGRADE_REQUIRED)
    return
```

- [ ] **Step 4: Run** — `uv run pytest tests/test_version_gate.py -q` then the full `uv run pytest -q` → green. If TestClient's close-code surfacing differs from the test's expectation, fix the ASSERTION to what Starlette actually raises (`WebSocketDisconnect(code=4426)`) — not the implementation.

- [ ] **Step 5: Update spec 1.6** — in `docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md`, change `MIN_CLIENT_VERSION = 1` to `MIN_CLIENT_VERSION = 0 at launch (armed but permissive; first real forced update raises it together with CLIENT_VERSION)`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/version_gate.py backend/app/routers/rooms.py backend/app/routers/ws.py backend/tests/test_version_gate.py docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md
git commit -m "feat: client compatibility gate — 426 on REST, 4426 on WS, armed at MIN=0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Client compatibility gate — frontend

**Files:**
- Create: `frontend/constants/version.ts`
- Create: `frontend/lib/api.ts`
- Create: `frontend/app/update-required.tsx`
- Modify: `frontend/hooks/useRoomSocket.ts` (connect URL + onclose), `frontend/app/index.tsx`, `frontend/components/JoinRoomModal.tsx`, `frontend/app/room/[code]/index.tsx`, `frontend/app/games/[id]/index.tsx` (fetch sites)

**Interfaces:**
- Consumes: Task 6's contract (`X-Client-Version` header, `?cv=`, 426 body, close code 4426) and Task 5's `expo-updates`.
- Produces: `CLIENT_VERSION = 1` (`constants/version.ts`); `apiFetch(path, init?) => Promise<Response>` (`lib/api.ts`) that adds the header and, on 426, navigates to `/update-required` and throws `UpdateRequiredError`.

- [ ] **Step 1: `constants/version.ts`**

```ts
// Compatibility number for the version gate (spec 1.6) — NOT the marketing
// version. Baked into the JS bundle, so an OTA update can raise it. Bump it
// together with the backend's MIN_CLIENT_VERSION in the same PR whenever a
// change breaks older clients (e.g. a new mini-game).
export const CLIENT_VERSION = 1;
```

- [ ] **Step 2: `lib/api.ts`**

```ts
import { router } from 'expo-router';
import { API_BASE } from '@/constants/api';
import { CLIENT_VERSION } from '@/constants/version';

export class UpdateRequiredError extends Error {
  constructor() { super('client below minimum version'); this.name = 'UpdateRequiredError'; }
}

/** fetch() against the backend with the compatibility header; a 426 means
 * this bundle is too old to play — route to the blocking update screen. */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-Client-Version': String(CLIENT_VERSION) },
  });
  if (res.status === 426) {
    router.replace('/update-required');
    throw new UpdateRequiredError();
  }
  return res;
}
```

- [ ] **Step 3: Swap the four fetch sites** — `fetch(\`${API_BASE}/rooms...\`)` → `apiFetch('/rooms...')` in `app/index.tsx` (~line 40), `components/JoinRoomModal.tsx` (~line 27), `app/room/[code]/index.tsx` (~line 30), `app/games/[id]/index.tsx` (~line 291). Existing `catch` blocks already show a generic error — `UpdateRequiredError` arrives after navigation, so the generic message flashing beneath is acceptable. Verify no raw `${API_BASE}/rooms` fetch remains: `grep -rn 'API_BASE}/rooms' frontend/app frontend/components` → no matches.

- [ ] **Step 4: Socket** — in `useRoomSocket.ts`: import `CLIENT_VERSION`; connect with `new WebSocket(\`${WS_BASE}/ws/${code}?cv=${CLIENT_VERSION}\`)` (both the main connect at ~line 188 and the one-shot leave socket at ~line 507); in `ws.onclose`, before the reconnect scheduling:

```ts
ws.onclose = (event: CloseEvent) => {
  if (generationRef.current !== myGeneration) return;
  setIsConnected(false);
  wsRef.current = null;
  if (event.code === 4426) { router.replace('/update-required'); return; } // gate: never reconnect
  if (!unmountedRef.current) {
    reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
  }
};
```

- [ ] **Step 5: `app/update-required.tsx`**

```tsx
import { useState } from 'react';
import { View, Text, Pressable, Platform, ActivityIndicator } from 'react-native';
import * as Updates from 'expo-updates';
import { RefreshCw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Filled in Phase 4 once the store listings exist.
const STORE_URL: string | null = null;

export default function UpdateRequiredScreen() {
  const [busy, setBusy] = useState(false);
  const [otaFailed, setOtaFailed] = useState(false);

  async function handleUpdate() {
    if (Platform.OS === 'web') { window.location.reload(); return; }
    setBusy(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
        return;
      }
      setOtaFailed(true);   // no OTA — a store build is required
    } catch {
      setOtaFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, justifyContent: 'center', paddingHorizontal: 28 }}>
      <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, textAlign: 'center' }}>
        Update required
      </Text>
      <Text style={{ color: colors.chalk, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 16 }}>
        This version of Quickle is too old to join the party. Grab the latest
        one and jump back in.
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.amber} style={{ marginTop: 32 }} />
      ) : (
        <Pressable
          onPress={handleUpdate}
          style={{ marginTop: 32, backgroundColor: colors.amber, borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          <RefreshCw size={18} color={colors.ink} strokeWidth={2.5} />
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 15 }}>
            {Platform.OS === 'web' ? 'Refresh' : 'Update now'}
          </Text>
        </Pressable>
      )}
      {otaFailed && (
        <Text style={{ color: colors.fog, fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          {STORE_URL ? 'Get the update from the store.' : 'A new app version is on its way to the store — check back soon.'}
        </Text>
      )}
    </View>
  );
}
```
Note: `expo-updates` APIs throw in dev/Expo Go — the `catch` covers it; that is acceptable because reaching this screen in dev means a deliberate test.

- [ ] **Step 6: Gates + live proof** — `npx tsc --noEmit`; `npm run verify:web` (5 PASS). Live proof of the whole loop, with the local backend on 8010: edit `backend/app/version_gate.py` to `MIN_CLIENT_VERSION = 999` (do NOT commit), restart the backend, open the web app → creating/joining a room must land on `update-required`; also confirm an in-room WS reconnect lands there (join a room first at MIN=0, then bump + restart). Revert to `0`, restart, confirm normal flow. State in the report that the revert happened (`git status` clean on backend).

- [ ] **Step 7: Commit**

```bash
git add constants/version.ts lib/api.ts app/update-required.tsx hooks/useRoomSocket.ts app/index.tsx components/JoinRoomModal.tsx "app/room/[code]/index.tsx" "app/games/[id]/index.tsx"
git commit -m "feat: version-gate client — apiFetch header, cv query, update-required screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Keep the screen awake inside a room

**Files:**
- Modify: `frontend/package.json`/lockfile (expo-keep-awake, if not already a transitive install)
- Modify: `frontend/app/room/[code]/_layout.tsx`

**Interfaces:** none downstream.

- [ ] **Step 1: Install** — `npx expo install expo-keep-awake` (no-op if the `expo` package already provides it; check `node -e "console.log(require('expo-keep-awake/package.json').version)"` first and skip the install if it resolves).

- [ ] **Step 2: Activate for every room screen** — in `RoomLayout` (`app/room/[code]/_layout.tsx`):

```tsx
import { useKeepAwake } from 'expo-keep-awake';
```
and as the first line of the component body:
```tsx
// A phone that auto-locks mid-round looks like a disconnect to the whole
// room (grace timers, dimmed tiles). Rooms are short-lived; hold the screen
// for the entire room session, lobby included.
useKeepAwake();
```

- [ ] **Step 3: Gates** — `npx tsc --noEmit`; `npm run verify:web` (web build unaffected) → 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json "app/room/[code]/_layout.tsx"
git commit -m "feat: keep the screen awake for the whole room session

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Dev builds for both platforms (with the new native bits)

**Files:** none (EAS only). expo-updates (Task 5) and the new icons/splash (Task 1) are native-affecting — the existing iOS dev build is now stale.

- [ ] **Step 1: iOS rebuild** — `npx eas-cli@latest build --profile development --platform ios --non-interactive --no-wait` (credentials exist from Phase 0; non-interactive now works). Record the build URL.
- [ ] **Step 2: Android first build** — `npx eas-cli@latest build --profile development --platform android --non-interactive --no-wait`. EAS auto-generates the keystore non-interactively on first Android build; if it refuses in non-interactive mode, report the exact message — the controller will have Gilad run it interactively once.
- [ ] **Step 3: Poll both** (`eas build:view <id> --json` every 60s in the background) until FINISHED; on ERRORED, pull the log link and report the failing phase verbatim.
- [ ] **Step 4: Deliverables** — report both artifact URLs. iOS: Gilad reinstalls from the build page (same flow as Phase 0). Android: the APK URL is recorded in the PR body for the future outsourced testers — no device verification in this phase.
- [ ] **Step 5: Simulator sanity with the new binary bits** — `npm run start:go -- --ios` still loads to onboarding (consent stage shows on a fresh profile). No commit (nothing changed).

---

### Task 10: PR, preview gate, merge

**Files:** none (git/GitHub/Vercel only)

- [ ] **Step 1: Push + PR**

```bash
git push -u origin feat/mobile-phase1
gh pr create --title "feat: mobile phase 1 — assets, consent, kill switch, version gate, OTA, keep-awake" --body "Closes #<ISSUE>

Phase 1 of the mobile store rollout (plan: docs/superpowers/plans/2026-08-24-mobile-phase1-readiness.md).

- App icons (light/dark/tinted), Android adaptive+monochrome, splash — generated from the duck mascot
- First-launch 18+ consent stage in onboarding
- Game kill switch: backend DISABLED_GAME_IDS + frontend ACTIVE_GAME_CATALOG
- Client compatibility gate: X-Client-Version / ?cv= / 426 / WS 4426, update-required screen with OTA-first flow (armed at MIN=0)
- EAS Update wired (fingerprint runtime, preview/production channels)
- expo-keep-awake across room screens
- Fresh dev builds: iOS <URL>, Android APK <URL> (device testing outsourced)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Vercel preview** — poll `gh pr checks` until the Vercel check concludes; then `npm run smoke:web -- --url=<PREVIEW>` → 5 PASS. **Backend note:** Railway auto-deploys `main` only — the preview talks to the production backend, which does not yet have the gate/kill-switch code; that is fine because MIN=0 and DISABLED is empty (both features are no-ops until armed). The full-stack behavior was proven locally in Tasks 6–7.
- [ ] **Step 3: Merge** — `gh pr merge --squash --delete-branch`; after Vercel's production deploy is Ready: `npm run smoke:web -- --url=https://www.quicklegame.com` → 5 PASS. Confirm Railway redeployed the backend (its dashboard or `curl -s -o /dev/null -w '%{http_code}' https://backend-production-f4b22.up.railway.app/rooms/NOPE42` → `200`).
- [ ] **Step 4: CLAUDE.md release rule** — on `main`, add to CLAUDE.md's Hard Constraints (commit directly or via a docs micro-PR, matching however the controller has been handling doc-only changes): a short "Release checklist" note — *adding a game or changing client-visible protocol: bump `CLIENT_VERSION` (frontend) + `MIN_CLIENT_VERSION` (backend) in the same PR, and run `eas update --channel production` after merge; disabling a game: add to `DISABLED_GAME_IDS` + set `enabled: false` in `GAME_CATALOG`, deploy + OTA.*

---

## Self-review notes

- Spec coverage: 1.2 → Task 1 (permissions audit folded into its `permissions: []` pin); 1.3 → Tasks 8–9 (device pass itself is Gilad on iPhone + outsourced Android, per his decision); 1.4 → Task 5; 1.5 → Tasks 3–4; 1.6 → Tasks 6–7 (with the documented MIN=0 deviation, spec updated in Task 6 Step 5).
- Ordering: Task 5 (updates) before Task 9 (builds) so binaries embed the OTA config; Task 1 before Task 9 so binaries embed the icons.
- Task 1 is gated on `duck-wave-source.png` landing in `frontend/assets/` (Gilad). Execution may start at Task 2/3 if the file isn't there yet.
- Not in scope: store metadata/screenshots (Phase 3), privacy-policy work (exists at `/privacy`), submit profiles (Phase 2), Sentry.
