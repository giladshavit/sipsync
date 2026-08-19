# AdSense "Low Value Content" Fix — Static Rendering + Content Pages

**Date:** 2026-08-19 · **Issue:** #113 · **Branch:** `feat/adsense-static-content`

## Problem

AdSense rejected quicklegame.com with "Low value content". Verified root causes:

1. The web build exports in SPA (`"single"`) mode — every URL returns an empty
   `<div id="root"></div>` shell. Google's crawler sees zero text on every page.
2. `vercel.json` rewrites `/(.*)` → `/index.html`, so `robots.txt` and
   `sitemap.xml` don't exist (they return the app shell). `ads.txt` works only
   because Vercel serves real files in `public/` before rewrites.
3. A fresh visitor (including an AdSense human reviewer) is auto-redirected
   from `/` to the onboarding form before seeing any content.
4. All pages share one `<title>`; no per-page descriptions or canonicals.

## Approaches considered

- **A. Full static rendering (`web.output: "static"`)** — every route
  prerendered to real HTML at export. Chosen: fixes the crawler problem at the
  root; the codebase is already SSR-safe (audited: all `window`/`document`/
  `localStorage` usage sits inside effects/handlers — `_layout.tsx`,
  `AdSenseScript`, `useWebPageBackground`, `usePreventLeave`, `useRoomSocket`,
  `secureStorage`, `AudioContext` all safe).
- **B. Keep SPA, hand-write static HTML content pages in `public/`** — zero app
  risk, but the homepage and games pages stay empty to crawlers, which is where
  the review actually looks. Rejected.

## Design

### 1. Static export
- `app.json`: add `"output": "static"` under `expo.web`.
- `app/games/[id]/index.tsx` + `app/games/[id]/tutorial.tsx`: add
  `generateStaticParams()` returning all 15 `GAME_CATALOG` ids → real HTML per
  game rules page.
- `room/[code]/*` stays runtime-dynamic; the export emits `[code]`-named
  fallback HTML files that hydrate client-side.

### 2. Head shell (`app/+html.tsx`) replaces `scripts/inject-head-tags.mjs`
Static mode makes `+html.tsx` the export template, so the post-build injection
hack retires. The shell carries what the script injected: `viewport-fit=cover`,
apple-touch-icon, default description + og/twitter block, plus the cream
`background-color` on body for pre-hydration paint. `package.json` build script
becomes `expo export … && node scripts/post-export.mjs` (see §5).

### 3. Per-page `<Head>` (expo-router/head)
Content pages get real titles, meta descriptions, and canonical links:
home, `/games`, `/games/[id]` (title/description from `GAME_CATALOG`),
`/privacy`, `/about`, `/terms`.

### 4. Content
- **Home** (`app/index.tsx`): the full-screen identity gate goes away. Static
  hero + content render unconditionally; only the CTA area depends on identity
  (spinner while loading). **Flow change, flagged for review:** un-onboarded
  visitors are no longer auto-redirected to `/onboarding`; tapping a CTA routes
  them there instead (one extra tap for brand-new users, and the reviewer/
  crawler sees a landing page instead of a name-entry form). Room links
  (`/room/<code>`) keep their existing redirect-through-onboarding flow.
- **Home additions (web-only, `Platform.OS === 'web'`):** a short "how it
  works" section (3 steps), a games teaser linking to `/games`, and a footer
  with links (Games · About · Terms · Privacy) + an 18+/drink-responsibly
  line. Styling follows `constants/design.ts` (`typography.label`/`.title`,
  cream/ink/amber palette) and Lucide icons only — no new design language.
- **New `/about`** — what Quickle is, how a round works, responsible-drinking
  & 18+ stance, contact (mailto). Modeled on `privacy.tsx`'s layout.
- **New `/terms`** — plain-language terms: 18+/legal drinking age, drink
  responsibly, no liability for misuse, guest accounts, acceptable use.
- `/games` + `/games/[id]` already render full rules content synchronously
  from `GAME_CATALOG` — prerendering makes them crawlable as-is.

### 5. Routing & crawler files
- `public/robots.txt`: allow all, `Disallow: /room/` (transient rooms),
  `Sitemap:` pointer.
- `public/sitemap.xml`: static list — `/`, `/games`, 15 game pages, `/about`,
  `/terms`, `/privacy`. (Hand-maintained; the minigame-scaffold flow adds a
  line when a game lands.)
- `vercel.json`: drop the catch-all; add rewrites mapping `/room/:code` and
  each room sub-route (+ `/games/:id` fallback) to the exported `[param]` HTML
  files. Exact file names taken from the real `dist/` after export.
- `app/+not-found.tsx` → exported and copied to `dist/404.html` by
  `scripts/post-export.mjs` (Vercel serves `404.html` natively).
- `scripts/post-export.mjs` also **fails the build** if `dist/games/reflex.html`
  lacks expected rules text — a tripwire against silent SSR regressions.

### 6. Out of scope
- No AdSense placement changes (`adPlacements.ts`, `AdSenseScript.tsx` untouched).
- No backend changes. No new REST endpoints (contact is a mailto link).
- Requesting the AdSense re-review happens manually after deploy.

## Error handling
- Static export runs the app in Node; any render-time browser-global access
  fails the build loudly at export — caught locally by running `npm run build`.
- Unknown `/games/<id>` falls through to the `[id]` fallback rewrite and the
  screen's own null-game handling; unknown paths get `404.html`.

## Testing / verification
- `npx tsc --noEmit` clean.
- `npm run build` succeeds; grep `dist/` HTML for: home hero text, a game's
  rules line, privacy/about/terms body text.
- Serve `dist/` locally and screenshot home + a game page (`scripts/screenshot.mjs`)
  to confirm hydration still works (no double-render artifacts).
- After merge + Vercel deploy: curl `/`, `/games/reflex`, `/robots.txt`,
  `/sitemap.xml`, `/room/TEST` (expects app shell), then request re-review.
