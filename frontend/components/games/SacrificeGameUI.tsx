import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, Image, ScrollView, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  interpolate,
  Easing,
} from 'react-native-reanimated';
import { GlassWater } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';
import { CountdownRing } from './CountdownRing';

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the room resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Every other mini-game plays out in shadow — Sacrifice is the one round
// that's fundamentally social (who steps up is public, not hidden), so it
// borrows the app's light "front door" register (home/podium) instead of
// the dark in-round tones, staged like a room with the lights on.
//
// Small tracked-caps stat/label text — see constants/design.ts's typography
// note for why this isn't Courier New anymore.
const MONO = typography.label;

const BUTTON_SIZE = 140;

// Roster strip — a single horizontal row of avatar chips, sized to fit
// however many volunteers there are (shrinking, never wrapping or clipping)
const ROSTER_MAX_CHIP = 40;
const ROSTER_MIN_CHIP = 20;
const ROSTER_CHIP_GAP = 10;
// Fixed regardless of chip size/roster length — this is what stops the
// button/whole stage from jumping as people pledge (see the reserved-height
// note further down).
const ROSTER_RESERVED_HEIGHT = 86;

// How long a successful room holds before the "ROOM SAFE" overlay takes
// over — long enough that the last pledge's own toast (in the band above)
// has been fully visible, not just popped in, before it's upstaged.
const SUCCESS_REVEAL_DELAY_MS = 2_000;

// Pledge toast: total time on screen, and how much of that is the slow
// fade-out (vs. the quick pop-in + hold) — "doesn't disappear fast" per the
// brief, so the exit gets the lion's share of the budget.
const PLEDGE_TOAST_MS = 3_500;
const PLEDGE_TOAST_IN_MS = 200;
const PLEDGE_TOAST_HOLD_MS = 600;
const PLEDGE_TOAST_OUT_MS = PLEDGE_TOAST_MS - PLEDGE_TOAST_IN_MS - PLEDGE_TOAST_HOLD_MS;
const PLEDGE_TOAST_ITEM_WIDTH = 76;

// A dedicated horizontal strip for pledge toasts — the empty band between
// the countdown ring and the hero number, which has plenty of width and
// doesn't sit over anything tappable (the button and roster live entirely
// below it), so toasts never have to dodge either.
const PLEDGE_TOAST_BAND_HEIGHT = 64;

interface PledgeToastData {
  id: number;
  pid: string;
  name: string;
  avatar: string | null | undefined;
  x: number;
}

// One floating avatar + name — no card, no background, just the two pieces
// themselves — pops in, holds, then fades out gradually on its own timer.
// pointerEvents: 'none' is belt-and-suspenders here (the whole band already
// sits clear of every tappable element), and the randomized x (picked once,
// on arrival) is what keeps concurrent toasts from landing on top of each
// other along the band.
function PledgeToastCard({ name, avatar, x }: PledgeToastData): React.ReactElement {
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const ringColor = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);
  const initial = (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();

  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.7);
  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: PLEDGE_TOAST_IN_MS, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: PLEDGE_TOAST_HOLD_MS }),
      withTiming(0, { duration: PLEDGE_TOAST_OUT_MS, easing: Easing.out(Easing.quad) }),
    );
    scale.value = withSequence(
      withTiming(1.06, { duration: PLEDGE_TOAST_IN_MS, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 140 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const avatarSize = 42;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        style,
        {
          position: 'absolute',
          top: 0,
          left: x,
          width: PLEDGE_TOAST_ITEM_WIDTH,
          alignItems: 'center',
        },
      ]}
    >
      <View
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: avatarSize / 2,
          overflow: 'hidden',
          borderWidth: 2,
          borderColor: ringColor,
          backgroundColor: avatarSource ? colors.parchment : ringColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {avatarSource ? (
          <Image
            source={avatarSource}
            style={{ width: avatarSize, height: avatarSize }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>{initial}</Text>
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: colors.ink,
          fontSize: 12,
          fontWeight: '800',
          marginTop: 5,
          textShadowColor: 'rgba(255,253,247,0.9)',
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 4,
        }}
      >
        {name}
      </Text>
    </Animated.View>
  );
}

// ── Roster chip — one volunteer, avatar + pledge-count badge + name, sized
// to whatever diameter the row decided everyone needs to fit in one line ──

interface RosterRow {
  pid: string;
  name: string;
  avatar: string | null | undefined;
  count: number;
}

