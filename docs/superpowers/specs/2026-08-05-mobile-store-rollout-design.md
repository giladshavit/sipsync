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
- **Scope (decided):** Web parity only. No push notifications, no deep links / universal links, no new gameplay features. New in-app code driven by this project is limited to: the first-launch age/consent screen (3.1), EAS Update wiring (1.4), the server-side game kill switch (1.5), and the client compatibility gate with a blocking update screen (1.6).
- **Package upgrade rule (decided):** the Expo SDK / dependency upgrade is verified against the existing web deployment first; nothing merges until web is confirmed unbroken.
- **Release-compatibility principle (decided):** a store app cannot be updated instantly, but the backend (Railway) and web (Vercel) can. Therefore anything that must take effect for all players at once — disabling a game, requiring a newer client — is enforced by the backend, and clients only mirror it for display.

## Phase 0 — Foundations

**0.1 Brand identity alignment in `frontend/app.json`:**
- `ios.bundleIdentifier`: `com.sipsync.app` → `com.quicklegame.app`
- `android.package`: `com.sipsync.app` → `com.quicklegame.app`
- `scheme`: `sipsync` → `quickle`
- `slug`: `sipsync` → `quickle`

**0.2 Expo SDK upgrade (52 → 57).** Store requirements verified on 2026-08-23:
- Google Play: new apps and updates must target **Android 16 (API 36)** from **31 Aug 2026** (extension to 1 Nov 2026 available). SDK 52 targets API 34 — not submittable.
- Apple: since **28 Apr 2026** uploads must be built with **Xcode 26 / iOS 26 SDK**. Expo SDK 54+ default EAS images use Xcode 26; SDK 53 and lower are not supported for this.
- Latest Expo SDK is **57** (released 30 Jun 2026; React Native 0.86, React 19.2, Reanimated 4.5). Target SDK 57.
- Expo recommends upgrading **one SDK at a time** (52→53→54→55→56→57) to pinpoint breakages; each hop is `npm install expo@^N` → `npx expo install --fix` → `npx expo-doctor` → typecheck → web build → web smoke → commit. Known hops with breaking changes for this codebase: 53 (React 19), 54 (Reanimated 4 + `react-native-worklets`, babel plugin moves into `babel-preset-expo`, NativeWind bump, Android edge-to-edge default).
- This is the riskiest technical step. Do it first, on its own branch, and **verify the existing web deployment still builds and works (local smoke + Vercel preview deployment) before merging** — the live web app must not break.

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
- Android `adaptiveIcon.monochromeImage` — required for Android 13+ themed icons.
- `splash` has only `backgroundColor` + `resizeMode` — add a splash image (logo), plus a dark-mode variant (app uses `userInterfaceStyle: automatic`).
- Verify the iOS icon (1024×1024, exists) has no alpha channel (Apple rejects transparent icons).
- iOS icon dark + tinted variants (iOS 18 appearance modes) via `ios.icon` in app.json.
- Set `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` (HTTPS/WSS only ⇒ exempt) to skip the export-compliance question on every build.
- Permissions audit on the final build: microphone must stay off (already `microphonePermission: false`), and no stray Android permissions that complicate the Data Safety form.

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

