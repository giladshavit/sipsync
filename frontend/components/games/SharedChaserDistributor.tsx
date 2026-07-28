import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View, Image } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Check, GlassWater } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// Bot distributors can fire ASSIGN taps back-to-back server-side — or have
// finished distributing entirely before a spectator's screen even mounts
// (black_box's reveal choreography outlives a fast bot). Either way,
// spectators get a deliberate beat of the EMPTY board first, then the bot's
// picks land one at a time — the auction-style pacing. The distributor's own
// taps must render instantly (their view bypasses this pacing entirely) —
// any lag between their tap and the chaser appearing reads as the app being
// broken, not as pacing.
// Exported: getEndHoldMs (ActiveGameScreen) sizes black_box's end-of-round
// navigation hold from these same numbers, so the summary can never cut in
// before the last paced pick has actually been shown.
export const SPECTATOR_PRE_HOLD_MS = 1_000;
export const SPECTATOR_STAGGER_MS = 650; // gap between consecutive revealed picks
const POP_UP_MS = 340;
const POP_DOWN_MS = 420;

// A game's own recipient cap (how high a single tap-to-cycle can go) is a
// server-side rule, not something this component enforces — it just renders
// whatever count the game state reports.

// ── Small shared bits, extracted alongside the distributor because both are
// used exclusively to build its recipient tiles — reused by callers (e.g.
// auction's high-bid plaque) that also need an avatar/kicker outside the
// distributor itself ──────────────────────────────────────────────────────

export function Kicker({
  children,
  tint,
  style,
}: {
  children: React.ReactNode;
  tint: string;
  style?: object;
}): React.ReactElement {
  return (
    <Text
      style={{
        ...typography.label,
        fontWeight: '700',
        fontSize: 12,
        letterSpacing: 2,
        color: tint,
        ...style,
      }}
    >
      {children}
    </Text>
  );
}

export function AvatarCircle({
  name,
  avatar,
  size,
  ringColor,
}: {
  name: string;
  avatar: string | null | undefined;
  size: number;
  ringColor: string;
}): React.ReactElement {
  const avatarSource = avatar ? AVATAR_IMAGES[avatar] : undefined;
  const bg = avatar ? AVATAR_COLORS[avatar] : avatarFallbackColor(name);
  const initial = (name.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        borderWidth: 3,
        borderColor: ringColor,
        backgroundColor: avatarSource ? colors.parchment : bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {avatarSource ? (
        <Image source={avatarSource} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.38 }}>
          {initial}
        </Text>
      )}
    </View>
  );
}

// Theme colors so this reads correctly under any game's palette (auction's
// felt/brass, black_box's slate) instead of being locked to one look.
export interface DistributorAccent {
  tint: string; // bright accent — headline text, active state, hero numbers
  tintGlow: string; // secondary accent — countdown fill, confirm-button fill, default borders
  surface: string; // dark card/plaque background
}

// ── How many chasers are still unplaced — a hero readout, not a small status
// line, since it's the number the distributor (and everyone spectating) is
// actually watching tick down ──────────────────────────────────────────────

function RemainingPlaque({
  remaining,
  accent,
}: {
  remaining: number;
  accent: DistributorAccent;
}): React.ReactElement {
  const done = remaining <= 0;
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          // Fixed footprint — the number ↔ Check swap must never change the
          // plaque's size, or the whole centered screen reflows around it.
          minWidth: 100,
          height: 72,
          paddingHorizontal: 22,
          borderRadius: 24,
          backgroundColor: accent.surface,
          borderWidth: 2.5,
          borderColor: done ? colors.go : accent.tintGlow,
          shadowColor: done ? colors.go : accent.tintGlow,
          shadowOpacity: 0.4,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }}
      >
        {done ? (
          <Check size={42} color={colors.go} strokeWidth={3} />
        ) : (
          <Text style={{ color: accent.tint, fontSize: 46, fontWeight: '900', lineHeight: 48 }}>
            {remaining}
          </Text>
        )}
      </View>
      <Kicker tint={done ? colors.go : accent.tintGlow} style={{ fontSize: 10 }}>
        {done ? 'POOL FULLY PLACED' : remaining === 1 ? 'CHASER LEFT TO PLACE' : 'CHASERS LEFT TO PLACE'}
      </Kicker>
    </View>
  );
}

// ── Recipient tile ───────────────────────────────────────────────────────────

