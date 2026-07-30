# Podium Cinematic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `frontend/app/room/[code]/podium.tsx` into a decluttered, cinematic results screen: symmetric header, expanded center-stage podium, a unified StatsModal replacing ChasersPopup, and a redesigned admin CTA row — without touching the podium animation itself.

**Architecture:** Single-file restructure of `frontend/app/room/[code]/podium.tsx` (all changes live in this one file; no new files, no backend changes). Work proceeds header → modal → body → admin row → cleanup, each task leaving the app in a compiling, visually-verifiable state.

**Tech Stack:** Expo React Native, TypeScript (strict), `react-native-reanimated` (worklets already in use, unchanged), `lucide-react-native` icons, no automated test suite for this screen — verification is manual (`npx expo start` + visual check), matching every other screen in this codebase.

## Global Constraints

- Never modify `PodiumColumn`, `AnimatedScore`, or the tier math (`TIER_HEIGHT`, `TIER_FILL`, `podium`/`podiumOrder`/`maxTier` derivations) — hard constraint from the spec.
- Icons: `lucide-react-native` only, named imports, no `@expo/vector-icons`, no emoji.
- Typography: use `typography.title` (standalone headings) or `typography.label` (everything else) from `frontend/constants/design.ts` — never `fontFamily: 'Courier New'`.
- TypeScript strict mode — no `any`.
- No REST endpoints, no in-process state substituting for Redis (not applicable here — no backend touched).
- Commit style: conventional commits (`feat:`), no `Closes #X` in individual commits (that goes in the PR body only, per this repo's workflow — the PR will read `Closes #57`).
- After all tasks: `npx tsc --noEmit` (run from `frontend/`) must pass with no new errors.

---

## File Map

- **Modify:** `frontend/app/room/[code]/podium.tsx` — every task below touches only this file, in the regions noted per task.

## Interfaces carried across tasks

These are the exact names later tasks depend on — keep them consistent:

- `StatsModal` component: `function StatsModal({ ranked, playerId, rows, totalRows, onDismiss, initialTab }: { ranked: RankedRow[]; playerId: string | null; rows: ChaserRow[]; totalRows: ChaserRow[]; onDismiss: () => void; initialTab: 'scoreboard' | 'drinks' }): JSX.Element`
- `RankedRow` type (new, Task 2): the element type of the existing `ranked` array — `{ pid: string; display_name: string; avatar: string | null; afterScore: number; beforeScore: number; delta: number | null; rank: number; displayScore: number }`. Define it once (Task 2) and reuse (Task 3, Task 5's typecheck).
- State: `showStats` / `setShowStats` (replaces `showChasers`/`setShowChasers`), `statsInitialTab` / `setStatsInitialTab` (drives which tab `StatsModal` opens on).
- Nested drinks-tab type: `DrinksTab = 'round' | 'total'` (replaces `ChasersTab`), scoped inside `StatsModal`.

---

### Task 1: Header — 3-column symmetry + Up Next strip extraction

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx:1042-1207` (the outer `View`/`ScrollView` open and the entire header `Animated.View` block, plus the `ICON_BTN`/`iconRowWidth`/`headerIconCount`/`showChasersBtn` declarations at `:885-896`)

**Interfaces:**
- Consumes: existing `isAdmin`, `nextGame`, `setShowNextGameModal`, `handleSkipGame`, `setConfirmingLeave`, `setShowSharePopup` — all already defined above this block, unchanged.
- Produces: a `setShowStats(true)` call site in the new Stats header button (the state itself is introduced in Task 2 — for this task, temporarily wire it to the existing `setShowChasers(true)` so the button is functional before Task 2 renames things; Task 2 will do a straight find-and-replace of `showChasers`→`showStats`).

- [ ] **Step 1: Remove the width-coupling constants**

Delete these lines (currently `:885-896`):
```ts
  const showChasersBtn = chasersRows.length > 0 || totalChaserRows.length > 0;
  const ICON_BTN = 40;
  const headerIconCount = showChasersBtn ? 3 : 2;
  const iconRowWidth = headerIconCount * ICON_BTN + (headerIconCount - 1) * 8;
```
Keep `chasersRows` and `totalChaserRows` themselves (still needed by the Drinks tab later). Add a local constant just above the JSX `return`, replacing `ICON_BTN`:
```ts
  const HEADER_ICON_BTN = 40;
```

- [ ] **Step 2: Rewrite the header block**

Replace the entire header `Animated.View` (currently the `{/* Header */}` block through the closing of the right-column `View`, i.e. what's currently lines ~1049-1207) with:

```tsx
        {/* Header — three equal-width flex columns so the centered title
            stays geometrically centered regardless of the left column
            holding 1 button and the right column holding 2. */}
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}
        >
          <View style={{ flex: 1, alignItems: 'flex-start' }}>
            <Pressable
              onPress={() => setConfirmingLeave(true)}
              style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: STOP, alignItems: 'center', justifyContent: 'center' }}
              className="active:opacity-60"
            >
              <DoorOpen size={18} color={STOP} strokeWidth={2} />
            </Pressable>
          </View>

          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: MUTED, ...typography.label, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
              Round results
            </Text>
            <Text style={{ color: AMBER, ...typography.title, fontSize: 22, letterSpacing: 3 }}>
              Podium
            </Text>
          </View>

          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setShowSharePopup(true)}
                style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: INK, alignItems: 'center', justifyContent: 'center' }}
                className="active:opacity-60"
              >
                <Share2 size={18} color={INK} strokeWidth={2} />
              </Pressable>

              {/* Stats — always visible (the Scoreboard tab always has
                  content, unlike the old conditional Chasers button). */}
              <Pressable
                onPress={() => setShowChasers(true)}
                style={{ width: HEADER_ICON_BTN, height: HEADER_ICON_BTN, borderWidth: 1.5, borderColor: INK, alignItems: 'center', justifyContent: 'center' }}
                className="active:opacity-60"
              >
                <ListOrdered size={18} color={INK} strokeWidth={2} />
              </Pressable>
            </View>
          </View>
        </Animated.View>

        {/* Up Next — full-width strip, no longer coupled to the header
            icon row's width. Reserves its footprint before nextGameId
            arrives so nothing below jumps once it does. */}
        <View style={{ marginBottom: 20 }}>
          <View style={{ height: UP_NEXT_CARD_HEIGHT }}>
            {nextGame ? (
              <Pressable
                onPress={() => setShowNextGameModal(true)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  borderWidth: 1.5,
                  borderColor: INK,
                  backgroundColor: CARD,
                  paddingHorizontal: 14,
                  alignItems: 'center',
                  gap: 10,
                }}
                className="active:opacity-70"
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: nextGame.accentColor,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <nextGame.Icon size={18} color="#FFFFFF" strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: MUTED }}>
                    Up next
                  </Text>
                  <Text numberOfLines={1} style={{ color: INK, fontSize: 14, fontWeight: '800' }}>
                    {nextGame.title}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <View
                style={{
                  flex: 1,
                  borderWidth: 1.5,
                  borderColor: HAIRLINE,
                  backgroundColor: CARD,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: MUTED }}>
                  Up next
                </Text>
              </View>
            )}
          </View>

          {isAdmin && (
            <Pressable
              onPress={handleSkipGame}
              disabled={!nextGame}
              style={{
                height: UP_NEXT_SKIP_HEIGHT,
                marginTop: 6,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderWidth: 1.5,
                borderColor: INK,
                backgroundColor: nextGame ? AMBER : HAIRLINE,
              }}
              className="active:opacity-70"
            >
              <FastForward size={11} color={INK} strokeWidth={2.5} />
              <Text style={{ color: INK, fontSize: 9, fontWeight: '800', letterSpacing: 1 }} className="uppercase">
                Skip
              </Text>
            </Pressable>
          )}
        </View>
