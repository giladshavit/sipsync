# Mobile Store Rollout — Design

**Date:** 2026-08-05
**Status:** Approved for planning
**Goal:** Ship Quickle (SipSync) as a native mobile app to the Apple App Store and Google Play, with a closed beta as an intermediate stage. First mobile release is **feature parity with the current web app** — no new features.

## Context & Decisions Made

- **Current state:** Expo SDK 52 managed-workflow app, deployed as web only (Vercel → quicklegame.com). Backend live on Railway. No `eas.json`, no EAS project, no native builds ever produced.
- **Developer accounts:** User already has both an Apple Developer Program membership and a Google Play Console account.
- **Build/submit approach (decided):** Full EAS pipeline — EAS Build (cloud builds, Expo-managed signing credentials) + EAS Submit for both stores. No local Xcode/Android Studio builds.
- **Bundle identity (decided):** Change `bundleIdentifier`/`package` from `com.sipsync.app` to `com.quicklegame.app` before first upload (last chance — permanent afterwards). Also rename `scheme` → `quickle` and `slug` → `quickle` (no EAS project exists yet, so slug is still free to change).
- **Content positioning (decided):** Declare honestly as a drinking game with a 17+/18+ age rating, plus responsible-drinking framing and "works with any beverage" messaging — the proven path used by Picolo, Drink Roulette, etc. Goal is passing review, not hiding the category.
- **Scope (decided):** Web parity only. No push notifications, no deep links / universal links, no new features. The only new in-app code driven by this project is the first-launch age/consent screen (see 3.1).

## Phase 0 — Foundations

**0.1 Brand identity alignment in `frontend/app.json`:**
- `ios.bundleIdentifier`: `com.sipsync.app` → `com.quicklegame.app`
- `android.package`: `com.sipsync.app` → `com.quicklegame.app`
- `scheme`: `sipsync` → `quickle`
- `slug`: `sipsync` → `quickle`

**0.2 Expo SDK upgrade (52 → latest, expected 54).**
- Reason: Google Play requires new apps to target recent Android API levels (API 35 since Aug 2025; the requirement likely steps up to API 36 around the end of Aug 2026). SDK 52 targets API 34 — not submittable. Apple similarly requires recent Xcode/iOS SDK toolchains.
- Verify the exact current store requirements (web search) at execution time before choosing the target SDK.
- This is the riskiest technical step (React Native major bump, Reanimated major bump). Do it first, on its own branch, and **verify the existing web deployment still builds and works on Vercel before merging** — the live web app must not break.

**0.3 EAS setup.**
- Log in to Expo account, `eas init` (creates the EAS project ID in app.json).
- Create `frontend/eas.json` with three profiles:
  - `development` — dev client for on-device testing
  - `preview` — internal distribution / beta
  - `production` — store builds, `autoIncrement` for build numbers

## Phase 1 — Technical Mobile Readiness

**1.1 Environment wiring.**
- Production builds must resolve the backend URL to Railway (`https://backend-production-f4b22.up.railway.app`). Today `frontend/constants/api.ts` keys off `__DEV__`; verify what a non-dev native build resolves to and set `EXPO_PUBLIC_API_URL` explicitly in the `production` (and `preview`) profiles of `eas.json`.
- WebSocket runs over `wss://` — already proven on web prod.
- CORS is irrelevant for native apps (no Origin header) — no backend work.

**1.2 Complete the graphic assets.** Known gaps found in `app.json`:
- Android `adaptiveIcon` has only `backgroundColor` — a `foregroundImage` is **required**. Create one.
- `splash` has only `backgroundColor` + `resizeMode` — add a splash image (logo).
- Verify the iOS icon (1024×1024, exists) has no alpha channel (Apple rejects transparent icons).

