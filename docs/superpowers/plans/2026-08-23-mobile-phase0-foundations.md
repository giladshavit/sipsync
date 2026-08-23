# Mobile Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Expo app from "web-only on SDK 52" to "store-submittable foundations": correct bundle identity, Expo SDK 57, and a working EAS project — with the live web app verified unbroken at every step.

**Architecture:** Three independent changes on one branch, ordered by risk: (1) a web smoke harness so every later step has an objective pass/fail; (2) the one-time bundle-identity rename; (3) the SDK upgrade done one SDK hop at a time (52→53→54→55→56→57), each hop verified and committed separately so any breakage bisects to a single hop; (4) EAS project + `eas.json`. The branch merges only after the Vercel preview deployment of the upgraded web app passes the same smoke checks.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / React 19.2, expo-router, NativeWind 4, react-native-reanimated 4 + react-native-worklets, EAS CLI 18.x (installed globally at `/opt/homebrew/bin/eas`), Playwright (already a devDependency), Node 20.20.

Spec: `docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md` (Phase 0, sections 0.1–0.3).

## Global Constraints

- All frontend commands run from `frontend/` (`cd /Users/giladshavit/Desktop/DrinkApp/frontend`). Backend: `uv` only, never `pip`.
- Bundle identity exact values: `ios.bundleIdentifier` = `com.quicklegame.app`, `android.package` = `com.quicklegame.app`, `scheme` = `quickle`, `slug` = `quickle`. `name` stays `Quickle`.
- Target SDK is **57** (latest as of 2026-08-23). Do not stop at an intermediate SDK: Google Play requires Android API 36 from 31 Aug 2026 and Apple requires Xcode 26 / iOS 26 SDK since 28 Apr 2026.
- Upgrade one SDK at a time. Every hop ends with: `npx expo-doctor` clean, `npx tsc --noEmit` clean, `npm run build` succeeds, `npm run smoke:web` passes, commit.
- **The live web app must not break.** Nothing merges to `main` until the Vercel preview deployment passes the smoke checks and a manual room flow against the production backend.
- No REST endpoints added, no backend changes in this phase.
- Commits: conventional style (`chore:`, `feat:`, `fix:`, `docs:`), each with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- Branch: `chore/mobile-foundations` cut from `main` (after the spec/plan docs PR is merged). PR body first line: `Closes #<issue>`.
- Do not run `eas build` in this phase — builds are Phase 1. Phase 0 only needs `eas init` and a validated `eas.json`.

---

### Task 0: Branch + tracking issue

**Files:** none (git/GitHub only)

- [ ] **Step 1: Merge the docs branch first** (so the plan and spec live on `main`):

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git checkout chore/mobile-rollout-spec
gh issue create --title "docs: mobile store rollout spec + phase 0 plan" --body "Design spec and Phase 0 implementation plan for shipping Quickle to the App Store and Google Play." --label documentation
# note the issue number printed, e.g. 117
git push -u origin chore/mobile-rollout-spec
gh pr create --title "docs: mobile store rollout spec and phase 0 plan" --body "Closes #117

Adds the approved mobile rollout design spec and the Phase 0 (foundations) implementation plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr merge --squash --delete-branch
```

- [ ] **Step 2: Create the Phase 0 issue and branch**

```bash
git checkout main && git pull --ff-only origin main
gh issue create --title "chore: mobile foundations — bundle identity, Expo SDK 57, EAS setup" --body "Phase 0 of docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md. Plan: docs/superpowers/plans/2026-08-23-mobile-phase0-foundations.md"
# note the number, referred to below as <ISSUE>
git checkout -b chore/mobile-foundations
```

---

### Task 1: Web smoke harness (baseline on SDK 52)

**Files:**
- Create: `frontend/scripts/smoke-web.mjs`
- Modify: `frontend/package.json` (scripts)

**Interfaces:**
- Produces: `npm run smoke:web` — exits 0 when the exported `dist/` (or `--url=<base>`) renders three static screens with zero page errors; exits 1 otherwise. Every later task uses this as its pass/fail gate.

- [ ] **Step 1: Write the smoke script**

```js
#!/usr/bin/env node
// Web smoke: serve dist/ (or hit --url=<base>) and assert three static
// screens render with no runtime errors. Used as the pass/fail gate for
// every SDK upgrade hop and for the Vercel preview before merge.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
};

