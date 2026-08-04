# Production Ads via Google AdSense (Web) — Design

**Status:** Approved (design phase). Not yet implemented.
**Date:** 2026-08-03
**Scope:** `frontend/` (Expo web build only, deployed to Vercel).

## Context

SipSync's web build currently shows a placeholder ("mock") ad overlay at two
moments — lobby entry and podium/round-end — gated by three feature flags in
[`frontend/config/ads.ts`](../../../frontend/config/ads.ts). The overlay
(`MockAdOverlay.tsx`, triggered via `useMockAd.ts`) is a full-screen React
component with a countdown and a "Skip Ad" button we built ourselves. It only
ever fires on `Platform.OS === 'web'` — there is no `ios/`, `android/`, or
`eas.json` in the repo, so no native build exists yet. This design replaces
that mock layer with real Google AdSense **Auto ads (Vignette)** on the web
build. Native (AdMob) is explicitly out of scope until a native build exists.

The user already holds an **approved** Google AdSense account
(publisher ID `pub-6248733928314999`). Production domain is
`https://www.quicklegame.com` (per `CLAUDE.md`'s Deployment & Environments
section — the `sipsync-one.vercel.app` Vercel subdomain also resolves to the
same deployment and is allowed by backend CORS, but the custom domain is the
canonical one). As of this design, dashboard reconnaissance found no site
registered under "Sites" in this AdSense account yet — see the Rollout
section's account-side checklist for the add-site sequencing this implies.

## Why Vignette, not manual ad units

AdSense offers two very different integration models:

1. **Auto ads (Vignette + Anchor)** — one sitewide script; Google's own
   script decides when a full-page interstitial is shown, based on its own
   frequency/timing heuristics. No manual trigger, no manual "skip" UI —
   Google renders and controls the ad's own close affordance.
2. **Manually placed display ad units** — we choose exact placement/timing
   ourselves, but Google's placement policies restrict wrapping a manually
   placed unit in our own full-screen countdown/skip chrome (the current
   mock UX) — that pattern risks a deceptive-placement / accidental-click
   policy violation.

Given the current UX (full-screen, countdown, "Skip Ad") most closely
resembles Vignette's native behavior, and the user prefers Google to own
placement/timing decisions, **this design uses Auto ads / Vignette only**.
Anchor (sticky banner) can be enabled later via the same script/dashboard
toggle with no code change — not built now (YAGNI).

## Architecture

### Remove (pure deletion, not a swap)

- `frontend/config/ads.ts`
- `frontend/hooks/useMockAd.ts`
- `frontend/components/MockAdOverlay.tsx`
- The `useLobbyAd`/`usePodiumAd` call sites and `MockAdOverlay` render calls
  in `frontend/app/room/[code]/lobby.tsx` and
  `frontend/app/room/[code]/podium.tsx`, including their overlay
  positioning/z-index logic.

Nothing in the React tree needs to manually render an ad under Vignette —
Google's script owns that.

### Add

- **Superseded during implementation:** this section originally called for
  `frontend/app/+html.tsx` (Expo Router's custom-document hook) to inject
  the AdSense script into the real initial HTML, on the theory that Google
  prefers that over a client-injected `useEffect` script. That doesn't work
  in this app — `+html.tsx` is only honored when `app.json`'s `web.output`
  is `"static"` or `"server"`, and this app has no `web` key (defaults to
  plain SPA mode), so Expo silently ignores it. Switching `web.output` risks
  the app's dynamic, runtime-resolved routes (`room/[code]/lobby`, etc.).
  The implementation instead injects the script client-side via a small
  component, the same pattern already live in production for Vercel
  Analytics/Speed Insights (`lib/vercelInsights.tsx` + `app/_layout.tsx`).
  See the plan's Task 3 revision note for the full account of what was
  tried and why:
  `docs/superpowers/plans/2026-08-04-production-ads-adsense-implementation.md`.
- **`public/ads.txt`** — a single line
  (`google.com, pub-6248733928314999, DIRECT, f08c47fec0942fa0`). Expo
  copies `frontend/public/` verbatim into the web build output.
- **`frontend/app/privacy.tsx`** (or equivalent route) — hosts a privacy
  policy page. Copy is supplied by the user, not drafted by this plan. Its
  production URL is what gets pasted into AdSense's "Privacy & messaging"
  consent tool.
- A footer/menu link to the privacy page (exact location — footer vs. an
  "About" affordance in the lobby menu — decided during implementation
  based on what UI chrome already exists at that point).

### Open question flagged for implementation (not resolved here)

Google's dashboard "page exclusions" for Auto ads assume distinct,
server-crawlable URLs per page. SipSync's web build is a client-rendered SPA
— `vercel.json`'s catch-all rewrite (`/(.*) → /index.html`) serves the same
shell for every route. It is unverified whether URL-pattern exclusion
reliably keeps Vignette ads off live-gameplay routes (where an interstitial
interrupting a real-time multiplayer round would be disruptive). **Fallback
if dashboard exclusion doesn't work:** mount the AdSense script only while
Expo Router is on an eligible route (Lobby, Podium/results) and unmount it
during active game screens, controlled in our own code instead of relying
on Google's dashboard. This gets verified and resolved during implementation,
not guessed at here.

## Rollout & compliance

- **Environment gate is a policy requirement, not a nice-to-have.** A single
  flag (`EXPO_PUBLIC_ADS_ENABLED`), read by the `AdSenseScript` component
  (see the superseded-approach note above — client-injected, not read in a
  `+html.tsx` that turned out not to work in this app), must be true only
  for the production Vercel deployment. Vercel preview deployments (every
  branch/PR) must never load the live AdSense script — impressions from
  dev/preview traffic risk Google's invalid-traffic enforcement (warnings up
  to account suspension). This single flag replaces the old three-flag
  system in spirit; there's no "lobby ad" vs. "podium ad" distinction left
  to flag separately since Google decides placement.