function RosterChip({
  row,
  diameter,
  isMe,
}: {
  row: RosterRow;
  diameter: number;
  isMe: boolean;
}): React.ReactElement {
  const avatarSource = row.avatar ? AVATAR_IMAGES[row.avatar] : undefined;
  const ringColor = row.avatar ? AVATAR_COLORS[row.avatar] : avatarFallbackColor(row.pid);
  const initial = (row.name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();
  const badgeSize = Math.max(12, Math.round(diameter * 0.42));
  const nameFontSize = diameter >= 30 ? 11 : 9;

  return (
    <View style={{ alignItems: 'center', width: diameter + 12 }}>
      <View style={{ width: diameter, height: diameter }}>
        <View
          style={{
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            overflow: 'hidden',
            borderWidth: isMe ? 2.5 : 2,
            borderColor: isMe ? colors.amber : ringColor,
            backgroundColor: avatarSource ? colors.parchment : ringColor,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {avatarSource ? (
            <Image source={avatarSource} style={{ width: diameter, height: diameter }} resizeMode="cover" />
          ) : (
            <Text style={{ color: '#FFFFFF', fontSize: diameter * 0.4, fontWeight: '700' }}>
              {initial}
            </Text>
          )}
        </View>
        <View
          style={{
            position: 'absolute',
            bottom: -3,
            right: -3,
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: colors.amber,
            borderWidth: 1.5,
            borderColor: colors.cream,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.ink, fontSize: badgeSize * 0.55, fontWeight: '900' }}>
            {row.count}
          </Text>
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: colors.ink,
          fontSize: nameFontSize,
          fontWeight: isMe ? '800' : '500',
          marginTop: 4,
          maxWidth: diameter + 14,
          textAlign: 'center',
        }}
      >
        {isMe ? 'You' : row.name}
      </Text>
    </View>
  );
}

export const SacrificeGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();

  const status = (gameState.status as string) ?? 'PLAYING';
  const targetChasers = (gameState.target_chasers as number) ?? 1;
  const pledgedTotal = (gameState.pledged_total as number) ?? 0;
  const pledges = (gameState.pledges as Record<string, number>) ?? {};
  const turnMs = (gameState.turn_ms as number) ?? 30_000;
  const turnDeadlineAt = (gameState.turn_deadline_at as number) ?? 0;
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};
  const lastEvent = gameState.last_event as
    | { type: string; player_id: string; pledges: number; pledged_total: number }
    | null
    | undefined;

  const playing = status === 'PLAYING';
  const done = status === 'DONE';
  // Same rule the backend uses to pick between _success_outcomes and
  // _failure_outcomes — the room is safe the instant pledges reach target,
  // so this holds even for the final GAME_STATE broadcast at DONE.
  const success = pledgedTotal >= targetChasers;
  const myPledges = playerId ? (pledges[playerId] ?? 0) : 0;
  const remaining = Math.max(0, targetChasers - pledgedTotal);

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // Deadline watchdog — every client nudges the server once the window shuts;
  // the server validates against its own clock before resolving
  useEffect(() => {
    if (!playing || !turnDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, turnDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE');
      retry = setInterval(() => onActionRef.current('EXPIRE'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [turnDeadlineAt, playing, clockOffset]);

  // Ripple ping around the button — a quiet, repeating "tap here" cue instead
  // of a static button that has to be figured out
  const ripple = useSharedValue(0);
  useEffect(() => {
    if (playing) {
      ripple.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1_200, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
      );
    } else {
      ripple.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(ripple.value, [0, 1], [1, 1.35]) }],
  }));

  // The countdown number punches on every pledge — the room's heartbeat
  const numberScale = useSharedValue(1);
  const prevPledgedRef = useRef(pledgedTotal);
  useEffect(() => {
    if (pledgedTotal > prevPledgedRef.current) {
      numberScale.value = withSequence(
        withTiming(1.12, { duration: 120, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 220, easing: Easing.out(Easing.back(1.5)) }),
      );
    }
    prevPledgedRef.current = pledgedTotal;
  }, [pledgedTotal, numberScale]);
  const numberStyle = useAnimatedStyle(() => ({ transform: [{ scale: numberScale.value }] }));

  // Pledge toasts — one per PLEDGE event, each independent so two players
  // pledging seconds apart (or the same second) each get their own card
  // that pops in and fades out on its own clock, never blocking each other.
  // Keyed by pledgedTotal, which the server increments by exactly one per
  // pledge, so simultaneous pledges from different players still land as
  // distinct, uniquely-identified events instead of colliding.
  const [pledgeToasts, setPledgeToasts] = useState<PledgeToastData[]>([]);
  useEffect(() => {
    if (lastEvent?.type !== 'PLEDGE') return;
    const id = pledgedTotal;
    const pid = lastEvent.player_id;
    // A random spot along the toast band, clamped so the item never clips
    // past either edge of the (maxWidth-420, padded) content column.
    const bandWidth = Math.min(winWidth, 420) - 48;
    const maxX = Math.max(10, bandWidth - PLEDGE_TOAST_ITEM_WIDTH);

    // Picked against whatever's *currently* on screen (read from the
    // updater's own `cur`, not a stale closure) so two pledges landing back
    // to back never draw the same spot and stack on each other — resample
    // until clear of every still-visible toast's item width, or just take
    // the least-bad draw if the band is too packed to find a clean one.
    setPledgeToasts((cur) => {
      let x = Math.random() * maxX;
      let bestX = x;
      let bestClearance = -Infinity;
      for (let attempt = 0; attempt < 10; attempt++) {
        const clearance = cur.length
          ? Math.min(...cur.map((t) => Math.abs(t.x - x)))
          : Infinity;
        if (clearance > bestClearance) {
          bestX = x;
          bestClearance = clearance;
        }
        if (clearance >= PLEDGE_TOAST_ITEM_WIDTH) break;
        x = Math.random() * maxX;
      }
      const toast: PledgeToastData = {
        id,
        pid,
        name: displayNames[pid] ?? '?',
        avatar: avatars[pid],
        x: bestX,
      };
      return [...cur, toast];
    });
    const timer = setTimeout(() => {
      setPledgeToasts((cur) => cur.filter((t) => t.id !== id));
    }, PLEDGE_TOAST_MS + 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pledgedTotal, lastEvent?.type, lastEvent?.player_id]);

  // On a successful room, hold the victory overlay back for a beat so the
  // last volunteer's own pledge toast — already on screen, mid-fade — gets
  // its moment before the room-wide "ROOM SAFE" banner takes over. A failed
  // room has no one to spotlight, so it reveals immediately as before.
  const [revealReady, setRevealReady] = useState(false);
  useEffect(() => {
    if (!done) {
      setRevealReady(false);
      return;
    }
    if (!success) {
      setRevealReady(true);
      return;
    }
    const timer = setTimeout(() => setRevealReady(true), SUCCESS_REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [done, success]);

  // Reveal overlay slam-in, same beat as coin_flip/roulette; game.tsx holds
  // navigation (see END_HOLD_MS) so it plays before the summary screen
  const revealOpacity = useSharedValue(0);
  const revealScale = useSharedValue(0.85);
  useEffect(() => {
    if (!revealReady) return;
    revealOpacity.value = withTiming(1, { duration: 200 });
    revealScale.value = withSequence(
      withTiming(1.05, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 120 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealReady]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
    transform: [{ scale: revealScale.value }],
  }));

  // Roster — volunteers only (the room already knows who hasn't stepped up;
  // listing them too was just noise), ranked by pledge count so the biggest
  // sacrifices rise to the top live.
  const roster: RosterRow[] = Object.keys(displayNames)
    .map((pid) => ({ pid, name: displayNames[pid] ?? '?', avatar: avatars[pid], count: pledges[pid] ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  // Shrink chips to fit everyone in one line rather than wrapping/clipping —
  // floors at ROSTER_MIN_CHIP; past that the strip's own ScrollView takes
  // over instead of squeezing avatars illegibly small.
  const rosterContainerWidth = Math.min(winWidth, 420) - 48;
  const chipDiameter =
    roster.length > 0
      ? Math.max(
          ROSTER_MIN_CHIP,
          Math.min(ROSTER_MAX_CHIP, (rosterContainerWidth - ROSTER_CHIP_GAP * (roster.length - 1)) / roster.length),
        )
      : ROSTER_MAX_CHIP;

  function handlePledge() {
    if (playing) onAction('PLEDGE');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 24,
          paddingTop: 32 + insets.top,
          paddingBottom: 24 + insets.bottom,
        }}
      >
        {/* Eyebrow — doubles as this screen's title (no bigger heading
            follows it, same as Prisoner's Dilemma's), so it gets the same
            bold treatment rather than the small MONO/label register. */}
        <Text style={{ ...typography.title, color: colors.amber, fontSize: 15, textAlign: 'center' }}>
          The Sacrifice
        </Text>

        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <CountdownRing
            deadlineAt={turnDeadlineAt}
            clockOffset={clockOffset}
            totalMs={turnMs}
            active={playing}
            size={84}
            strokeWidth={7}
            trackColor={colors.sand}
            textColor={colors.ink}
            highTimeColor={colors.amber}
          />
        </View>

        {/* Pledge toast band — the open horizontal space between the timer
            ring and the hero number, well clear of the button and roster
            below, so a toast never has to dodge anything tappable. */}
        <View style={{ height: PLEDGE_TOAST_BAND_HEIGHT, position: 'relative' }} pointerEvents="none">
          {pledgeToasts.map((toast) => (
            <PledgeToastCard key={toast.id} {...toast} />
          ))}
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {/* Hero number — how many chasers still stand between the room
              and safety, the whole state at a glance */}
          <Animated.View style={numberStyle}>
            <Text
              style={{
                color: colors.ink,
                fontSize: 100,
                lineHeight: 104,
                fontWeight: '900',
                textAlign: 'center',
              }}
            >
              {remaining}
            </Text>
          </Animated.View>
          <Text style={{ ...MONO, color: colors.amber, fontSize: 12, marginTop: -2 }}>
            {remaining === 1 ? 'chaser to go' : 'chasers to go'}
          </Text>

          {/* Pledge button — repeatable; each tap volunteers one more chaser.
              The ripple behind it is the only cue it needs tapping — no
              locked/checked state, since pledging again is always allowed. */}
          <View
            style={{
              marginTop: 32,
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {playing && (
              <Animated.View
                pointerEvents="none"
                style={[
                  rippleStyle,
                  {
                    position: 'absolute',
                    width: BUTTON_SIZE,
                    height: BUTTON_SIZE,
                    borderRadius: BUTTON_SIZE / 2,
                    borderWidth: 3,
                    borderColor: colors.amber,
                  },
                ]}
              />
            )}
            <Pressable onPress={handlePledge} disabled={!playing}>
              {({ pressed }) => (
                <View
                  style={{
                    width: BUTTON_SIZE,
                    height: BUTTON_SIZE,
                    borderRadius: BUTTON_SIZE / 2,
                    backgroundColor: playing ? colors.amber : colors.sand,
                    borderWidth: 3,
                    borderColor: colors.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: pressed && playing ? [{ scale: 0.94 }] : [],
                  }}
                >
                  <GlassWater size={40} color={colors.ink} strokeWidth={2.5} />
                  <Text
                    style={{
                      ...MONO,
                      color: colors.ink,
                      fontSize: 13,
                      fontWeight: '900',
                      marginTop: 6,
                    }}
                  >
                    I&apos;m in
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Reserved-height status slot — always mounted so the room's first
              pledge doesn't shove the layout when this becomes visible */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 26,
              marginTop: 14,
              opacity: myPledges > 0 ? 1 : 0,
            }}
          >
            <GlassWater size={14} color={colors.amber} strokeWidth={2.5} />
            <Text style={{ ...MONO, color: colors.amber, fontSize: 13, fontWeight: '800' }}>
              ×{myPledges}
            </Text>
          </View>

          {/* Roster — a fixed-height slot regardless of who's pledged (or
              whether anyone has yet), so the room's first pledge doesn't
              shove the button and the rest of the stage upward the way a
              conditionally-mounted list did. One horizontal row of
              avatar+badge+name chips; the chip diameter shrinks to whatever
              fits everyone on one line instead of wrapping or scrolling. */}
          <View style={{ width: '100%', marginTop: 14, height: ROSTER_RESERVED_HEIGHT }}>
            <Text
              style={{
                ...MONO,
                color: colors.dune,
                fontSize: 10,
                marginBottom: 8,
                opacity: roster.length > 0 ? 1 : 0,
              }}
            >
              Who&apos;s in
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'center',
                alignItems: 'flex-start',
                gap: ROSTER_CHIP_GAP,
                paddingHorizontal: 4,
              }}
            >
              {roster.map((row) => (
                <RosterChip key={row.pid} row={row} diameter={chipDiameter} isMe={row.pid === playerId} />
              ))}
            </ScrollView>
          </View>
        </View>
      </View>

      {/* Reveal overlay — green "room's safe" vs. red "everyone drinks".
          Volunteers still owe their pledged chasers even on the green
          outcome, which the personal summary screen spells out next.
          Gated on revealReady, not done, so a successful room's last
          pledge toast gets its moment first (see the effect above). */}
      {revealReady && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: success ? 'rgba(22,163,74,0.94)' : 'rgba(220,38,38,0.94)',
            },
            revealStyle,
          ]}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 30,
              fontWeight: '900',
              letterSpacing: 1,
              textAlign: 'center',
            }}
          >
            {success ? 'ROOM SAFE' : "TIME'S UP"}
          </Text>
          <Text
            style={{
              color: 'rgba(255,255,255,0.85)',
              fontSize: 15,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            {success ? 'Volunteers still drink.' : 'Everyone drinks.'}
          </Text>
        </Animated.View>
      )}
    </View>
  );
};