**1.3 Dev build + real-device pass.**
- `eas build --profile development` for iOS + Android; install on physical iPhone and Android phone.
- Full manual game pass focusing on native-only behaviors:
  - Safe areas / notch
  - Keyboard behavior on the room-code modal (the exact area fought in PR #108)
  - Audio playback
  - Animations (Reanimated on the UI thread)
  - **WebSocket reconnect when the app returns from background** — different lifecycle than a browser tab
  - Screen staying awake during a round (keep-awake behavior)
- Fix whatever breaks here, before beta.

## Phase 2 — Closed Beta

**2.1 iOS — TestFlight.**
- Build (`preview`/`production` profile) → `eas submit` to App Store Connect.
- Start with **internal testers** (up to 100, instant, no review). External-tester link (requires one-time Beta App Review, ~1–2 days) only if a wider circle is needed.

**2.2 Android — Play Console.**
- **Internal testing** track (up to 100 testers by email, live within minutes).
- **First action on entering the Console:** check whether the account is a personal account created after Nov 2023. If so, Google requires a closed test with **≥12 active testers for 14 consecutive days** before production access is granted. If this applies, the beta is a hard gate, not just a quality stage — recruit 12+ friends and verify they actually opt in and use the app. This check drives the Android timeline.

**2.3 Feedback loop.**
- 1–2 weeks of real game nights. Watch specifically for: WebSocket drops on cellular networks, battery drain, device heating.
- Fix → rebuild → redistribute as needed.
- Record a **demo video** of a full round with several phones during one of these sessions (needed for App Review notes, see 4.2).

## Phase 3 — Store Readiness (parallel to beta)

**3.1 Sensitive-content strategy (the core of passing review).**
- **In-app:** one-time first-launch consent screen — age confirmation (18+), "drink responsibly" note, and an explicit statement that the game works with any beverage, alcoholic or not. Persisted in SecureStore. This is the only new in-app feature in scope.
- **Store copy:** frame as a "party game" with responsible-drinking language. No encouragement of excess ("get wasted", quantities, challenges to drink more).
- **Age-rating questionnaires:** answer honestly. Apple → Alcohol References ⇒ 17+. Google IARC ⇒ 18+ in some regions. Lying in the questionnaire is grounds for removal.

**3.2 Store assets.**
- Check "Quickle" name availability in both stores; fallback display name with a suffix (e.g., "Quickle — Party Game").
- Screenshots: iOS 6.9″ or 6.5″ class (≥3); Android phone screenshots + 1024×500 feature graphic.
- Descriptions in Hebrew and English; store icon.

**3.3 Legal obligations.**
- Privacy policy page at `quicklegame.com/privacy` (required by both stores). Data collected is minimal — anonymous UUID, display name, transient game state in Redis — present that fully.
- Apple App Privacy questionnaire + Google Data Safety form, consistent with the policy.
- Support/contact URL.
- No account creation ⇒ Apple's account-deletion requirement does not apply. No purchases ⇒ no payments complexity.

## Phase 4 — Submission & Review

**4.1 Production builds & submit.** `eas build --profile production` (both platforms) → `eas submit`. On Android the first public release is a promotion from the testing track already running.

**4.2 App Review notes (critical for a realtime multiplayer app).**
- Risk: a single Apple reviewer with one device cannot form a multi-player room → near-certain "we couldn't review the app" rejection if unprepared.
- Mitigation: Review Notes explain exactly how to test (open quicklegame.com in a browser as the second player), plus a link to the demo video from 2.3.

**4.3 Expected rejection risks & prepared responses.**
- **Apple 1.4.3 (encouraging alcohol consumption)** — main risk. Defense: 17+ rating, consent screen, any-beverage framing, category precedents (Picolo, Drink Roulette). If rejected anyway: reasoned appeal, or soften copy further and resubmit. A first rejection is a conversation, not the end.
- **Apple 4.2 (minimum functionality / wrapped website)** — not truly exposed: this is a real React Native app with native UI, not a WebView.
- **Metadata rejection** — mismatched screenshots, mentions of other platforms. Prevent up front.
- Review times: Apple typically 24–48h; Google up to a week or more for a brand-new app. Plan for it; don't panic.

**4.4 Launch.**
- Apple: choose **manual release** (not auto-release on approval) to control timing and sync with Android.
- After going live: clean-install test from both stores on real devices.

## Phase 5 — Post-Launch Operations

- **Versioning:** `autoIncrement` in eas.json manages build numbers; marketing version (1.0.0 → 1.1.0) bumped manually.
- **EAS Update (OTA):** recommended to wire up after launch — JS-only fixes ship directly to users without store review. Native changes still require build + review.
- **Web stays live:** quicklegame.com continues to serve — it is both the low-friction join path for people without the app and Apple's second-player test surface. Same backend serves all clients.

## Estimated Timeline

| Phase | Duration |
|---|---|
| 0 — identity, SDK upgrade, EAS setup | 2–4 working days |
| 1 — technical readiness + device pass | 3–5 working days |
| 2 — closed beta | 1–2 weeks (≥14 days if Google's 12-tester rule applies) |
| 3 — store assets & legal | 2–3 days, parallel to beta |
| 4 — submission + review | 3 days–2 weeks |

**Realistic total: ~4–6 weeks** from today to live in both stores; the critical path is likely Google's 14-day closed-testing requirement.

## Out of Scope (explicitly)

- Push notifications, deep links / universal links, host migration, or any backlog feature.
- Backend changes (none required — CORS, wss, and Railway deployment all already serve native clients as-is).
- Monetization / purchases.
- Crash-reporting tooling (e.g., Sentry) — consider post-launch.