// Each check: path, and a text the screen must show once it has rendered.
const CHECKS = [
  { path: '/', expect: 'Your name…' },          // fresh profile → onboarding
  { path: '/games', expect: 'Games' },          // catalog index
  { path: '/privacy', expect: 'Privacy Policy' },
];

const urlArg = process.argv.find((a) => a.startsWith('--url='));
let base = urlArg ? urlArg.slice('--url='.length).replace(/\/$/, '') : null;
let server = null;

if (!base) {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    let file = join(DIST, path);
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      file = join(DIST, 'index.html'); // SPA fallback, same as vercel.json rewrite
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

const browser = await chromium.launch();
let failures = 0;
for (const check of CHECKS) {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  try {
    await page.goto(`${base}${check.path}`, { waitUntil: 'networkidle' });
    await page.getByText(check.expect, { exact: false }).first().waitFor({ timeout: 15000 });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`PASS ${check.path}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${check.path}\n  ${String(e).split('\n').join('\n  ')}`);
  }
  await context.close();
}
await browser.close();
server?.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Add npm scripts**

In `frontend/package.json` `"scripts"`, add:

```json
"smoke:web": "node scripts/smoke-web.mjs",
"verify:web": "npm run build && npm run smoke:web"
```

- [ ] **Step 3: Run the baseline on SDK 52 — it must pass before any upgrade**

Run: `cd frontend && npm run verify:web`
Expected: `PASS /`, `PASS /games`, `PASS /privacy`, `All smoke checks passed`, exit 0.
If a check fails here, the anchor text is wrong, not the app: open the page in a browser (`npx expo start --web`), find a stable visible string, update `CHECKS`, re-run. Do not proceed to Task 2 without a green baseline.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-web.mjs package.json
git commit -m "chore: add web smoke harness for upgrade verification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Bundle identity rename

**Files:**
- Modify: `frontend/app.json`
- Modify: `frontend/package.json` (`name`)

**Interfaces:**
- Produces: the permanent store identifiers. Task 7 (`eas init`) registers the EAS project under the new `slug`.

- [ ] **Step 1: Edit `frontend/app.json`**

Change exactly these four values (everything else unchanged):

```json
"slug": "quickle",
"scheme": "quickle",
"ios": { "supportsTablet": false, "bundleIdentifier": "com.quicklegame.app" },
"android": { "adaptiveIcon": { "backgroundColor": "#0f172a" }, "package": "com.quicklegame.app" },
```

- [ ] **Step 2: Edit `frontend/package.json`**

```json
"name": "quickle",
```

- [ ] **Step 3: Verify the resolved config**

Run: `npx expo config --type public | grep -E '"(slug|scheme|bundleIdentifier|package)"'`
Expected output contains:
```
"slug": "quickle",
"scheme": "quickle",
"bundleIdentifier": "com.quicklegame.app",
"package": "com.quicklegame.app",
```
Then: `grep -rn "sipsync" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.js' . | grep -v node_modules | grep -v package-lock`
Expected: no matches (if `package-lock.json` still says `sipsync`, run `npm install` to refresh it and include it in the commit).

- [ ] **Step 4: Smoke still green**

Run: `npm run verify:web` → `All smoke checks passed`.

- [ ] **Step 5: Commit**

```bash
git add app.json package.json package-lock.json
git commit -m "chore: rename bundle identity to com.quicklegame.app

Last chance before the first store upload makes it permanent.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Upgrade SDK 52 → 53 (React 19)

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json` (via tooling)
- Modify: any `.tsx` that React 19 types reject (see Step 4)

**Interfaces:**
- Consumes: `npm run verify:web` from Task 1.
- Produces: a committed SDK 53 tree that Task 4 starts from.

- [ ] **Step 1: Bump expo and align Expo-managed packages**

```bash
npm install expo@^53.0.0
npx expo install --fix
```
Expected: `expo install --fix` rewrites `react`, `react-dom`, `react-native`, `react-native-web`, `expo-*`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `@react-native-async-storage/async-storage` to SDK 53's versions (React 19.0, RN 0.79).

