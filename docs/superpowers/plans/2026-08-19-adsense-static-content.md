# AdSense Static Rendering + Content Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quicklegame.com serve real, crawlable HTML on every content page so AdSense's "low value content" rejection can be appealed — without breaking the live `/room/<code>` flow.

**Architecture:** Switch the Expo web export from SPA (`single`) to static rendering; move head tags from a post-build injection script into `app/+html.tsx` + per-page `expo-router/head` Heads; restructure the home screen so content renders without an identity gate; add `/about` + `/terms`; replace the Vercel catch-all rewrite with per-dynamic-route rewrites over bracket-free renamed files.

**Tech Stack:** Expo SDK 52 / expo-router 4 static export, react-helmet-style `expo-router/head`, NativeWind classes + `constants/design.ts` tokens, Vercel static hosting.

**Spec:** `docs/superpowers/specs/2026-08-19-adsense-static-content-design.md` · **Issue:** #113

## Global Constraints

- Icons: `lucide-react-native` only; no emoji glyphs anywhere in UI.
- Typography: `typography.title` / `typography.label` from `frontend/constants/design.ts`; never monospace for UI text.
- Colors: use `colors.*` tokens (`cream #FFF8E1`, `ink #0A0A0F`, `amber #F59E0B`, `dune #A8977A`).
- No new REST endpoints (contact = mailto). No backend changes.
- Core engine files untouched. TypeScript strict; no `any`.
- No commented-out code in commits; conventional commit messages.
- All temp files in the session scratchpad, not `/tmp`.
- There is no jest suite in `frontend/` — the automated test layer for this work is `scripts/post-export.mjs`'s content tripwire (fails the build when exported HTML loses its content) plus `npx tsc --noEmit`.

---

### Task 1: Static export foundation

**Files:**
- Modify: `frontend/app.json` (web block)
- Create: `frontend/app/+html.tsx`
- Modify: `frontend/app/_layout.tsx` (default `<Head>`)
- Modify: `frontend/app/games/[id]/index.tsx`, `frontend/app/games/[id]/tutorial.tsx` (add `generateStaticParams`)
- Create: `frontend/scripts/post-export.mjs`
- Delete: `frontend/scripts/inject-head-tags.mjs`
- Modify: `frontend/package.json` (build script)