function RecipientTile({
  name,
  avatar,
  chasers,
  isSelf,
  emphasizeSelf,
  interactive,
  accent,
  onPress,
}: {
  name: string;
  avatar: string | null | undefined;
  chasers: number;
  isSelf: boolean;
  // True for the viewer's own tile when they're watching someone else pour —
  // a standout border so "You" is unmistakable in the recipient row. Off when
  // the viewer IS the distributor (every tile is theirs to tap; no need).
  emphasizeSelf: boolean;
  interactive: boolean;
  accent: DistributorAccent;
  onPress: () => void;
}): React.ReactElement {
  // Pacing (the spectator pre-hold + stagger) lives in the PARENT now, which
  // hands each tile its already-paced count — keeping it here too would
  // double-delay, and the parent needs the paced values anyway so the
  // remaining-pool plaque ticks down in sync with the tiles.
  const pop = useSharedValue(1);
  const prevChasersRef = useRef(chasers);
  useEffect(() => {
    if (chasers === prevChasersRef.current) return;
    prevChasersRef.current = chasers;
    pop.value = withSequence(
      withTiming(1.16, { duration: POP_UP_MS, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: POP_DOWN_MS }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chasers]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // Emphasized "You" keeps the amber ring even after chasers land — the
  // identity signal outranks the red "got poured on" signal for the one
  // tile that has to stay findable at a glance. Everyone else still flips
  // to stop-red once assigned.
  const ringColor = emphasizeSelf
    ? colors.amber
    : chasers > 0
      ? colors.stop
      : isSelf
        ? accent.tint
        : avatar
          ? AVATAR_COLORS[avatar]
          : avatarFallbackColor(name);

  return (
    <Pressable onPress={onPress} disabled={!interactive}>
      {({ pressed }) => (
        <View
          style={{
            width: emphasizeSelf ? 100 : 92,
            alignItems: 'center',
            gap: 6,
            // Amber plate around the viewer's own tile — only when watching
            // a pour, never when they're the one tapping. Padding + border
            // keep the footprint stable so neighbors don't reflow.
            paddingVertical: emphasizeSelf ? 8 : 0,
            paddingHorizontal: emphasizeSelf ? 4 : 0,
            borderRadius: emphasizeSelf ? 16 : 0,
            borderWidth: emphasizeSelf ? 2.5 : 0,
            borderColor: emphasizeSelf ? colors.amber : 'transparent',
            backgroundColor: emphasizeSelf ? 'rgba(245,158,11,0.12)' : 'transparent',
            transform: pressed && interactive ? [{ scale: 0.94 }] : [],
          }}
        >
          <Animated.View style={popStyle}>
            <AvatarCircle name={name} avatar={avatar} size={64} ringColor={ringColor} />
          </Animated.View>
          <Text
            numberOfLines={1}
            style={
              emphasizeSelf
                ? {
                    ...typography.label,
                    color: colors.amber,
                    fontSize: 13,
                    fontWeight: '900',
                    letterSpacing: 1.5,
                  }
                : {
                    color: colors.chalk,
                    fontSize: 12,
                    fontWeight: '800',
                  }
            }
          >
            {isSelf ? 'You' : name}
          </Text>
          {/* Fixed height — the "—" placeholder ↔ glass-icon swap must not
              change this row's height, or every tile below reflows. */}
          <View style={{ flexDirection: 'row', gap: 3, height: 18, alignItems: 'center' }}>
            {chasers === 0 ? (
              <Kicker tint={colors.fog} style={{ fontSize: 10 }}>
                —
              </Kicker>
            ) : (
              Array.from({ length: chasers }, (_, i) => (
                <GlassWater key={i} size={14} color={colors.stop} strokeWidth={2.5} />
              ))
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ── The distributor itself ───────────────────────────────────────────────────

export interface SharedChaserDistributorProps {
  poolSize: number;
  assignments: Record<string, number>;
  displayNames: Record<string, string>;
  avatars: Record<string, string | null>;
  selfId: string | null;
  isDistributor: boolean;
  distributorId: string | null;
  deadlineAt: number | null;
  windowMs: number;
  clockOffset: number;
  onAssign: (recipientId: string) => void;
  onSubmit: () => void;
  onExpire: () => void;
  accent: DistributorAccent;
}

export function SharedChaserDistributor({
  poolSize,
  assignments,
  displayNames,
  avatars,
  selfId,
  isDistributor,
  distributorId,
  deadlineAt,
  windowMs,
  clockOffset,
  onAssign,
  onSubmit,
  onExpire,
  accent,
}: SharedChaserDistributorProps): React.ReactElement {
  // Latest callback without retriggering the deadline effects below (callers
  // typically recreate onAction-derived closures every render)
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const timerProgress = useSharedValue(1);
  useEffect(() => {
    if (!deadlineAt) return;
    const remaining = Math.max(0, deadlineAt - clockOffset - Date.now());
    timerProgress.value = Math.min(1, remaining / windowMs);
    timerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, clockOffset, windowMs]);
  const timerStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  // Deadline watchdog — any client nudges the server once the window shuts;
  // the server validates against its own clock before resolving
  useEffect(() => {
    if (!deadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, deadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onExpireRef.current();
      retry = setInterval(() => onExpireRef.current(), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [deadlineAt, clockOffset]);

  // ── Spectator pacing ─────────────────────────────────────────────────────
  // Non-distributors never render raw server assignments directly: they see a
  // paced copy that starts EMPTY (even when the screen mounts after a bot has
  // already finished — black_box's reveal outlives fast bots), holds a beat,
  // then lands each changed pick one at a time with the tile pop. The
  // distributor's own view bypasses all of this — raw state, zero lag.
  const [pacedAssignments, setPacedAssignments] = useState<Record<string, number>>(() =>
    isDistributor
      ? assignments
      : Object.fromEntries(Object.keys(assignments).map((pid) => [pid, 0])),
  );
  const pacedRef = useRef(pacedAssignments);
  pacedRef.current = pacedAssignments;

  // Serialize so live per-tap updates (a new object every broadcast) only
  // retrigger when a count actually changed.
  const assignmentsKey = JSON.stringify(assignments);
  useEffect(() => {
    if (isDistributor) {
      setPacedAssignments(assignments);
      return;
    }
    const changed = Object.keys(assignments).filter(
      (pid) => (assignments[pid] ?? 0) !== (pacedRef.current[pid] ?? 0),
    );
    if (changed.length === 0) return;
    const timers = changed.map((pid, i) =>
      setTimeout(
        () => setPacedAssignments((prev) => ({ ...prev, [pid]: assignments[pid] ?? 0 })),
        SPECTATOR_PRE_HOLD_MS + i * SPECTATOR_STAGGER_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentsKey, isDistributor]);

  const displayAssignments = isDistributor ? assignments : pacedAssignments;

  const recipients = Object.keys(assignments);
  const assignedTotal = Object.values(displayAssignments).reduce((a, b) => a + b, 0);
  const poolRemaining = poolSize - assignedTotal;
  // Confirm gating reads the RAW total — the distributor's path is raw
  // anyway, but never let display pacing hold an enabled button hostage.
  const rawTotal = Object.values(assignments).reduce((a, b) => a + b, 0);
  const fullyDistributed = rawTotal === poolSize;

  function cycleAssign(pid: string) {
    if (!isDistributor) return;
    onAssign(pid);
  }

  function submit() {
    if (!fullyDistributed) return;
    onSubmit();
  }

  return (
    <View style={{ alignItems: 'center', gap: 20 }}>
      <View
        style={{
          width: '100%',
          height: 6,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
          padding: 1,
          backgroundColor: accent.surface,
        }}
      >
        <Animated.View style={[{ height: '100%', backgroundColor: accent.tintGlow }, timerStyle]} />
      </View>

      <View style={{ alignItems: 'center', gap: 6 }}>
        {isDistributor ? (
          <Kicker tint={accent.tint}>DISTRIBUTE THE POOL</Kicker>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AvatarCircle
              name={displayNames[distributorId ?? ''] ?? '?'}
              avatar={avatars[distributorId ?? '']}
              size={26}
              ringColor={accent.tint}
            />
            <Kicker tint={accent.tint}>
              {(displayNames[distributorId ?? ''] ?? '?').toUpperCase()} IS POURING
            </Kicker>
          </View>
        )}
      </View>

      <RemainingPlaque remaining={poolRemaining} accent={accent} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
        {recipients.map((pid) => (
          <RecipientTile
            key={pid}
            name={displayNames[pid] ?? '?'}
            avatar={avatars[pid]}
            chasers={displayAssignments[pid] ?? 0}
            isSelf={pid === selfId}
            emphasizeSelf={!isDistributor && pid === selfId}
            interactive={isDistributor}
            accent={accent}
            onPress={() => cycleAssign(pid)}
          />
        ))}
      </View>

      {isDistributor && (
        <Pressable onPress={submit} disabled={!fullyDistributed}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 14,
              paddingHorizontal: 36,
              borderRadius: 16,
              // Ready state goes GREEN — "everything's placed, lock it in"
              // is a go/confirm action, not a theme-accent one.
              backgroundColor: fullyDistributed ? colors.go : accent.surface,
              borderWidth: 1.5,
              borderColor: fullyDistributed ? colors.go : accent.tintGlow,
              opacity: fullyDistributed ? 1 : 0.55,
              shadowColor: fullyDistributed ? colors.go : '#000000',
              shadowOpacity: fullyDistributed ? 0.45 : 0,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 0 },
              elevation: fullyDistributed ? 6 : 0,
            }}
          >
            {/* The disabled state must stay legible against its own surface
                fill — it previously used accent.surface for both the icon
                and the background, rendering as a blank pill with no visible
                CONFIRM text until the pool was fully placed. */}
            <Check size={18} color={fullyDistributed ? accent.surface : accent.tintGlow} strokeWidth={3} />
            <Text
              style={{
                color: fullyDistributed ? accent.surface : accent.tintGlow,
                fontSize: 15,
                fontWeight: '900',
                letterSpacing: 1,
              }}
            >
              CONFIRM
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