- [ ] **Step 2: Align React types**

```bash
npm install --save-dev @types/react@~19.0.10
```

- [ ] **Step 3: Doctor**

Run: `npx expo-doctor`
Expected: all checks pass. If it reports a package "not compatible with the installed expo version", run the exact `npx expo install <pkg>@<version>` it prints.

- [ ] **Step 4: Typecheck and fix React 19 type errors**

Run: `npx tsc --noEmit`
Known React 19 type changes to expect and their fixes:
- `React.FC<Props>` no longer includes implicit `children` → add `children?: React.ReactNode` to the props type.
- `ref` on function components: `forwardRef` still works; no change required.
- `useRef()` without an initial value is an error → `useRef<T | null>(null)`.
Fix each error at the reported location, re-run until clean.

- [ ] **Step 5: Build + smoke**

Run: `npm run verify:web`
Expected: build succeeds, `All smoke checks passed`.
If the build fails inside NativeWind/Metro, run `npx expo start --web --clear` once to rebuild the cache, then retry `npm run verify:web`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: upgrade Expo SDK 52 -> 53 (React 19, RN 0.79)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Upgrade SDK 53 → 54 (Reanimated 4 + worklets, NativeWind bump)

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: `frontend/babel.config.js`
- Modify: any Reanimated/NativeWind/expo-audio call sites the typecheck rejects

**Interfaces:**
- Consumes: SDK 53 tree from Task 3.
- Produces: committed SDK 54 tree. This is the hop most likely to need code changes.

- [ ] **Step 1: Bump expo and align packages**

```bash
npm install expo@^54.0.0
npx expo install --fix
npx expo install react-native-worklets
```
Expected: `react-native-reanimated` → 4.x, `react-native-worklets` → the SDK 54 version (replaces the stray 0.6 pin), RN → 0.81, `expo-audio` → 1.x.

- [ ] **Step 2: Bump NativeWind to the 4.x line that supports Reanimated 4**

```bash
npm install nativewind@^4.2.0
```

- [ ] **Step 3: Remove the legacy Reanimated babel plugin**

`babel-preset-expo` now injects the worklets plugin itself; keeping the old line breaks the build. `frontend/babel.config.js` becomes:

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

- [ ] **Step 4: Doctor**

Run: `npx expo-doctor` → all pass (apply any printed `npx expo install` fix).

- [ ] **Step 5: Typecheck and fix Reanimated 4 / expo-audio 1.x errors**

Run: `npx tsc --noEmit`
Known changes to expect:
- Reanimated 4 removed `useAnimatedGestureHandler` (not used here — verified), and renamed the layout-transition export `Layout` → `LinearTransition`. Our 43 Reanimated call sites use `useSharedValue`/`useAnimatedStyle`/`withTiming`/`withSpring`/`runOnJS` and entering/exiting presets — all still present in v4. Fix any error at its reported location.
- `expo-audio` 0.3 → 1.x: `useAudioPlayer(source)` / `player.play()` / `player.seekTo()` are unchanged; if a property was renamed the error names the member — follow the type's suggestion.
Re-run until clean.

- [ ] **Step 6: Build + smoke**

Run: `npm run verify:web` → `All smoke checks passed`.
If the web bundle fails on `react-native-worklets`, run `npx expo start --web --clear` once and retry.

- [ ] **Step 7: Manual animation check on web (Reanimated 4 is a runtime change, not just types)**