**Interfaces:**
- Produces: `scripts/post-export.mjs` with an exported-in-file `CHECKS` array of `{ file: string, mustContain: string[] }` — later tasks append entries. Dist bracket segments renamed `[x]` → `_x_` (Task 5's vercel.json relies on `_code_` / `_id_` names).

- [ ] **Step 1: Write the tripwire script first** — `frontend/scripts/post-export.mjs`:

```js
// Post-export step for the static web build (web.output: "static").
// 1. Renames bracket route segments ([code] -> _code_) so vercel.json
//    rewrites never depend on how Vercel parses literal brackets.
// 2. Copies +not-found.html to 404.html (Vercel serves 404.html natively).
// 3. Content tripwire: static rendering is the whole point of this build —
//    if a route ships an empty shell again (e.g. someone reverts web.output
//    or a render-time browser-global sneaks in), fail the build loudly.
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const CHECKS = [
  { file: 'games.html', mustContain: ['Speed', 'Luck', 'Strategy'] },
  { file: 'games/reflex.html', mustContain: ['tap as fast as you can'] },
  { file: 'privacy.html', mustContain: ['Privacy Policy', 'What we don’t collect'] },
];

function renameBracketSegments(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) renameBracketSegments(from);
    const safe = entry.name.replace(/\[(.+)\]/, '_$1_');
    if (safe !== entry.name) renameSync(from, join(dir, safe));
  }
}
renameBracketSegments(DIST);

const notFound = join(DIST, '+not-found.html');
if (existsSync(notFound)) copyFileSync(notFound, join(DIST, '404.html'));

const failures = [];
for (const { file, mustContain } of CHECKS) {
  const path = join(DIST, file);
  if (!existsSync(path)) {
    failures.push(`${file}: missing from dist/`);
    continue;
  }
  const html = readFileSync(path, 'utf8');
  for (const needle of mustContain) {
    if (!html.includes(needle)) failures.push(`${file}: expected text not in exported HTML: "${needle}"`);
  }
}
if (failures.length) {
  console.error('post-export tripwire failed:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log('post-export: bracket segments renamed, 404.html placed, content tripwire passed');
```

(Note: `What we don’t collect` uses the curly apostrophe — copy it exactly; that's how React escapes render it. If the grep in Step 7 shows the exported HTML uses `&#x27;`-style entities instead, match on a needle without an apostrophe, e.g. `No account, email, phone number`.)

- [ ] **Step 2: `frontend/app.json`** — in the `"web"` block add static output:

```json
"web": {
  "favicon": "./assets/favicon.png",
  "output": "static"
}
```

- [ ] **Step 3: Create `frontend/app/+html.tsx`** (static mode uses this as the HTML shell; SPA mode ignored it — that's why the old inject script existed):

```tsx
import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Static-export HTML shell. Global, page-independent tags only — titles,
// descriptions and og/social tags live in React (<Head>) so pages can
// override them; helmet dedupes those by tag identity, while anything
// written here is baked in verbatim on every page.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets layout extend under the iPhone notch /
            home-indicator; safe-area-context's web env() insets need it. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <ScrollViewStyleReset />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* Pre-hydration paint: cream matches the app, not browser white. */}
        <style dangerouslySetInnerHTML={{ __html: 'html, body { background-color: #FFF8E1; }' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Default `<Head>` in `frontend/app/_layout.tsx`** — add `import Head from 'expo-router/head';` and render as the first child inside `<SafeAreaProvider>`:

```tsx
{/* Site-wide defaults; content pages override title/description with
    their own <Head> (helmet dedupes by tag identity, deepest wins). */}
<Head>
  <title>Quickle — The Party Drinking Game</title>
  <meta
    name="description"
    content="Join a room from your phone and battle your friends in fast mini-games. Loser drinks."
  />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Quickle" />
  <meta property="og:title" content="Quickle — The Party Drinking Game" />
  <meta
    property="og:description"
    content="Join a room from your phone and battle your friends in fast mini-games. Loser drinks."
  />
  <meta property="og:url" content="https://www.quicklegame.com/" />
  <meta property="og:image" content="https://www.quicklegame.com/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Quickle — The Party Drinking Game" />
  <meta
    name="twitter:description"
    content="Join a room from your phone and battle your friends in fast mini-games. Loser drinks."
  />
  <meta name="twitter:image" content="https://www.quicklegame.com/og-image.png" />
</Head>
```

- [ ] **Step 5: `generateStaticParams` on both game routes.** In `frontend/app/games/[id]/index.tsx` add `GAME_CATALOG` to the existing `@/constants/games` import, and in **both** that file and `frontend/app/games/[id]/tutorial.tsx` add above the default export:

```tsx
// Static export: prerender a real HTML page per catalog game.
export function generateStaticParams(): { id: string }[] {
  return GAME_CATALOG.map((g) => ({ id: g.id }));
}
```

(`tutorial.tsx` — check its imports; add `GAME_CATALOG` there too if absent.)

- [ ] **Step 6: Swap the build pipeline.** `git rm frontend/scripts/inject-head-tags.mjs`; in `frontend/package.json`:

```json
"build": "expo export --platform web --clear && node scripts/post-export.mjs",
```

- [ ] **Step 7: Verify.** `cd frontend && npm run build` → expect success + tripwire pass. Then `find dist -name '*.html' | sort` — expect `index.html`, `games.html`, 15 `games/<id>.html`, `games/_id_.html`, `games/<id>/tutorial.html`, `privacy.html`, `room/_code_.html`, `room/_code_/lobby.html` (+ 7 more room screens), `onboarding.html`, `profile.html`. Adjust Task 5's rewrites if names differ. Spot-check: `grep -c 'og:image' dist/index.html` ≥ 1, `grep -o '<title>[^<]*' dist/games/reflex.html`.

- [ ] **Step 8: Commit** — `feat: switch web export to static rendering with head shell and content tripwire`

---

### Task 2: Per-page heads + InfoPage extraction + crawlable game links

**Files:**
- Create: `frontend/components/InfoPage.tsx`
- Modify: `frontend/app/privacy.tsx` (refactor onto InfoPage — content byte-identical)
- Modify: `frontend/app/games/index.tsx` (Head + `Link` cards)
- Modify: `frontend/app/games/[id]/index.tsx`, `frontend/app/games/[id]/tutorial.tsx` (Heads)
- Modify: `frontend/app/index.tsx` (canonical-only Head)

**Interfaces:**
- Produces: `InfoPage({ metaTitle, metaDescription, canonicalPath, heading, lastUpdated?, intro?, children })` and `Section({ title, children })` — Tasks 4's about/terms consume these exact props.

- [ ] **Step 1: Create `frontend/components/InfoPage.tsx`** — lift the scaffold + `Section` out of `privacy.tsx` verbatim (back button, ScrollView, heading typography), add a `<Head>`:

```tsx
import type { ReactNode } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';

const SITE = 'https://www.quicklegame.com';
const H_PADDING = 24;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text
        style={{ ...typography.label, color: colors.amber, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}
      >
        {title}
      </Text>
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

interface InfoPageProps {
  metaTitle: string;
  metaDescription: string;
  canonicalPath: string;
  heading: string;
  lastUpdated?: string;
  intro?: string;
  children: ReactNode;
}

// Shared scaffold for the static info pages (/privacy, /about, /terms):
// same back button, heading treatment and Section rhythm on all three, and
// a per-page <Head> so each exports its own title/description/canonical.
export function InfoPage({ metaTitle, metaDescription, canonicalPath, heading, lastUpdated, intro, children }: InfoPageProps) {
  useWebPageBackground(colors.cream);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Head>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={`${SITE}${canonicalPath}`} />
      </Head>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
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
          {heading}
        </Text>
        {lastUpdated && (
          <Text style={{ color: colors.dune, fontSize: 12, marginBottom: 28 }}>
            Last updated: {lastUpdated}
          </Text>
        )}
        {intro && (
          <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 24, marginTop: lastUpdated ? 0 : 20 }}>
            {intro}
          </Text>
        )}
        {children}
      </ScrollView>
    </View>
  );
}
```

- [ ] **Step 2: Refactor `frontend/app/privacy.tsx`** to `InfoPage` — the file becomes the eight `<Section>`s wrapped in:

```tsx
<InfoPage
  metaTitle="Privacy Policy — Quickle"
  metaDescription="What limited data Quickle handles: no accounts, an anonymous device ID, transient room state, and how AdSense and analytics work on quicklegame.com."
  canonicalPath="/privacy"
  heading="Privacy Policy"
  lastUpdated="August 4, 2026"
  intro={'SipSync ("we," "us," the "App") is a party game played with friends in the same room, each on their own phone. This explains what limited data we handle and how third-party services work when you use the web version at quicklegame.com.'}
>
```

Every `<Section>` body stays byte-identical to the current file. Delete the now-unused local `Section`, imports, and scaffold.

- [ ] **Step 3: `frontend/app/games/index.tsx`** — add `Head` import and, inside the returned root `<View>`, before the ScrollView:

```tsx
<Head>
  <title>All 15 Party Drinking Games — Quickle</title>
  <meta
    name="description"
    content="Browse Quickle's 15 party drinking mini-games — speed, luck and strategy games with full rules, who drinks, and scoring."
  />
  <link rel="canonical" href="https://www.quicklegame.com/games" />
</Head>
```

Then make each game card a real anchor: `import { Link } from 'expo-router';` and wrap the existing card Pressable per game as `<Link href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>` (keep the Pressable + styling as the child; drop its `onPress` navigation since Link handles it). Crawlers only follow `<a href>` — Pressables render as divs.

- [ ] **Step 4: `frontend/app/games/[id]/index.tsx`** — add a Head derived from the catalog (place immediately inside the root View, only when the game resolves):

```tsx
{game && (
  <Head>
    <title>{`${game.title} — Drinking Game Rules | Quickle`}</title>
    <meta
      name="description"
      content={`${game.title}: ${game.tagline}. Full rules, who drinks, and scoring for this Quickle party mini-game.`}
    />
    <link rel="canonical" href={`https://www.quicklegame.com/games/${game.id}`} />
  </Head>
)}
```

(Use the screen's existing resolved-game variable name — it calls `getGameById`; adapt the variable name to what's in the file.)

- [ ] **Step 5: `frontend/app/games/[id]/tutorial.tsx`** — same pattern; title `` `${game.title} Tutorial — Quickle` ``, canonical pointing at the parent rules page `` `https://www.quicklegame.com/games/${game.id}` `` (the tutorial is an animated near-duplicate; canonicalize it to the rules page).

- [ ] **Step 6: `frontend/app/index.tsx`** — add `Head` import + canonical only (title/description come from the layout default):

```tsx
<Head>
  <link rel="canonical" href="https://www.quicklegame.com/" />
</Head>
```

- [ ] **Step 7: Verify.** `cd frontend && npm run build` → tripwire passes; then:
`grep -o '<title>[^<]*' dist/index.html dist/games.html dist/games/reflex.html dist/privacy.html` → four distinct titles, exactly one `<title>` per file (`grep -c '<title>'`). `grep -c 'rel="canonical"' dist/games/reflex.html` → 1. `grep -c '<a href="/games/' dist/games.html` → ≥ 15.

- [ ] **Step 8: Commit** — `feat: per-page titles, descriptions and canonicals; shared InfoPage scaffold; crawlable game links`

---

### Task 3: Home screen — content without the identity gate

**Files:**
- Modify: `frontend/app/index.tsx`
- Create: `frontend/components/HomeWebSections.tsx`
- Modify: `frontend/scripts/post-export.mjs` (append CHECKS)

**Interfaces:**
- Consumes: nothing new. Produces: `<HomeWebSections />` (no props), rendered web-only from home.

**Flow change (flagged in spec §4):** un-onboarded visitors see the landing page instead of being bounced to `/onboarding`; the Create CTA routes them there. `/room/<code>` links keep their own redirect-through-onboarding (`app/room/[code]/index.tsx:52`) — untouched.

- [ ] **Step 1: Restructure `frontend/app/index.tsx`:**
  - Delete the `if (isLoading) return <spinner>` and `if (!isOnboarded) return <Redirect …>` early returns (drop the now-unused `Redirect` import).
  - Top of `handleCreateRoom`:

```tsx
if (!isOnboarded) {
  router.push('/onboarding');
  return;
}
```

  - Create button: `disabled={creating || isLoading}` (identity still resolving → brief disabled state, same visual as today's `disabled:opacity-40`).
  - Join button + `JoinRoomModal`: unchanged — the room route already funnels un-onboarded joiners through onboarding with the code preserved.
  - Profile button: render only when `isOnboarded` (profile screen presumes an identity).
  - Bottom of the ScrollView content (after the error text): `{Platform.OS === 'web' && <HomeWebSections />}` — add `Platform` to the react-native import and import the component.
  - Keep the mascot exactly as is (`pointerEvents="none"` already lets footer links click through it).

- [ ] **Step 2: Create `frontend/components/HomeWebSections.tsx`** — web-only landing content rendered under the CTAs; `Link` anchors for crawlability; design tokens throughout:

```tsx
import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { ChevronRight, Martini, Smartphone, Swords } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { GAME_CATALOG } from '@/constants/games';

const STEPS = [
  {
    Icon: Smartphone,
    title: 'Create a room',
    body: 'One tap makes a room with a 4-letter code. Share the code or the link — friends join from their own phone. No app store, no sign-up.',
  },
  {
    Icon: Swords,
    title: 'Battle in fast mini-games',
    body: 'Reflex taps, bluffs, auctions, dilemmas — 15 quick games picked with smart shuffle so nothing repeats until everything has played.',
  },
  {
    Icon: Martini,
    title: 'Loser drinks',
    body: 'The server is the judge, so nobody wins by having faster Wi-Fi. Losers get a drinking window; what fills your cup is up to you.',
  },
];

const TEASER_COUNT = 6;

// Web-only: the app's home doubles as quicklegame.com's landing page, so
// below the CTAs it carries real, crawlable copy — how the game works, links
// into the rules pages, and a footer. Native home stays just the app UI.
export default function HomeWebSections() {
  return (
    <View style={{ marginTop: 72 }}>
      <Text style={{ ...typography.label, color: colors.amber, fontSize: 12, letterSpacing: 2, marginBottom: 20 }}>
        How it works
      </Text>
      <View style={{ gap: 20, marginBottom: 56 }}>
        {STEPS.map(({ Icon, title, body }) => (
          <View key={title} style={{ flexDirection: 'row', gap: 14 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderWidth: 2,
                borderColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon size={20} color={colors.ink} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>{title}</Text>
              <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, opacity: 0.85 }}>{body}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={{ ...typography.label, color: colors.amber, fontSize: 12, letterSpacing: 2, marginBottom: 20 }}>
        The games
      </Text>
      <View style={{ gap: 12, marginBottom: 16 }}>
        {GAME_CATALOG.slice(0, TEASER_COUNT).map((game) => (
          <Link key={game.id} href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>
            {/* asChild needs a pressable child — a plain View won't navigate */}
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              className="active:opacity-60"
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  backgroundColor: game.accentColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <game.Icon size={18} color={colors.cream} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{game.title}</Text>
                <Text style={{ color: colors.dune, fontSize: 13 }}>{game.tagline}</Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
      <Link href="/games" asChild>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 56 }} className="active:opacity-60">
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>
            See all {GAME_CATALOG.length} games
          </Text>
          <ChevronRight size={16} color={colors.ink} strokeWidth={2} />
        </Pressable>
      </Link>

      <View style={{ borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 24 }}>
        <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>
          Quickle is a free browser-based party drinking game — no downloads, no
          accounts. One phone per player, one shared moment of victory or
          regret. For adults of legal drinking age; please drink responsibly.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, marginBottom: 16 }}>
          <Link href="/games"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Games</Text></Link>
          <Link href="/about"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>About</Text></Link>
          <Link href="/terms"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Terms</Text></Link>
          <Link href="/privacy"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Privacy</Text></Link>
        </View>
        <Text style={{ color: colors.dune, fontSize: 12 }}>© 2026 Quickle</Text>
      </View>
    </View>
  );
}
```

(`/about` and `/terms` don't exist until Task 4 — with typed routes the `Link href` strings won't typecheck until then; that's fine, Task 6 runs the full `tsc` after Task 4. If committing this task must typecheck in isolation, do Task 4's page files first.)

- [ ] **Step 3: Append home CHECKS** in `scripts/post-export.mjs`:

```js
{ file: 'index.html', mustContain: ['How it works', 'Create a room', 'See all 15 games', 'drink responsibly'] },
```

- [ ] **Step 4: Verify.** `npm run build` (expected to fail the tripwire only if Step 1/2 broke rendering; `/about` links are dead pending Task 4 but export fine). `grep -c '<a href="/games/reflex"' dist/index.html` → ≥ 1. Manual: `npm run web`, open `http://localhost:8081` in a private window (fresh identity) → landing renders, no bounce to onboarding; Create → onboarding; complete onboarding → home; Create → lobby.

- [ ] **Step 5: Commit** — `feat: home renders as a real landing page; web-only how-it-works, game links and footer`

---

### Task 4: About, Terms, Not-Found pages

**Files:**
- Create: `frontend/app/about.tsx`, `frontend/app/terms.tsx`, `frontend/app/+not-found.tsx`
- Modify: `frontend/scripts/post-export.mjs` (append CHECKS)

**Interfaces:**
- Consumes: `InfoPage`/`Section` from Task 2 (exact props listed there).

- [ ] **Step 1: `frontend/app/about.tsx`:**

```tsx
import { InfoPage, Section } from '@/components/InfoPage';

export default function AboutScreen() {
  return (
    <InfoPage
      metaTitle="About Quickle — The Party Drinking Game"
      metaDescription="What Quickle is, how a round works, why the server judges every game, and our stance on drinking responsibly."
      canonicalPath="/about"
      heading="About Quickle"
      intro="Quickle is a bring-your-own-device party game: one person makes a room, everyone else joins from their own phone's browser, and the group battles through fast mini-games where the loser drinks. No downloads, no accounts, no setup — the game runs wherever a browser runs."
    >
      <Section title="How a round works">
        The host creates a room and shares its 4-letter code or link. Each round,
        the game picks a mini-game — reflex taps, bluffing, auctions, dilemmas —
        teaches it in a few seconds, and everyone plays simultaneously on their
        own screen. Losers get a short drinking window, scores accumulate, and a
        podium crowns the night's champion. A smart shuffle ensures no game
        repeats until every game has played.
      </Section>
      <Section title="Fair play, judged by the server">
        Every reflex game is timed on the server with per-player clock
        correction, not on your phone — so a faster connection never beats a
        faster hand. Nobody can win by sitting closer to the router.
      </Section>
      <Section title="Drink responsibly">
        Quickle is for adults of legal drinking age. What goes in your cup is
        entirely up to you — water and soft drinks play exactly as well. Know
        your limit, look after your friends, and never drive after drinking.
      </Section>
      <Section title="Who makes Quickle">
        Quickle is built and run independently. It started as a way to make
        game night louder and turned into the site you're reading now.
      </Section>
      <Section title="Contact">
        Questions, feedback, or a game idea: giladshavit1@gmail.com
      </Section>
    </InfoPage>
  );
}
```

- [ ] **Step 2: `frontend/app/terms.tsx`:**

```tsx
import { InfoPage, Section } from '@/components/InfoPage';

export default function TermsScreen() {
  return (
    <InfoPage
      metaTitle="Terms of Use — Quickle"
      metaDescription="The plain-language terms for playing Quickle: age requirements, playing at your own risk, guest accounts, and acceptable use."
      canonicalPath="/terms"
      heading="Terms of Use"
      lastUpdated="August 19, 2026"
      intro="These are the plain-language terms for using Quickle at quicklegame.com. By playing, you agree to them."
    >
      <Section title="Who may play">
        Quickle involves drinking themes and is intended for adults of legal
        drinking age in their jurisdiction. If alcohol is part of your game, you
        are responsible for complying with local law.
      </Section>
      <Section title="Play at your own risk">
        Participation is voluntary. Quickle never requires anyone to consume
        alcohol — every prompt works equally with any drink or none. You are
        solely responsible for what and how much you drink, and we accept no
        liability for harm arising from alcohol consumption during play.
      </Section>
      <Section title="Guest accounts">
        There are no accounts. A random identifier stored on your device stands
        in for you inside a room, alongside the display name you choose. Clear
        your browser storage and it's gone.
      </Section>
      <Section title="Acceptable use">
        Keep it a game: don't harass other players, disrupt rooms you weren't
        invited to, or attempt to break, overload, or reverse the service.
      </Section>
      <Section title="Advertising">
        The web version shows ads served by Google AdSense; the Privacy Policy
        explains the cookies and choices involved.
      </Section>
      <Section title="The service">
        Quickle is provided as-is, free of charge. Rooms are transient: state
        exists only while a room is live. Features may change or the service may
        pause at any time without notice.
      </Section>
      <Section title="Changes">
        We may update these terms; the date above reflects the latest revision.
        Continuing to play after a change means you accept it.
      </Section>
      <Section title="Contact">
        Questions about these terms: giladshavit1@gmail.com
      </Section>
    </InfoPage>
  );
}
```

- [ ] **Step 3: `frontend/app/+not-found.tsx`:**

```tsx
import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';

export default function NotFoundScreen() {
  useWebPageBackground(colors.cream);
  return (
    <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Head>
        <title>Page Not Found — Quickle</title>
      </Head>
      <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, marginBottom: 8 }}>
        Page not found
      </Text>
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 24, textAlign: 'center' }}>
        This page doesn't exist — maybe the room ended, or the link got mangled.
      </Text>
      <Link href="/" asChild>
        <Pressable style={{ backgroundColor: colors.amber, paddingVertical: 16, paddingHorizontal: 32 }} className="active:opacity-75">
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 13 }}>Back to Quickle</Text>
        </Pressable>
      </Link>
    </View>
  );
}
```

- [ ] **Step 4: Append CHECKS** in `scripts/post-export.mjs`:

```js
{ file: 'about.html', mustContain: ['About Quickle', 'Drink responsibly'] },
{ file: 'terms.html', mustContain: ['Terms of Use', 'legal drinking age'] },
```

- [ ] **Step 5: Verify.** `npm run build` → tripwire passes; `ls dist/about.html dist/terms.html dist/404.html`; `grep -o '<title>[^<]*' dist/about.html dist/terms.html` → the two metaTitles.

- [ ] **Step 6: Commit** — `feat: about, terms and not-found pages`

---

### Task 5: Crawler files + Vercel routing

**Files:**
- Create: `frontend/public/robots.txt`, `frontend/public/sitemap.xml`
- Modify: `frontend/vercel.json`
- Modify: `frontend/constants/games.ts:6` (comment only)

**Interfaces:**
- Consumes: Task 1's dist naming (`_code_`/`_id_` renames). Before writing rewrites, re-check `find frontend/dist -name '*.html'` from the latest build and match the actual names.

- [ ] **Step 1: `frontend/public/robots.txt`:**

```
User-agent: *
Disallow: /room/
Disallow: /onboarding
Disallow: /profile
Allow: /

Sitemap: https://www.quicklegame.com/sitemap.xml
```

- [ ] **Step 2: `frontend/public/sitemap.xml`** — the 20 canonical pages (game ids from `GAME_CATALOG` order):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.quicklegame.com/</loc></url>
  <url><loc>https://www.quicklegame.com/games</loc></url>
  <url><loc>https://www.quicklegame.com/games/reflex</loc></url>
  <url><loc>https://www.quicklegame.com/games/tap_race</loc></url>
  <url><loc>https://www.quicklegame.com/games/human_timer</loc></url>
  <url><loc>https://www.quicklegame.com/games/roulette</loc></url>
  <url><loc>https://www.quicklegame.com/games/coin_flip</loc></url>
  <url><loc>https://www.quicklegame.com/games/closest_average</loc></url>
  <url><loc>https://www.quicklegame.com/games/sacrifice</loc></url>
  <url><loc>https://www.quicklegame.com/games/dilemma</loc></url>
  <url><loc>https://www.quicklegame.com/games/majority</loc></url>
  <url><loc>https://www.quicklegame.com/games/minority</loc></url>
  <url><loc>https://www.quicklegame.com/games/strong_point</loc></url>
  <url><loc>https://www.quicklegame.com/games/flying_bomb</loc></url>
  <url><loc>https://www.quicklegame.com/games/twenty_one</loc></url>
  <url><loc>https://www.quicklegame.com/games/auction</loc></url>
  <url><loc>https://www.quicklegame.com/games/black_box</loc></url>
  <url><loc>https://www.quicklegame.com/about</loc></url>
  <url><loc>https://www.quicklegame.com/terms</loc></url>
  <url><loc>https://www.quicklegame.com/privacy</loc></url>
</urlset>
```

- [ ] **Step 3: Replace `frontend/vercel.json`** (drop the catch-all; filesystem + cleanUrls serve the prerendered pages first, rewrites only catch runtime-dynamic paths):

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
    { "source": "/room/:code", "destination": "/room/_code_.html" },
    { "source": "/room/:code/:screen", "destination": "/room/_code_/:screen.html" },
    { "source": "/games/:id", "destination": "/games/_id_.html" },
    { "source": "/games/:id/tutorial", "destination": "/games/_id_/tutorial.html" }
  ]
}
```

- [ ] **Step 4: `frontend/constants/games.ts`** — extend the line-6 keep-in-sync comment: `// create/join, so the catalog lives here. Keep in sync when adding a game` → add `// (and list the new /games/<id> page in public/sitemap.xml).`

- [ ] **Step 5: Verify.** `npm run build`; `ls dist/robots.txt dist/sitemap.xml dist/ads.txt` (public/ files copied); confirm every rewrite destination exists: `ls 'dist/room/_code_.html' 'dist/room/_code_/lobby.html' 'dist/games/_id_.html' 'dist/games/_id_/tutorial.html'`. Cross-check sitemap ids: `grep -o 'games/[a-z_]*' dist/sitemap.xml | sort` vs `ls dist/games/*.html`.

- [ ] **Step 6: Commit** — `feat: robots.txt, sitemap, and per-route Vercel rewrites replacing the SPA catch-all`

---

### Task 6: Full verification + PR

- [ ] **Step 1:** `cd frontend && npx tsc --noEmit` → clean (run after a build so typed-routes types include /about, /terms).
- [ ] **Step 2:** `npm run build` → tripwire green. Review the full dist listing once more against vercel.json.
- [ ] **Step 3:** Serve the real static output: `npx serve dist -l 3123` (accept default config; serve handles cleanUrls-style lookups). Screenshot `/`, `/games`, `/games/reflex`, `/about` via `scripts/screenshot.mjs` (check its usage header first) or manual browser check: pages hydrate, no double-render flash, back buttons work when landing directly.
- [ ] **Step 4:** Regression pass on the live game flow in dev (`npm run web`): create room → lobby → start a round with 2 browser tabs — sockets and room routing untouched by this change, but the export-mode switch is global, so verify once end-to-end.
- [ ] **Step 5:** Push branch, open PR titled `feat: static rendering + real content pages for AdSense re-review`, body first line `Closes #113`, and flag for review: (a) un-onboarded home no longer auto-redirects to /onboarding, (b) vercel.json routing rewrite (production room links), (c) contact email shown on /about (already public on /privacy).
- [ ] **Step 6:** Use superpowers:finishing-a-development-branch. After merge + Vercel deploy: curl `/`, `/games/reflex`, `/robots.txt`, `/sitemap.xml`, `/room/TEST` + one full room flow on production, then request the AdSense re-review in the console.