- **`vercel.json`:** turned out to need no change — also found during
  implementation planning. Vercel serves a matching static file before
  applying any `rewrites`, so the existing catch-all rewrite doesn't affect
  `/ads.txt` at all; the file just needs to exist. (The design originally
  assumed otherwise.)
- **Account-side steps, in order (user's responsibility, not code — a
  checklist will be handed over at implementation time):**
  1. Retrieve the publisher ID for `ads.txt` (available immediately,
     doesn't require a site to be added first).
  2. Under "Sites," add the production domain — as of this design, no site
     has been added to the AdSense account yet, confirmed by checking the
     dashboard. This step is **blocked on the code being deployed first**:
     AdSense verifies the site by finding its own connection-code
     `<script>` snippet live on the domain — the same script tag this
     design puts on the page, now via client-side injection rather than
     `+html.tsx`. So the real order is: deploy the code (flag on) → then
     add the site in AdSense → verification succeeds because the script is
     already live.
  3. Once the site verifies, enable Vignette (optionally Anchor) under
     Auto ads for it.
  4. Enable the Privacy & messaging consent tool once `/privacy` is live,
     and paste its URL in.

## Testing & verification

AdSense has no AdMob-style "test ad unit ID" to swap in for dev — Google's
policy is stricter: never click your own live ads, never generate
impressions from non-production traffic.

- **Local/dev:** `EXPO_PUBLIC_ADS_ENABLED` stays off. Verify only the
  plumbing — the script tag renders correctly in the exported HTML,
  `/privacy` resolves, `/ads.txt` is served as plain text rather than the
  SPA shell — without ever loading Google's real script.
- **Production verification:** after the first real deploy with the flag
  on, Google's crawler needs time (their stated guidance is roughly a day,
  sometimes longer) before ads actually start serving. "Not showing ads
  yet" immediately post-deploy is expected, not a bug. A short dashboard
  checklist (site status, ad balance/frequency settings) will accompany
  implementation to distinguish that from a real integration bug.
- **Regression check:** confirm removing the mock system leaves no dead
  imports and doesn't break `lobby.tsx`/`podium.tsx` layout — this is a
  pure deletion of the overlay and its positioning logic, not a swap.
- **Rollback:** the single env flag doubles as the kill switch — flipping
  it off pulls ads immediately without a code revert.

## Out of scope (explicitly deferred, not forgotten)

- Native AdMob integration — no `ios/`/`android/`/`eas.json` exists yet;
  revisit once/if a native build is planned.
- Anchor ads — same script/dashboard toggle as Vignette, zero code change,
  not enabled now.
- Manually placed AdSense display units — ruled out in favor of Auto ads
  per the "Why Vignette" section above.

## Privacy policy: content & link placement

User has no existing privacy copy and asked for a draft, given the app's
actual data practices. Content below to be dropped into
`frontend/app/privacy.tsx` verbatim (not legal advice — covers the standard
AdSense/GDPR disclosure bases for a no-login, guest-UUID app with AdSense
ads and Vercel Analytics; a lawyer review is worth doing before this is
depended on for compliance in a dispute).

> **Privacy Policy — SipSync (Quickle)**
> _Last updated: [fill in at implementation/deploy time]_
>
> SipSync ("we," "us," the "App") is a party game played with friends in
> the same room, each on their own phone. This explains what limited data
> we handle and how third-party services work when you use the web version
> at quicklegame.com.
>
> **What we don't collect** — No account, email, phone number, or login is
> required. There's no sign-up.
>
> **What we do collect** — A random, anonymous device identifier (UUID)
> stored locally on your device, used only to identify you within a room
> you join — not tied to your real identity. A display name and
> avatar/vibe icon you choose, visible only to other players in your room.
> Room and gameplay data (room codes, scores, game actions), held
> temporarily on our servers only for the duration of an active room, not
> permanently stored.
>
> **Advertising** — The web version shows ads served by Google AdSense.
> Google and its partners may use cookies or similar technologies to serve
> ads based on your visits to this and other sites. You can review your ad
> personalization choices via
> [Google's Ads Settings](https://adssettings.google.com) or the consent
> banner shown on this site. See
> [Google's policy](https://policies.google.com/technologies/partner-sites)
> for details.
>
> **Analytics** — We use Vercel Web Analytics and Speed Insights to
> understand aggregate, anonymized traffic and performance; no personally
> identifying data is collected through this.
>
> **Children** — SipSync is a drinking game intended for adults. It is not
> directed at children, and we do not knowingly collect data from children.
>
> **Data retention** — Because there are no accounts, most data (room
> state, scores) is discarded once a room ends. Your locally-stored device
> ID persists only on your device until app storage is cleared.
>
> **Changes** — We may update this policy occasionally; the "last updated"
> date above reflects the most recent change.
>
> **Contact** — Questions about this policy: [email — confirm which
> address to publish before deploy].

**Link placement:** user asked for "discreet but legal/compliant"
placement, no strong preference. Since this is an Expo app (no persistent
web-style footer chrome across screens), the natural fit is a small text
link inside `frontend/app/profile.tsx` — the existing profile/settings
screen reachable via the top-right button on the home screen (per prior
project notes) — rather than adding new footer chrome to every screen.
Decided here rather than left open for implementation to re-litigate.