Run in two terminals:
```bash
# terminal 1 — backend (Redis is already running locally on :6379)
cd /Users/giladshavit/Desktop/DrinkApp/backend && uv run uvicorn app.main:app --port 8000
# terminal 2 — web
cd /Users/giladshavit/Desktop/DrinkApp/frontend && npx expo start --web
```
In the browser: complete onboarding → Create Room → open `/games/reflex` in a second tab and play its tutorial preview → confirm the animated tutorial runs smoothly and the home mascot/lobby animations render. No console errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: upgrade Expo SDK 53 -> 54 (Reanimated 4, worklets, NativeWind 4.2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Upgrade SDK 54 → 55

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: any call sites the typecheck rejects

**Interfaces:**
- Consumes: SDK 54 tree from Task 4.
- Produces: committed SDK 55 tree.

- [ ] **Step 1: Bump and align**

```bash
npm install expo@^55.0.0
npx expo install --fix
```
(SDK 55 removed `expo-av` — this app already uses `expo-audio`, nothing to migrate.)

- [ ] **Step 2: Doctor**

Run: `npx expo-doctor` → all pass.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → fix any reported error at its location, re-run until clean.

- [ ] **Step 4: Build + smoke**

Run: `npm run verify:web` → `All smoke checks passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: upgrade Expo SDK 54 -> 55

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Upgrade SDK 55 → 56

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: any call sites the typecheck rejects

**Interfaces:**
- Consumes: SDK 55 tree from Task 5.
- Produces: committed SDK 56 tree.

- [ ] **Step 1: Bump and align**

```bash
npm install expo@^56.0.0
npx expo install --fix
npm install --save-dev @types/react@~19.2.0
```
(SDK 56 moved `@react-navigation/*` imports behind `expo-router` entry points — this codebase has zero direct `@react-navigation` imports, verified.)

- [ ] **Step 2: Doctor**

Run: `npx expo-doctor` → all pass.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → fix any reported error, re-run until clean.

- [ ] **Step 4: Build + smoke**

Run: `npm run verify:web` → `All smoke checks passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: upgrade Expo SDK 55 -> 56 (React 19.2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Upgrade SDK 56 → 57 + full manual web regression

**Files:**
- Modify: `frontend/package.json`, `frontend/package-lock.json`
- Modify: any call sites the typecheck rejects

**Interfaces:**
- Consumes: SDK 56 tree from Task 6.
- Produces: the final SDK 57 tree all later phases build on.

- [ ] **Step 1: Bump and align**

```bash
npm install expo@^57.0.0
npx expo install --fix
```
Expected: RN 0.86, `react-native-reanimated` 4.5.x, `react-native-worklets` 0.10.x, `react-native-gesture-handler` 2.32.x.

- [ ] **Step 2: Doctor**

Run: `npx expo-doctor` → all pass.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → fix any reported error, re-run until clean.

- [ ] **Step 4: Build + smoke**

Run: `npm run verify:web` → `All smoke checks passed`.

- [ ] **Step 5: Full manual room flow on web (the real regression gate)**

Backend + web running as in Task 4 Step 7. Use two browser contexts (one normal window, one incognito window):
1. Window A: onboard as "Host", Create Room → lobby shows a room code.
2. Window B: onboard as "Guest", Join Room with that code → both lobbies list both players.
3. Window A: Start Game → both windows show the tutorial/pre-round screen, then the first mini-game.
4. Play one full round to the drinking window and the next-game transition; confirm timers, animations and the 6-second drinking window render in both windows.
5. Window B: reload the page mid-round → it reconnects to the same room and state.
6. No `console.error` in either window throughout.
If any step fails: fix it in this task (it is an upgrade regression), re-run `npm run verify:web`, repeat the flow.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: upgrade Expo SDK 56 -> 57 (RN 0.86, Reanimated 4.5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: EAS project + `eas.json`

**Files:**
- Create: `frontend/eas.json`
- Modify: `frontend/app.json` (`extra.eas.projectId` + `owner`, written by `eas init`)
- Modify: `frontend/package.json` (`expo-dev-client`)

**Interfaces:**
- Consumes: the `quickle` slug from Task 2.
- Produces: build profiles `development`, `preview`, `production` that Phase 1 invokes with `eas build --profile <name>`. `preview`/`production` bake `EXPO_PUBLIC_API_URL` = the Railway backend; `development` leaves it unset because a dev client loads its JS from local Metro, which reads the developer's local env (`EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000` per CLAUDE.md).

- [ ] **Step 1: Confirm CLI + login (Gilad's step)**

```bash
eas --version        # expect eas-cli/18.x or newer; if older: npm install -g eas-cli
eas whoami           # if "Not logged in": eas login  ← Gilad enters Expo credentials
```

- [ ] **Step 2: Create the EAS project**

```bash
cd /Users/giladshavit/Desktop/DrinkApp/frontend
eas init
```
Expected: prompts to create project `@<owner>/quickle`, then writes `extra.eas.projectId` (a UUID) and `owner` into `app.json`. Verify: `grep -A3 '"eas"' app.json` shows a `projectId`.

- [ ] **Step 3: Install the dev client (needed by the `development` profile)**

```bash
npx expo install expo-dev-client
```

- [ ] **Step 4: Write `frontend/eas.json`**

```json
{
  "cli": {
    "version": ">= 18.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": {
        "EXPO_PUBLIC_API_URL": "https://backend-production-f4b22.up.railway.app"
      }
    },
    "production": {
      "autoIncrement": true,
      "env": {
        "EXPO_PUBLIC_API_URL": "https://backend-production-f4b22.up.railway.app"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```
(`submit.production` is filled in Phase 2 once the App Store Connect app record exists — it needs the ASC app id, which does not exist yet.)

- [ ] **Step 5: Validate the profiles resolve without building**

```bash
eas config --profile production --platform ios
eas config --profile production --platform android
eas config --profile development --platform android
```
Expected: each prints the resolved build profile and app config with `bundleIdentifier`/`package` = `com.quicklegame.app`, `EXPO_PUBLIC_API_URL` present under `env` for `production`, absent for `development`, and no "invalid eas.json" error.

- [ ] **Step 6: Web still green (expo-dev-client must not affect web)**

Run: `npm run verify:web` → `All smoke checks passed`.

- [ ] **Step 7: Commit**

```bash
git add eas.json app.json package.json package-lock.json
git commit -m "chore: initialize EAS project and build profiles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Vercel preview verification, PR, merge

**Files:** none (GitHub/Vercel only)

**Interfaces:**
- Consumes: `npm run smoke:web -- --url=<preview>` from Task 1.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin chore/mobile-foundations
gh pr create --title "chore: mobile foundations — bundle identity, Expo SDK 57, EAS setup" --body "Closes #<ISSUE>

Phase 0 of the mobile store rollout (spec: docs/superpowers/specs/2026-08-05-mobile-store-rollout-design.md).

- Web smoke harness (\`npm run verify:web\`) used as the gate for every step
- Bundle identity → com.quicklegame.app / slug+scheme \`quickle\`
- Expo SDK 52 → 57, one hop per commit
- EAS project initialised, \`eas.json\` with development/preview/production profiles

Web verified: local smoke on every hop, full two-player room flow on SDK 57, Vercel preview smoke (see checklist below).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Wait for the Vercel preview deployment**

Run: `gh pr checks --watch`
Expected: the Vercel check turns green and the PR has a preview URL (`https://<project>-<hash>-<team>.vercel.app`). Copy it as `<PREVIEW>`. If the Vercel check fails, open its build log (`gh pr checks` prints the link) — the build command is `npm run build`; fix the cause on the branch and push again.

- [ ] **Step 3: Smoke the preview**

Run: `npm run smoke:web -- --url=<PREVIEW>`
Expected: `All smoke checks passed`.

- [ ] **Step 4: Manual room flow on the preview against the production backend**

The backend CORS allowlist already includes `*.vercel.app`. In two browser contexts on `<PREVIEW>`: onboard → Create Room → Join from the second context → Start Game → play one round. Expected: works end-to-end with the live Railway backend; no console errors.

- [ ] **Step 5: Squash-merge**

```bash
gh pr merge --squash --delete-branch
```
Then confirm production: open `https://www.quicklegame.com` after Vercel's main deployment finishes, run `npm run smoke:web -- --url=https://www.quicklegame.com` → `All smoke checks passed`.

---

## Self-review notes

- Spec 0.1 → Task 2. Spec 0.2 → Tasks 1, 3–7 (one hop per task, web verified each hop; Vercel preview gate in Task 9). Spec 0.3 → Task 8 (three profiles, `autoIncrement`, `eas init`). Ownership table: Gilad's only hands-on step in this phase is `eas login` (Task 8 Step 1) — matches the spec.
- `EXPO_PUBLIC_API_URL` baking in `preview`/`production` is spec 1.1's requirement, pulled forward because it is a one-line part of writing `eas.json`; the verification that a native production build resolves it stays in Phase 1.
- Not in this plan (by design): `expo-updates`, `runtimeVersion`, assets, dev builds — all Phase 1.