**1.4 EAS Update (OTA) — wired before beta, not after launch.**
- A new mini-game is pure JS/TS on the client (a component + a `GAME_CATALOG` entry) with zero native changes, so it can ship over-the-air to every installed app without a store review. That makes OTA the primary delivery channel for new games and bug fixes; store releases are only for native changes (SDK upgrades, new native modules).
- Configure `expo-updates`. Runtime policy is `appVersion` (`fingerprint` was tried first and failed on EAS: the builder's fingerprint included an `ios` bareNativeDir plus differing `expo-dev-launcher`/`expo-dev-menu` hashes, so local and builder runtime versions never matched), `checkAutomatically: ON_LOAD`, and a `production` channel matching the `production` build profile. Publish with `eas update`.
  - **Rule 1:** any build containing NATIVE changes (SDK upgrade, new native module, config-plugin change) must bump `expo.version` in `app.json` before `eas build` — otherwise old binaries share the runtime and can receive an incompatible OTA.
  - **Rule 2:** updates published for runtime `1.0.0` do NOT reach a `1.0.1` build, so `eas update --channel production` must be re-run per runtime version after a version bump.
- Free-tier limits (monthly active users / update bandwidth) are sufficient for launch; revisit if usage grows.

**1.5 Game kill switch (server-authoritative, flipped in code).**
- Backend: a single `DISABLED_GAME_IDS: frozenset[str]` constant beside `GAME_REGISTRY` in `backend/app/engine/game_loader.py`. Disabling a game = add its id, deploy.
- Enforcement: `normalize_game_ids` (shared by `CreateRoomRequest` and `SET_GAMES`) **silently drops** disabled ids instead of raising — a stale client that still knows the game must not be broken by it — and errors only if nothing remains. `CreateRoomRequest`'s default game list includes enabled games only. The room's broadcast `game_ids` is therefore always the effective list, and every client already renders from it.
- Frontend mirror: `enabled?: boolean` on `GameMeta` in `frontend/constants/games.ts` (default true) so a disabled game disappears from the lobby picker and catalog pages; web picks it up on deploy, apps via OTA.
- This is a registry-level feature, not a new mini-game: `deck.py`, `fsm.py`, `base.py`, `ws.py` are not touched.

**1.6 Client compatibility gate (forced update).**
- Problem: when a game is added, players on an older client would be dealt a game their app has no UI for. Rooms must never mix incompatible clients.
- Mechanism: an integer compatibility number, not the marketing version — `CLIENT_VERSION = 1` as a frontend constant (baked into the JS bundle, so an OTA update can raise it; the native `1.0.0` cannot serve this purpose), and `MIN_CLIENT_VERSION = 0 at launch (armed but permissive; first real forced update raises it together with CLIENT_VERSION)` on the backend.
- Transport (no new REST endpoints — respects the two-endpoint limit): the client sends `X-Client-Version` on `POST /rooms` and `GET /rooms/{code}`, and the same value as a query parameter on the WebSocket connect. Below the minimum ⇒ REST responds `426 Upgrade Required` with a JSON body; WebSocket is closed with a dedicated close code before joining. A missing header is treated as version 0 (old web tabs are gated too).
- Frontend: a global handler for 426 / the WS close code navigates to a blocking `update-required` screen. The screen first tries OTA (`Updates.fetchUpdateAsync()` → `reloadAsync()`, shown as "Updating…"); only if no OTA update is available does it show a store button (App Store / Play Store link by platform; on web: "refresh the page"). Most forced updates therefore resolve in seconds without visiting a store.
- Operating rule: adding a game that old clients cannot render bumps `CLIENT_VERSION` and `MIN_CLIENT_VERSION` in the same PR. Backend and frontend auto-deploy from the same merge; the OTA publish (`eas update`) is part of the release checklist for any client-facing change.

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
- **In-app:** one-time first-launch consent screen — age confirmation (18+), "drink responsibly" note, and an explicit statement that the game works with any beverage, alcoholic or not. Persisted in SecureStore.
- **Store copy:** frame as a "party game" with responsible-drinking language. No encouragement of excess ("get wasted", quantities, challenges to drink more).
- **Age-rating questionnaires:** answer honestly. Apple → Alcohol References ⇒ 17+. Google IARC ⇒ 18+ in some regions. Lying in the questionnaire is grounds for removal.

**3.2 Store assets — full checklist.**

*Both stores:*
- Check "Quickle" name availability; fallback display name with a suffix (e.g., "Quickle — Party Game").
- All listing text in two locales: Hebrew + English.
- Screenshots are designed marketing frames (device frame + short caption), not raw captures; content must reflect the actual app and match the 17+/18+ rating.

*App Store Connect:*
- Screenshots: 6.9″ class (1320×2868), one size set suffices since 2024; up to 10, target 5–6. No iPad set (`supportsTablet: false`).
- Optional App Preview video (15–30s) — can be cut from the beta demo video.
- Text fields with hard limits, drafted in advance: Subtitle (30 chars), Promotional Text (170), Description (4000), Keywords (100 chars — hidden field, critical for ASO), Support URL, Marketing URL, Copyright.
- Category selection (likely Games → Casual, or Entertainment — decide by studying category of Picolo et al.).

*Google Play Console:*
- Store icon **512×512 PNG** — uploaded separately in the Console, distinct from the in-app icon.
- Feature graphic 1024×500.
- Phone screenshots: min 2, max 8, 9:16.
- Short description (80 chars — the first text users see) + Full description (4000).
- Optional promo video (YouTube URL).
- Console declarations: ads (none), target audience (18+), public contact email.

**3.3 Legal obligations.**
- Privacy policy page at `quicklegame.com/privacy` (required by both stores). Data collected is minimal — anonymous UUID, display name, transient game state in Redis — present that fully.
- Apple App Privacy questionnaire + Google Data Safety form, consistent with the policy.
- Support/contact URL.
- **EU DSA trader declaration (both stores):** required for distribution in the EU. As a solo developer with no monetization, declare **non-trader**; leaving it unanswered blocks EU availability.
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
- **Release routine:** JS-only changes (new games, UI fixes) ship via `eas update` to the production channel, plus a web deploy; native changes go through `eas build` + store review. Every release that affects the client contract bumps the compatibility number (1.6).
- **Web stays live:** quicklegame.com continues to serve — it is both the low-friction join path for people without the app and Apple's second-player test surface. Same backend serves all clients.

## Ownership — who does what

| Phase | Claude (code, builds, assets, copy) | Gilad (accounts, devices, people, consoles) |
|---|---|---|
| 0 — Foundations | Bundle-id rename, SDK upgrade + web verification, `eas.json`, `eas init` | Log in to the Expo account when `eas init` runs |
| 1 — Technical readiness | Env wiring, all graphic assets, EAS Update, kill switch, compatibility gate, dev builds, fixing what breaks | Install dev builds on a physical iPhone + Android and run the device checklist |
| 2 — Closed beta | Submit builds to TestFlight / Play Internal, fix field bugs | Check the Play Console 12-testers/14-days rule first, recruit testers, run real game nights, record the demo video |
| 3 — Store readiness | Consent screen, privacy policy page, all store copy (he/en), designed screenshots | Approve copy/visuals; fill the account-holder-only forms: age-rating questionnaires, App Privacy / Data Safety, EU non-trader declaration |
| 4 — Submission | Production builds, `eas submit`, App Review notes | Press the final submit buttons; co-write any rejection response |
| 5 — Post-launch | OTA + store release routine | Tell the friends |

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

- Dynamic server-driven game catalog (replacing the frontend mirror with a fetched list) — the kill switch + compatibility gate cover the real need without a new REST endpoint.

- Push notifications, deep links / universal links, host migration, or any backlog feature.
- Backend changes (none required — CORS, wss, and Railway deployment all already serve native clients as-is).
- Monetization / purchases.
- Crash-reporting tooling (e.g., Sentry) — consider post-launch.