```

- [ ] **Step 3: Add the `ListOrdered` icon import**

In the `lucide-react-native` import at the top of the file, add `ListOrdered` to the named imports:
```ts
import { Award, Check, Copy, Crown, DoorOpen, FastForward, GlassWater, ListOrdered, LogOut, Pencil, Share2, Skull, X } from 'lucide-react-native';
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors. (Pre-existing unrelated errors, if any, are out of scope — only check nothing new appeared referencing `podium.tsx`.)

- [ ] **Step 5: Manual verification**

Run: `cd frontend && npx expo start` and open the podium screen (play a round to reach it, or navigate directly if the dev flow supports it).
Confirm:
- "PODIUM" is centered on screen regardless of the Up Next admin Skip pill showing or not.
- Leave Room (top-left), Share + Stats (top-right) all render at matching size and still trigger their existing popups (Share popup opens; the icon that used to be labeled "Chasers" still opens the old ChasersPopup for now — that's expected until Task 2).
- Up Next strip spans full width, shows placeholder state correctly before `nextGameId` loads, and tapping it still opens `NextGameRulesModal`.

- [ ] **Step 6: Commit**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "feat: symmetric 3-column podium header + full-width Up Next strip"
```

---

### Task 2: StatsModal — rename ChasersPopup, add top-level Scoreboard/Drinks tabs, drop auto-open

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx:189-392` (the `ChasersPopup` function and its surrounding module-scope state) and `:900-925` (the auto-open effect) and `:1424-1426` (the render call site)

**Interfaces:**
- Consumes: `RankedRow` type (define in this task, see Step 1), the `ranked` array already computed in the component body (`:939-954`, unchanged), `chasersRows`/`totalChaserRows` (unchanged), `AvatarCircle`, `AVATAR_COLORS`, `AnimatedScore` (all already imported/defined above).
- Produces: `StatsModal` component per the plan-level Interfaces section above; `showStats`/`setShowStats` state; `statsInitialTab`/`setStatsInitialTab` state.

- [ ] **Step 1: Define `RankedRow` and remove auto-open plumbing**

Just above the `ChasersPopup` function definition (`:189`), delete the module-scope popup-key tracking:
```ts
let lastChasersPopupKey: string | null = null;
```
(No replacement — this variable existed solely to gate the auto-open behavior being removed.)

Add the shared type, right after the existing `interface ChaserRow` declaration:
```ts
interface RankedRow {
  pid: string;
  display_name: string;
  avatar: string | null;
  afterScore: number;
  beforeScore: number;
  delta: number | null;
  rank: number;
  displayScore: number;
}
```

- [ ] **Step 2: Rewrite `ChasersPopup` into `StatsModal`**

Replace the whole `ChasersPopup` function (`:200-392`, from `type ChasersTab = 'round' | 'total';` through the function's closing `}`) with:

```tsx
type DrinksTab = 'round' | 'total';

function StatsModal({
  ranked, playerId, rows, totalRows, onDismiss, initialTab,
}: {
  ranked: RankedRow[];
  playerId: string | null;
  rows: ChaserRow[];
  totalRows: ChaserRow[];
  onDismiss: () => void;
  initialTab: 'scoreboard' | 'drinks';
}) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.85);
  const [topTab, setTopTab] = useState<'scoreboard' | 'drinks'>(initialTab);
  const [drinksTab, setDrinksTab] = useState<DrinksTab>('round');

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    scale.value = withSequence(
      withTiming(1.04, { duration: 220, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 130 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const activeChaserRows = drinksTab === 'round' ? rows : totalRows;
  const topTotalPid = totalRows.length > 0 ? totalRows[0].pid : null;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(10,10,15,0.94)',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
        },
        overlayStyle,
      ]}
    >
      <Pressable
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={onDismiss}
      />
      <Animated.View
        style={[
          {
            backgroundColor: CARD,
            borderWidth: 2,
            borderColor: INK,
            width: 320,
            maxWidth: '88%',
            maxHeight: '74%',
            paddingVertical: 24,
            paddingHorizontal: 22,
            overflow: 'hidden',
          },
          cardStyle,
        ]}
      >
        <Text
          style={{
            fontWeight: '900',
            color: INK,
            fontSize: 24,
            letterSpacing: -0.5,
            textAlign: 'center',
            marginBottom: 16,
          }}
        >
          Stats
        </Text>

        {/* Top-level tabs */}
        <View
          style={{
            flexDirection: 'row',
            borderWidth: 1.5,
            borderColor: INK,
            marginBottom: 16,
          }}
        >
          <Pressable
            onPress={() => setTopTab('scoreboard')}
            style={{
              flex: 1,
              paddingVertical: 9,
              alignItems: 'center',
              backgroundColor: topTab === 'scoreboard' ? INK : 'transparent',
            }}
            className="active:opacity-70"
          >
            <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 1.5, color: topTab === 'scoreboard' ? CARD : MUTED }}>
              Scoreboard
            </Text>
          </Pressable>
          <View style={{ width: 1.5, backgroundColor: INK }} />
          <Pressable
            onPress={() => setTopTab('drinks')}
            style={{
              flex: 1,
              paddingVertical: 9,
              alignItems: 'center',
              backgroundColor: topTab === 'drinks' ? INK : 'transparent',
            }}
            className="active:opacity-70"
          >
            <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 1.5, color: topTab === 'drinks' ? CARD : MUTED }}>
              Drinks
            </Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {topTab === 'scoreboard' ? (
            <View style={{ gap: 10 }}>
              {ranked.map((row) => {
                const isMe = row.pid === playerId;
                const isTop = row.rank === 1;
                return (
                  <View
                    key={row.pid}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: isMe ? ME_BG : BG,
                      borderWidth: 1,
                      borderColor: isMe ? AMBER : HAIRLINE,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        marginRight: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isTop ? AMBER : 'transparent',
                        borderWidth: isTop ? 0 : 1,
                        borderColor: HAIRLINE,
                      }}
                    >
                      <Text style={{ ...typography.label, fontWeight: '700', fontSize: 12, color: isTop ? INK : MUTED }}>
                        {row.rank}
                      </Text>
                    </View>
                    <View style={{ marginRight: 10 }}>
                      <AvatarCircle
                        name={row.display_name}
                        avatar={row.avatar}
                        size={30}
                        ringColor={isMe ? AMBER : row.avatar ? AVATAR_COLORS[row.avatar] : HAIRLINE}
                      />
                    </View>
                    <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 14, fontWeight: '600', marginRight: 8 }}>
                      {row.display_name}{isMe ? ' (you)' : ''}
                    </Text>
                    {row.delta != null && row.delta !== 0 && (
                      <View
                        style={{
                          backgroundColor: row.delta > 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.10)',
                          paddingHorizontal: 7,
                          paddingVertical: 3,
                          marginRight: 8,
                        }}
                      >
                        <Text style={{ color: row.delta > 0 ? GO : STOP, fontSize: 11, fontWeight: '700' }}>
                          ({row.delta > 0 ? '+' : '−'}{Math.abs(row.delta)})
                        </Text>
                      </View>
                    )}
                    <Text style={{ color: INK, fontSize: 16, fontWeight: '800', minWidth: 28, textAlign: 'right' }}>
                      {row.displayScore}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  borderWidth: 1.5,
                  borderColor: HAIRLINE,
                  marginBottom: 14,
                }}
              >
                <Pressable
                  onPress={() => setDrinksTab('round')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: drinksTab === 'round' ? HAIRLINE : 'transparent',
                  }}
                  className="active:opacity-70"
                >
                  <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: drinksTab === 'round' ? INK : MUTED }}>
                    This Round
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDrinksTab('total')}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    alignItems: 'center',
                    backgroundColor: drinksTab === 'total' ? HAIRLINE : 'transparent',
                  }}
                  className="active:opacity-70"
                >
                  <Text style={{ ...typography.label, fontSize: 9, letterSpacing: 1.5, color: drinksTab === 'total' ? INK : MUTED }}>
                    Total
                  </Text>
                </Pressable>
              </View>

              {activeChaserRows.length === 0 ? (
                <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 16 }}>
                  Nobody&apos;s owed a single chaser yet.
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {activeChaserRows.map((row) => {
                    const isTopTotal = drinksTab === 'total' && row.pid === topTotalPid;
                    return (
                      <View
                        key={row.pid}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingHorizontal: 12,
                          backgroundColor: isTopTotal ? 'rgba(220,38,38,0.07)' : BG,
                          borderWidth: isTopTotal ? 1.5 : 1,
                          borderColor: isTopTotal ? STOP : HAIRLINE,
                          gap: 10,
                        }}
                      >
                        <AvatarCircle
                          name={row.name}
                          avatar={row.avatar}
                          size={30}
                          ringColor={row.avatar ? AVATAR_COLORS[row.avatar] : STOP}
                        />
                        <Text numberOfLines={1} style={{ flex: 1, color: INK, fontSize: 15, fontWeight: '700' }}>
                          {row.name}
                        </Text>
                        {isTopTotal && <Skull size={15} color={STOP} strokeWidth={2.5} />}
                        {drinksTab === 'total' ? (
                          <>
                            <Text style={{ color: STOP, fontSize: 16, fontWeight: '900' }}>×{row.chasers}</Text>
                            <GlassWater size={16} color={STOP} strokeWidth={2.5} />
                          </>
                        ) : (
                          <>
                            <GlassWater size={16} color={STOP} strokeWidth={2.5} style={{ marginRight: 6 }} />
                            <Text style={{ color: STOP, fontSize: 15, fontWeight: '800' }}>{row.chasers}</Text>
                          </>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <Pressable
          onPress={onDismiss}
          style={{ marginTop: 20, backgroundColor: AMBER, paddingVertical: 13, alignItems: 'center' }}
          className="active:opacity-80"
        >
          <Text className="text-ink text-sm font-bold tracking-[0.15em] uppercase">Got it</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
```

- [ ] **Step 3: Remove the auto-open effect and rename state**

Delete the auto-open effect block (currently `:903-914`):
```ts
  const CHASERS_POPUP_DELAY_MS = 3500;

  const [showChasers, setShowChasers] = useState(false);
  useEffect(() => {
    if (chasersRows.length === 0 || lastChasersPopupKey === allOutcomesJson) return;
    const timer = setTimeout(() => {
      lastChasersPopupKey = allOutcomesJson;
      setShowChasers(true);
    }, CHASERS_POPUP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Replace with plain state (no effect, no delay, no auto-open):
```ts
  const [showStats, setShowStats] = useState(false);
  const [statsInitialTab, setStatsInitialTab] = useState<'scoreboard' | 'drinks'>('scoreboard');
```

- [ ] **Step 4: Update the header button and render call site**

In the header's Stats `Pressable` added in Task 1, change:
```tsx
onPress={() => setShowChasers(true)}
```
to:
```tsx
onPress={() => { setStatsInitialTab('scoreboard'); setShowStats(true); }}
```

At the bottom render section (currently `:1424-1426`):
```tsx
      {showChasers && (
        <ChasersPopup rows={chasersRows} totalRows={totalChaserRows} onDismiss={() => setShowChasers(false)} />
      )}
```
replace with:
```tsx
      {showStats && (
        <StatsModal
          ranked={ranked}
          playerId={playerId}
          rows={chasersRows}
          totalRows={totalChaserRows}
          initialTab={statsInitialTab}
          onDismiss={() => setShowStats(false)}
        />
      )}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `ChasersPopup`, `showChasers`, `ChasersTab`, or `lastChasersPopupKey` (all should be gone). Fix any straggler references.

- [ ] **Step 6: Manual verification**

Run the app, reach the podium screen after a round where at least one player owes chasers.
Confirm:
- No popup appears automatically on arrival (wait at least 5 seconds).
- Tapping the header Stats button opens the modal on the SCOREBOARD tab, showing every player ranked with rank chip, avatar, name, delta pill (once the before→after phase settles), and score.
- Switching to DRINKS shows the same THIS ROUND / TOTAL sub-tab behavior as the old ChasersPopup, including the empty-state copy and the top-total Skull accent on the TOTAL tab.
- "Got it" and the outside-tap both dismiss the modal.

- [ ] **Step 7: Commit**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "feat: replace ChasersPopup with unified StatsModal, drop auto-open"
```

---

### Task 3: Body — remove inline ranked list, expand podium to center stage

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx` — the outer `View`/`ScrollView` wrapper (currently `:1043-1047` and its closing `</ScrollView>` at `:1422`), the podium/baseline/phase-caption block (currently `:1209-1254`), and the ranked-list `.map()` block (currently `:1256-1359`, to be deleted — its markup already lives in `StatsModal` from Task 2)

**Interfaces:**
- Consumes: `podium`, `podiumOrder`, `maxTier`, `playerId`, `phase` (all unchanged from earlier in the component), `PodiumColumn` (unchanged).
- Produces: nothing new consumed by later tasks — this task's only downstream dependency is Task 5's cleanup pass confirming no dead code remains.

- [ ] **Step 1: Replace the outer scroll container with a flex column**

Change:
```tsx
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
```
to:
```tsx
    <View style={{ flex: 1, backgroundColor: BG, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 32 }}>
```
And remove the matching `</ScrollView>` (keep the outer `</View>` — it now closes this same container). `ScrollView` remains imported/used elsewhere in the file (inside `StatsModal` and `NextGameRulesModal`), so leave the import in place.

- [ ] **Step 2: Delete the ranked-list block**

Delete the entire block from the `{/* Full ranked list — replays the before → after movement for everyone */}` comment through its closing `})}` (currently `:1256-1359`). This markup is not lost — it was ported into `StatsModal`'s SCOREBOARD tab in Task 2.

- [ ] **Step 3: Wrap podium + baseline + phase caption in a centered flex-1 stage**

Replace the block currently spanning from `{/* Podium — final standings, on screen from the start */}` through the phase-caption `Text` (currently `:1209-1254`) with:

```tsx
        {/* Podium — the untouched animated visualization, now the
            screen's center-stage focus with room to breathe on all sides. */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {podium.length > 0 && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: 10,
                marginBottom: 12,
              }}
            >
              {podiumOrder.map((p) => (
                <PodiumColumn
                  key={p.pid}
                  name={p.display_name}
                  avatar={p.avatar}
                  score={phase === 'before' ? p.beforeScore : p.afterScore}
                  tier={p.tier}
                  isMe={p.pid === playerId}
                  delayMs={(maxTier - p.tier) * 180}
                />
              ))}
            </View>
          )}

          {podium.length > 0 && (
            <View style={{ height: 2, width: 220, backgroundColor: INK, marginBottom: 10 }} />
          )}

          <Text
            style={{
              color: MUTED,
              ...typography.label,
              fontSize: 10,
              letterSpacing: 3,
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            {phase === 'before' ? 'Before this round' : 'After this round'}
          </Text>
        </View>
```

(Note the baseline rule is now `width: 220` instead of full-width, since it's centered under the podium rather than spanning a list above.)

- [ ] **Step 4: Fix the admin-block entrance delay**

The admin action block's `entering={FadeInDown.delay(ranked.length * 60 + 100).duration(350)}` (just after the deleted list) was timed to stagger in after the last list row's own `FadeInDown.delay(index * 60)`. With the list gone from the main screen, change it to a fixed delay:
```tsx
          entering={FadeInDown.delay(300).duration(350)}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. In particular confirm `ranked` is still referenced (it's now only consumed via the `StatsModal` prop from Task 2, not rendered directly on this screen) — TypeScript won't flag this as unused since it's still passed as a prop, but double check there's no "declared but never read" lint warning either.

- [ ] **Step 6: Manual verification**

Run the app, reach the podium screen.
Confirm:
- The screen no longer scrolls (or scrolls only if content genuinely overflows a very small device — the common case is a static screen).
- The podium sits roughly vertically centered in the remaining space between the Up Next strip and the admin action block, with visible breathing room on both sides.
- The before→after phase caption still updates correctly under the podium in sync with the podium's own score tick (same `REVEAL_DELAY_MS` timing as before).
- No leftover per-row list renders anywhere on the main screen.

- [ ] **Step 7: Commit**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "feat: delete inline leaderboard list, expand podium to center stage"
```

---

### Task 4: Admin action block redesign

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx` — the admin action block (currently `:1361-1421`, i.e. the `isAdmin ? (...) : (...)` conditional inside the `Animated.View` from Task 3 Step 4)

**Interfaces:**
- Consumes: `isAdmin`, `setGamesSheetMode`, `handleNextRound`, `setConfirmingEndNight` — all unchanged, defined earlier in the component.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the single admin row with a two-row layout**

Replace the `isAdmin ? (` branch's JSX (the `<View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>...</View>` block) with:

```tsx
            <View style={{ gap: 10 }}>
              {/* Secondary actions — a tweak and an exit, styled as clearly
                  tappable outlined buttons (not the old dim/disabled-looking
                  icon squares) side-by-side to save vertical space. */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setGamesSheetMode('edit')}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    height: 52,
                    borderWidth: 2,
                    borderColor: INK,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                  className="active:opacity-60"
                >
                  <Pencil size={16} color={INK} strokeWidth={2} />
                  <Text style={{ ...typography.label, fontSize: 11, letterSpacing: 1.5, color: INK }}>
                    Edit Games
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setConfirmingEndNight(true)}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    height: 52,
                    borderWidth: 2,
                    borderColor: INK,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                  className="active:opacity-60"
                >
                  <LogOut size={16} color={INK} strokeWidth={2} />
                  <Text style={{ ...typography.label, fontSize: 11, letterSpacing: 1.5, color: INK }}>
                    End Night
                  </Text>
                </Pressable>
              </View>

              {/* Next Round — the unmistakable primary CTA: full-width,
                  taller than the secondary row, amber with a soft glow. */}
              <Pressable
                onPress={handleNextRound}
                style={{
                  height: 64,
                  backgroundColor: AMBER,
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: AMBER,
                  shadowOpacity: 0.4,
                  shadowRadius: 14,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 8,
                }}
                className="active:opacity-80"
              >
                <Text className="text-ink text-base font-bold tracking-[0.2em] uppercase">
                  Next Round
                </Text>
              </Pressable>
            </View>
```

Leave the `) : (` non-admin branch (`Waiting for host…`) untouched.

- [ ] **Step 2: Remove the now-unused `ADMIN_ROW_ICON_BTN` constant**

Delete (currently `:64-65`):
```ts
const ADMIN_ROW_ICON_BTN = 56;
```
and its preceding comment block, since both buttons that used it are gone (replaced by the `52`/`64` heights above). Search the file first (`grep -n ADMIN_ROW_ICON_BTN frontend/app/room/\[code\]/podium.tsx`) to confirm no other reference remains before deleting.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the app as the room admin, reach the podium screen.
Confirm:
- Edit Games and End Night render as equal-width outlined buttons with visible icon + label, clearly tappable (not "greyed out").
- Next Round is visually the biggest, most prominent element in that block, with a visible amber glow (check on both iOS simulator and Android emulator if available — `elevation` is the Android fallback for the shadow).
- All three buttons still fire their existing behavior: Edit Games opens `GamesSheet` in edit mode, End Night opens the existing confirmation overlay, Next Round sends `NEXT_ROUND`.
- As a non-admin player, only "Waiting for host…" renders — no admin buttons.

- [ ] **Step 5: Commit**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "feat: redesign podium admin row with glowing Next Round CTA"
```

---

### Task 5: Final cleanup pass + full manual verification

**Files:**
- Modify: `frontend/app/room/[code]/podium.tsx` (spot cleanups only, no new features)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing — this is the plan's terminal task.

- [ ] **Step 1: Grep for dead references**

Run each of these from the repo root and confirm zero matches (aside from this plan/spec doc's own prose, which don't count):
```bash
grep -n "ChasersPopup\|showChasers\|ChasersTab\|lastChasersPopupKey\|CHASERS_POPUP_DELAY_MS\|ICON_BTN\|iconRowWidth\|headerIconCount\|showChasersBtn\|ADMIN_ROW_ICON_BTN" "frontend/app/room/[code]/podium.tsx"
```
If anything matches, remove it — these are all artifacts of the pre-redesign implementation that Tasks 1-4 should have fully replaced.

- [ ] **Step 2: Full typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean pass.

- [ ] **Step 3: Full manual verification pass**

Run the app through a complete round → podium transition (`cd frontend && npx expo start`, then play through at least one mini-game with 2+ players so real score deltas and at least one chaser exist). Confirm the full spec's Testing checklist:
- Header renders symmetrically (PODIUM stays centered) both with and without the admin Skip pill showing under Up Next.
- Podium animation (bar fill, avatar pop, before→after score roll) is pixel-identical to the pre-redesign behavior — no changes to `PodiumColumn`/`AnimatedScore` were made in any task.
- Tapping Stats opens the modal on SCOREBOARD by default; switching to DRINKS preserves its round/total sub-tab behavior and empty states.
- StatsModal never auto-opens on arrival, even when someone owes chasers (wait at least 10 seconds on the screen to confirm).
- Edit Games / End Night / Next Round all fire their existing actions correctly.
- Non-admin players see "Waiting for host…" only.
- Share popup and the Leave/End Night confirmation overlays all still work exactly as before (none of these were modified).

- [ ] **Step 4: Commit (only if Step 1 found anything to remove)**

```bash
cd /Users/giladshavit/Desktop/DrinkApp
git add frontend/app/room/\[code\]/podium.tsx
git commit -m "chore: remove dead code from pre-redesign podium implementation"
```

If Step 1 found nothing, skip this commit — Tasks 1-4 already left the file clean.

---

## After all tasks

Open a PR per this repo's workflow: title in conventional-commit style (e.g. `feat: cinematic podium redesign with unified Stats modal`), body starting with `Closes #57` on the first line, squash-merge into `main`.
