# Production Ads via Google AdSense (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SipSync's placeholder ("mock") ad overlay with real Google AdSense Auto ads (Vignette) on the web build, plus the supporting `ads.txt` and privacy-policy plumbing AdSense requires.

**Architecture:** Delete the manually-triggered mock ad system entirely (nothing replaces it in the React tree — Vignette is Google's own script deciding placement). Add a `+html.tsx` custom document injecting the AdSense script gated by a production-only env flag, a `public/ads.txt`, and a `/privacy` route linked from the existing profile screen.

**Tech Stack:** Expo SDK 52, expo-router 4.0 (file-based routing, `app/+html.tsx` for the exported web document), React Native Web, TypeScript strict mode, deployed to Vercel (static export via `expo export --platform web`).

## Global Constraints

- Publisher ID: `pub-6248733928314999` — exact value, used verbatim in both the script tag and `ads.txt`.
- Production domain: `https://www.quicklegame.com` (per `CLAUDE.md`'s Deployment & Environments section).
- Auto ads / Vignette only — no manually placed AdSense display units, no AdMob (no native build exists in this repo).
- The AdSense script must be gated by `process.env.EXPO_PUBLIC_ADS_ENABLED === 'true'`, sourced from Vercel's env var UI scoped to the **Production** environment only — Preview/Development builds must never load the live script (Google's invalid-traffic policy).
- `ads.txt` line, verbatim: `google.com, pub-6248733928314999, DIRECT, f08c47fec0942fa0` (the trailing token is Google's own fixed certification-authority ID, identical across all publishers, not specific to this account).
- Typography: any new heading uses `typography.title` (standalone heading), any sub-header uses `typography.label` (per `frontend/constants/design.ts` — see `CLAUDE.md`). Never `fontFamily: 'Courier New'`.
- Icons: `lucide-react-native` only, never raw emoji (per `CLAUDE.md`).
- No test runner exists in this repo (no jest/vitest config, no `test` script in `frontend/package.json`) — verification uses `npx tsc --noEmit` (strict TypeScript compiles cleanly), targeted `grep` checks for dangling references, and `npm run build` (i.e. `expo export --platform web`) actually succeeding and producing the expected static output. This matches how this codebase is actually verified elsewhere (see `CLAUDE.md`: "Type checking and test suites verify code correctness, not feature correctness").
- Working directory for all commands below: `frontend/`.

## Correction to the design spec, found during planning

The spec (`docs/superpowers/specs/2026-08-03-production-ads-adsense-design.md`) says the current `vercel.json` catch-all rewrite would swallow a request for `/ads.txt` and serve the SPA shell instead, and proposed carving out an exception. That's not accurate: Vercel resolves a request against the deployment's static files **before** applying `rewrites` — a physically present file (like `frontend/public/ads.txt`, which Expo copies verbatim into the `dist/` export) is served as-is, and the rewrite only kicks in for paths that don't match a real file. This is exactly why the app's own JS/CSS bundle requests already work today under the same catch-all rule. So **no `vercel.json` change is needed** — Task 2 below only adds the file itself. The real verification is a post-deploy check (`curl https://www.quicklegame.com/ads.txt`), which is called out as a manual step since it needs a live deployment, not something a local task step can assert.

---

### Task 1: Remove the mock ad system

**Files:**
- Delete: `frontend/config/ads.ts`
- Delete: `frontend/hooks/useMockAd.ts`
- Delete: `frontend/components/MockAdOverlay.tsx`
- Modify: `frontend/app/room/[code]/lobby.tsx:18-19` (imports), `:36` (hook call), `:641` (render)
- Modify: `frontend/app/room/[code]/podium.tsx:29-30` (imports), `:927` (hook call), `:1383` (render)

**Interfaces:**
- Consumes: nothing (pure deletion).
- Produces: nothing new. Confirms no other file in the repo references the deleted modules — later tasks don't depend on anything here.

- [ ] **Step 1: Confirm nothing else references the mock ad system**

Run: `grep -rn "MockAdOverlay\|useMockAd\|config/ads" app components hooks`

Expected output: exactly the 3 files being deleted plus their 2 usage sites in `lobby.tsx` and `podium.tsx` — nothing else. If anything else shows up, stop and investigate before deleting.

- [ ] **Step 2: Delete the three mock-ad files**

```bash
rm frontend/config/ads.ts frontend/hooks/useMockAd.ts frontend/components/MockAdOverlay.tsx
```

- [ ] **Step 3: Remove the mock-ad usage from `lobby.tsx`**

Remove line 18 (`import { useLobbyAd } from '@/hooks/useMockAd';`) and line 19 (`import MockAdOverlay from '@/components/MockAdOverlay';`).

Remove line 36:
```tsx
  const { visible: lobbyAdVisible, dismiss: dismissLobbyAd } = useLobbyAd(code);
```

Remove line 641:
```tsx
      {lobbyAdVisible && <MockAdOverlay type="lobby" onClose={dismissLobbyAd} />}
```

- [ ] **Step 4: Remove the mock-ad usage from `podium.tsx`**

Remove line 29 (`import { usePodiumAd } from '@/hooks/useMockAd';`) and line 30 (`import MockAdOverlay from '@/components/MockAdOverlay';`).

Remove line 927:
```tsx
  const { visible: podiumAdVisible, dismiss: dismissPodiumAd } = usePodiumAd();
```

Remove line 1383:
```tsx
      {podiumAdVisible && <MockAdOverlay type="podium" onClose={dismissPodiumAd} />}
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (in particular, no "Cannot find module '@/hooks/useMockAd'" or unused-variable errors from the removed hook calls).

- [ ] **Step 6: Confirm the deleted modules are fully gone**

Run: `grep -rn "MockAdOverlay\|useMockAd\|config/ads" app components hooks`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/room/\[code\]/lobby.tsx frontend/app/room/\[code\]/podium.tsx
git rm frontend/config/ads.ts frontend/hooks/useMockAd.ts frontend/components/MockAdOverlay.tsx
git commit -m "feat: remove mock ad placeholder system"
```

---

### Task 2: Add `ads.txt`

**Files:**
- Create: `frontend/public/ads.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: a static file present in every web export at `dist/ads.txt` — no other task depends on this file's contents, but Task 3's manual AdSense dashboard verification step (outside this plan, on the user) depends on it being live in production.

- [ ] **Step 1: Create the file**

```bash
mkdir -p frontend/public
```

Write `frontend/public/ads.txt`:
```
google.com, pub-6248733928314999, DIRECT, f08c47fec0942fa0
```
(single line, exact text above, no trailing blank line needed beyond the one newline)

- [ ] **Step 2: Build and confirm it lands in the export output**

Run: `cd frontend && npm run build`
Expected: build succeeds (no errors).

Run: `cat frontend/dist/ads.txt`
Expected: prints exactly `google.com, pub-6248733928314999, DIRECT, f08c47fec0942fa0`.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/ads.txt
git commit -m "feat: add ads.txt for AdSense site verification"
```

---

### Task 3: Add the AdSense script via a custom web document

**Files:**
- Create: `frontend/app/+html.tsx`

**Interfaces:**
- Consumes: `process.env.EXPO_PUBLIC_ADS_ENABLED` (a Vercel-scoped env var — not defined in code, set in Vercel's dashboard for the Production environment only; absent/`false` everywhere else).
- Produces: nothing consumed by other tasks — this is the terminal piece of the AdSense wiring. The env var name (`EXPO_PUBLIC_ADS_ENABLED`) is the one fact from this task worth remembering for the account-side checklist handed to the user afterward.

`app/+html.tsx` doesn't exist yet — Expo Router uses whatever default web document template it ships with in its absence. This file is the officially documented way to customize that document's `<head>` (see Expo Router's `expo-router/html` export, used below for `ScrollViewStyleReset`, which is part of the standard template Expo's own docs use — omitting it can affect React Native Web's scroll-reset behavior on the exported page).

- [ ] **Step 1: Create `frontend/app/+html.tsx`**

```tsx
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const ADS_ENABLED = process.env.EXPO_PUBLIC_ADS_ENABLED === 'true';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        {ADS_ENABLED && (
          <script
            async
            src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6248733928314999"
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Build with the flag off and confirm the script is absent**

Run: `cd frontend && EXPO_PUBLIC_ADS_ENABLED=false npm run build && grep -c "pagead2.googlesyndication.com" dist/index.html`
Expected: `0` (grep with `-c` prints the match count; `0` means the script tag is not present).

- [ ] **Step 3: Build with the flag on and confirm the script is present**

Run: `cd frontend && EXPO_PUBLIC_ADS_ENABLED=true npm run build && grep -c "pagead2.googlesyndication.com" dist/index.html`
Expected: `1`.

- [ ] **Step 4: Re-run the default build so the working tree matches what actually ships without a Vercel env var set (i.e., disabled)**

Run: `cd frontend && npm run build`
Expected: succeeds; this just resets `dist/` to the disabled-by-default state — `dist/` isn't committed (confirm it's covered by `.gitignore` before moving on: `git check-ignore frontend/dist/index.html` should print that path — checking the bare `frontend/dist` directory path instead can print nothing even when the directory *is* ignored, since git's directory-pattern matching behaves differently for a path with no file component).

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/+html.tsx
git commit -m "feat: inject AdSense auto-ads script gated by EXPO_PUBLIC_ADS_ENABLED"
```

---

### Task 4: Add the privacy policy page and link it from Profile

**Files:**
- Create: `frontend/app/privacy.tsx`
- Modify: `frontend/app/profile.tsx` (add a link near the bottom, after the existing "Sign Out" button)

**Interfaces:**
- Consumes: `colors`, `typography` from `@/constants/design` (same tokens `profile.tsx` already uses: `colors.cream`, `colors.ink`, `colors.amber`, `colors.dune`, `colors.parchment`); `ArrowLeft` from `lucide-react-native`; `router` from `expo-router`.
- Produces: the route `/privacy`, pushed to via `router.push('/privacy')` from `profile.tsx`. This is the URL the user pastes into AdSense's "Privacy & messaging" consent tool once deployed — no other task in this plan depends on it, but it's the last piece of the account-side checklist.

- [ ] **Step 1: Create `frontend/app/privacy.tsx`**

```tsx
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

const H_PADDING = 24;

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text
        style={{
          ...typography.label,
          color: colors.amber,
          fontSize: 11,
          letterSpacing: 2,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
        {children}
      </Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, marginBottom: 4 }}>
          Privacy Policy
        </Text>
        <Text style={{ color: colors.dune, fontSize: 12, marginBottom: 28 }}>
          Last updated: August 4, 2026
        </Text>

        <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 24 }}>
          SipSync ("we," "us," the "App") is a party game played with friends in the
          same room, each on their own phone. This explains what limited data we
          handle and how third-party services work when you use the web version at
          quicklegame.com.
        </Text>

        <Section title="What we don't collect">
          No account, email, phone number, or login is required. There's no sign-up.
        </Section>

        <Section title="What we do collect">
          A random, anonymous device identifier (UUID) stored locally on your
          device, used only to identify you within a room you join — not tied to
          your real identity. A display name and avatar/vibe icon you choose,
          visible only to other players in your room. Room and gameplay data (room
          codes, scores, game actions), held temporarily on our servers only for
          the duration of an active room, not permanently stored.
        </Section>

        <Section title="Advertising">
          The web version shows ads served by Google AdSense. Google and its
          partners may use cookies or similar technologies to serve ads based on
          your visits to this and other sites. You can review your ad
          personalization choices via Google's Ads Settings
          (adssettings.google.com) or the consent banner shown on this site. See
          Google's policy at policies.google.com/technologies/partner-sites for
          details.
        </Section>

        <Section title="Analytics">
          We use Vercel Web Analytics and Speed Insights to understand aggregate,
          anonymized traffic and performance; no personally identifying data is
          collected through this.
        </Section>

        <Section title="Children">
          SipSync is a drinking game intended for adults. It is not directed at
          children, and we do not knowingly collect data from children.
        </Section>

        <Section title="Data retention">
          Because there are no accounts, most data (room state, scores) is
          discarded once a room ends. Your locally-stored device ID persists only
          on your device until app storage is cleared.
        </Section>

        <Section title="Changes">
          We may update this policy occasionally; the "last updated" date above
          reflects the most recent change.
        </Section>

        <Section title="Contact">
          Questions about this policy: giladshavit1@gmail.com
        </Section>
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 2: Link it from `frontend/app/profile.tsx`**

In `frontend/app/profile.tsx`, the file currently ends its main `ScrollView` content with the "Sign Out" `Pressable` (the last element before `</ScrollView>`). Add a text link directly after that `Pressable` closes, still inside the `ScrollView`:

```tsx
        <Pressable
          onPress={() => router.push('/privacy')}
          style={{ marginTop: 20, alignItems: 'center' }}
          className="active:opacity-60"
        >
          <Text style={{ color: colors.dune, fontSize: 12, textDecorationLine: 'underline' }}>
            Privacy Policy
          </Text>
        </Pressable>
```

This goes right after the closing `</Pressable>` of the existing "Sign Out" button and before the `</ScrollView>` tag. No new imports are needed — `router`, `Pressable`, `Text`, and `colors` are all already imported in this file.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build and confirm the route exists in the export**

Run: `cd frontend && npm run build && ls dist/privacy.html`
Expected: the file exists (Expo Router's static web export produces one HTML file per route).

- [ ] **Step 5: Manual visual check**

Run: `cd frontend && npx expo start --web`, open the app in a browser, navigate to the Profile screen (top-right button on the home screen), confirm the "Privacy Policy" link is visible below Sign Out and tapping it opens `/privacy` showing all seven sections with readable formatting, and the back arrow returns to Profile.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/privacy.tsx frontend/app/profile.tsx
git commit -m "feat: add privacy policy page and link from profile"
```

---

## After this plan ships (not code — handed to the user)

Once all four tasks are merged and deployed to production with `EXPO_PUBLIC_ADS_ENABLED` still unset (i.e., ads off), the user:

1. Sets `EXPO_PUBLIC_ADS_ENABLED=true` in Vercel's dashboard, scoped to the **Production** environment only, and triggers a redeploy.
2. Confirms `https://www.quicklegame.com/ads.txt` returns the plain-text line (not the SPA shell) and `view-source:https://www.quicklegame.com/` contains the `pagead2.googlesyndication.com` script tag.
3. Goes back to the AdSense "Sites" verification screen for `quicklegame.com`, checks "הזנתי את הקוד," and clicks "בצע אימות."
4. Once verified, enables Vignette (Auto ads) for the site.
5. Enables Privacy & messaging, pointing it at `https://www.quicklegame.com/privacy`.
6. Waits roughly a day for Google's crawler to start actually serving ads — no ads yet immediately after this is expected, not a bug.
