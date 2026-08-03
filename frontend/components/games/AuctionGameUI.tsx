import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Check, Coins, Gavel, Minus, Plus, GlassWater } from 'lucide-react-native';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';
import { AvatarCircle, Kicker, SharedChaserDistributor } from './SharedChaserDistributor';

interface Bid {
  chasers: number;
  points: number;
}

// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;

// ── Casino palette ────────────────────────────────────────────────────────
// A real felt table, not another recolored near-black: deep billiard-green
// underfoot, dark brass shadow in the recesses, warm old-coin gold for the
// currency itself. Chasers stay on the app's shared danger red (colors.stop)
// — that meaning is established everywhere else in Quickle, so it's kept,
// not reinvented.
const FELT_DEEP = '#0B3D24';
const FELT_SHADOW = '#062015';
const BRASS = '#D4A94A';
const BRASS_GLOW = '#F5D889';

// ── Ambient spotlight — a single warm light falling from above onto the
// table, built from layered low-opacity circles (no gradient lib in this
// project) — the thing that makes the felt read as a lit stage, not a flat
// fill ──────────────────────────────────────────────────────────────────
const SPOTLIGHT_RINGS = [
  { size: 640, opacity: 0.035 },
  { size: 470, opacity: 0.05 },
  { size: 320, opacity: 0.08 },
  { size: 200, opacity: 0.12 },
];

function Spotlight(): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {SPOTLIGHT_RINGS.map(({ size, opacity }) => (
        <View
          key={size}
          style={{
            position: 'absolute',
            top: -size * 0.34,
            left: '50%',
            width: size,
            height: size,
            marginLeft: -size / 2,
            borderRadius: size / 2,
            backgroundColor: BRASS_GLOW,
            opacity,
          }}
        />
      ))}
    </View>
  );
}

// ── Bidding: highest-bid plaque ───────────────────────────────────────────

function HighBidPlaque({
  bid,
  bidderName,
  avatar,
}: {
  bid: Bid | null;
  bidderName: string | null;
  avatar: string | null | undefined;
}): React.ReactElement {
  const ringColor = bidderName
    ? avatar
      ? AVATAR_COLORS[avatar]
      : avatarFallbackColor(bidderName)
    : colors.rim;

  return (
    <View
      style={{
        alignItems: 'center',
        paddingVertical: 20,
        paddingHorizontal: 26,
        borderRadius: 20,
        backgroundColor: FELT_SHADOW,
        borderWidth: 2.5,
        borderColor: bid ? BRASS : 'rgba(212,169,74,0.3)',
        gap: 10,
      }}
    >
      <Kicker tint={bid ? BRASS : colors.fog}>
        {bid ? 'HIGHEST BID' : 'NO BIDS YET'}
      </Kicker>

      {/* Same two rows whether or not a bid exists yet — dashes/blank
          instead of conditionally omitting the rows — so the plaque never
          changes height (and everything else on screen doesn't jump) the
          instant the first bid lands. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 26 }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <GlassWater size={22} color={colors.stop} strokeWidth={2.5} />
            <Text style={{ color: colors.chalk, fontSize: 32, fontWeight: '900', width: 48, textAlign: 'center' }}>
              {bid ? bid.chasers : '–'}
            </Text>
          </View>
          <Kicker tint={colors.fog} style={{ fontSize: 10 }}>
            CHASERS
          </Kicker>
        </View>
        <View style={{ width: 1.5, height: 40, backgroundColor: 'rgba(212,169,74,0.25)' }} />
        <View style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Coins size={22} color={BRASS_GLOW} strokeWidth={2.5} />
            <Text style={{ color: BRASS_GLOW, fontSize: 32, fontWeight: '900', width: 60, textAlign: 'center' }}>
              {bid ? bid.points : '–'}
            </Text>
          </View>
          <Kicker tint={colors.fog} style={{ fontSize: 10 }}>
            POINTS
          </Kicker>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, opacity: bid ? 1 : 0 }}>
        <AvatarCircle name={bidderName ?? '?'} avatar={avatar} size={26} ringColor={ringColor} />
        <Text style={{ color: colors.chalk, fontSize: 14, fontWeight: '800' }}>
          {bidderName ?? ' '}
        </Text>
      </View>
    </View>
  );
}

// ── Bidding: quick-bid chip — a real poker-chip read (dark rim, gold face)
// instead of a generic pill ──────────────────────────────────────────────

function ChipButton({
  icon: Icon,
  delta,
  unit,
  onPress,
}: {
  icon: typeof GlassWater;
  delta: string;
  unit: string;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: BRASS,
            borderWidth: 5,
            borderColor: FELT_SHADOW,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            transform: pressed ? [{ scale: 0.93 }] : [],
          }}
        >
          <Icon size={17} color={FELT_SHADOW} strokeWidth={2.5} />
          <Text style={{ color: FELT_SHADOW, fontSize: 19, fontWeight: '900' }}>{delta}</Text>
          <Text style={{ ...typography.label, color: FELT_SHADOW, fontSize: 8, letterSpacing: 0.5 }}>
            {unit}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Bidding: custom stepper ───────────────────────────────────────────────────

function Stepper({
  icon: Icon,
  label,
  value,
  tint,
  onDec,
  onInc,
  decDisabled,
}: {
  icon: typeof GlassWater;
  label: string;
  value: number;
  tint: string;
  onDec: () => void;
  onInc: () => void;
  decDisabled: boolean;
}): React.ReactElement {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon size={14} color={tint} strokeWidth={2.5} />
        <Kicker tint={tint} style={{ fontSize: 11 }}>
          {label}
        </Kicker>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable onPress={onDec} disabled={decDisabled} hitSlop={8}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: FELT_DEEP,
              borderWidth: 1.5,
              borderColor: decDisabled ? colors.rim : tint,
              opacity: decDisabled ? 0.4 : 1,
            }}
          >
            <Minus size={16} color={decDisabled ? colors.fog : tint} strokeWidth={3} />
          </View>
        </Pressable>
        <Text style={{ color: colors.chalk, fontSize: 22, fontWeight: '900', minWidth: 34, textAlign: 'center' }}>
          {value}
        </Text>
        <Pressable onPress={onInc} hitSlop={8}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: FELT_DEEP,
              borderWidth: 1.5,
              borderColor: tint,
            }}
          >
            <Plus size={16} color={tint} strokeWidth={3} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function isValidBid(chasers: number, points: number, current: Bid | null): boolean {
  if (chasers < 1 || points < 0) return false;
  if (!current) return true;
  if (chasers < current.chasers || points < current.points) return false;
  if (chasers === current.chasers && points === current.points) return false;
  return true;
}

// ── Bidding: the lot — the prize itself, the reason anyone's bidding, given
// its own illuminated plaque instead of a small top badge ────────────────

function LotPlaque({ poolSize }: { poolSize: number }): React.ReactElement {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 26, height: 1.5, backgroundColor: BRASS, opacity: 0.5 }} />
        <Kicker tint={BRASS}>THE LOT</Kicker>
        <View style={{ width: 26, height: 1.5, backgroundColor: BRASS, opacity: 0.5 }} />
      </View>
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 14,
          paddingHorizontal: 40,
          borderRadius: 24,
          backgroundColor: FELT_SHADOW,
          borderWidth: 3,
          borderColor: BRASS,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 5,
            left: 5,
            right: 5,
            bottom: 5,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: 'rgba(245,216,137,0.28)',
          }}
        />
        <Text style={{ color: BRASS_GLOW, fontSize: 60, fontWeight: '900', lineHeight: 64 }}>
          {poolSize}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <GlassWater size={15} color={colors.stop} strokeWidth={2.5} />
          <Kicker tint={colors.chalk} style={{ fontSize: 11 }}>
            {poolSize === 1 ? 'CHASER' : 'CHASERS'}
          </Kicker>
        </View>
      </View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const AuctionGameUI: React.FC<MiniGameProps> = ({ gameState, onAction, clockOffset }) => {
  const { playerId } = usePlayerIdentity();

  const status = (gameState.status as string) ?? 'BIDDING';
  const poolSize = (gameState.pool_size as number) ?? 0;
  const currentBid = (gameState.current_bid as Bid | null) ?? null;
  const currentBidderId = (gameState.current_bidder_id as string | null) ?? null;
  const bidMs = (gameState.bid_ms as number) ?? 15_000;
  const bidDeadlineAt = (gameState.bid_deadline_at as number) ?? 0;
  const winnerId = (gameState.winner_id as string | null) ?? null;
  const distributeMs = (gameState.distribute_ms as number) ?? 60_000;
  const distributeDeadlineAt = (gameState.distribute_deadline_at as number | null) ?? null;
  const assignments = (gameState.assignments as Record<string, number>) ?? {};
  const displayNames = (gameState.display_names as Record<string, string>) ?? {};
  const avatars = (gameState.avatars as Record<string, string | null>) ?? {};

  const bidding = status === 'BIDDING';
  const distributing = status === 'DISTRIBUTING';
  const done = status === 'DONE';
  const isWinner = !!playerId && playerId === winnerId;

  const floor: Bid = { chasers: 1, points: 0 };
  const minBid = currentBid ?? floor;

  // Latest onAction without retriggering timer effects (game.tsx recreates it
  // every render)
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // ── Custom bid staging — bumped up whenever the floor moves past it, never
  // clawed back below a value the player deliberately raised ────────────────
  const [localChasers, setLocalChasers] = useState(minBid.chasers);
  const [localPoints, setLocalPoints] = useState(minBid.points);
  useEffect(() => {
    setLocalChasers((c) => Math.max(c, minBid.chasers));
    setLocalPoints((p) => Math.max(p, minBid.points));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minBid.chasers, minBid.points]);

  const customValid = isValidBid(localChasers, localPoints, currentBid);

  function placeQuickBid(deltaChasers: number, deltaPoints: number) {
    // Before any bid exists the "current highest" is really 0 chasers, not
    // the floor's 1 — otherwise the very first +1-chaser tap would jump
    // straight to 2. max(1, ...) still keeps every bid legal (floor is 1).
    const baseChasers = currentBid?.chasers ?? 0;
    const basePoints = currentBid?.points ?? 0;
    onAction('BID', {
      chasers: Math.max(1, baseChasers + deltaChasers),
      points: basePoints + deltaPoints,
    });
  }

  function placeCustomBid() {
    if (!customValid) return;
    onAction('BID', { chasers: localChasers, points: localPoints });
  }

  // Bid countdown bar, corrected from server time to this device's clock —
  // restarts every time the deadline resets (a new valid bid landed)
  const bidTimerProgress = useSharedValue(1);
  useEffect(() => {
    if (!bidding || !bidDeadlineAt) return;
    const remaining = Math.max(0, bidDeadlineAt - clockOffset - Date.now());
    bidTimerProgress.value = Math.min(1, remaining / bidMs);
    bidTimerProgress.value = withTiming(0, { duration: remaining, easing: Easing.linear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidDeadlineAt, bidding, clockOffset, bidMs]);
  const bidTimerStyle = useAnimatedStyle(() => ({
    width: `${bidTimerProgress.value * 100}%` as `${number}%`,
  }));

  // Bid deadline watchdog — any client nudges the server once the window
  // shuts; the server validates against its own clock before resolving
  useEffect(() => {
    if (!bidding || !bidDeadlineAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, bidDeadlineAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE_BID');
      retry = setInterval(() => onActionRef.current('EXPIRE_BID'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [bidDeadlineAt, bidding, clockOffset]);

  // Reveal overlay — game.tsx holds navigation (END_HOLD_MS) so this plays
  // before the summary screen
  const revealOpacity = useSharedValue(0);
  const revealScale = useSharedValue(0.85);
  useEffect(() => {
    if (!done) return;
    revealOpacity.value = withDelay(200, withTiming(1, { duration: 200 }));
    revealScale.value = withDelay(
      200,
      withSequence(
        withTiming(1.05, { duration: 200, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 120 }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: revealOpacity.value,
    transform: [{ scale: revealScale.value }],
  }));

  const myAssigned = playerId ? (assignments[playerId] ?? 0) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: FELT_DEEP }}>
      <Spotlight />
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 56,
          paddingBottom: 32,
        }}
      >
        {/* Header — a small corner mark, not a hero title; the lot and the
            bid are the things worth taking up room */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
          <Gavel size={14} color={BRASS} strokeWidth={2.5} />
          <Kicker tint={BRASS} style={{ fontSize: 11 }}>AUCTION</Kicker>
        </View>

        {/* Timer — distributing renders its own inside SharedChaserDistributor */}
        <View
          style={{
            height: 6,
            marginTop: 14,
            borderWidth: 1,
            borderColor: 'rgba(212,169,74,0.3)',
            padding: 1,
            backgroundColor: FELT_SHADOW,
            opacity: bidding ? 1 : 0,
          }}
        >
          <Animated.View style={[{ height: '100%', backgroundColor: BRASS_GLOW }, bidTimerStyle]} />
        </View>

        {/* ── BIDDING ─────────────────────────────────────────────────── */}
        {bidding && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'space-evenly' }}>
            <HighBidPlaque
              bid={currentBid}
              bidderName={currentBidderId ? (displayNames[currentBidderId] ?? '?') : null}
              avatar={currentBidderId ? avatars[currentBidderId] : null}
            />

            <View style={{ flexDirection: 'row', gap: 22 }}>
              <ChipButton icon={GlassWater} delta="+1" unit="CHASER" onPress={() => placeQuickBid(1, 0)} />
              <ChipButton icon={Coins} delta="+10" unit="POINTS" onPress={() => placeQuickBid(0, 10)} />
            </View>

            <View
              style={{
                width: '100%',
                paddingVertical: 16,
                paddingHorizontal: 16,
                borderRadius: 18,
                backgroundColor: FELT_SHADOW,
                borderWidth: 1.5,
                borderColor: 'rgba(212,169,74,0.3)',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Kicker tint={colors.fog}>CUSTOM BID</Kicker>
              <View style={{ flexDirection: 'row', gap: 30 }}>
                <Stepper
                  icon={GlassWater}
                  label="Chasers"
                  value={localChasers}
                  tint={colors.stop}
                  decDisabled={localChasers <= minBid.chasers}
                  onDec={() => setLocalChasers((c) => Math.max(minBid.chasers, c - 1))}
                  onInc={() => setLocalChasers((c) => c + 1)}
                />
                <Stepper
                  icon={Coins}
                  label="Points"
                  value={localPoints}
                  tint={BRASS_GLOW}
                  decDisabled={localPoints <= minBid.points}
                  onDec={() => setLocalPoints((p) => Math.max(minBid.points, p - 1))}
                  onInc={() => setLocalPoints((p) => p + 1)}
                />
              </View>
              <Pressable onPress={placeCustomBid} disabled={!customValid}>
                <View
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 32,
                    borderRadius: 14,
                    backgroundColor: customValid ? BRASS : FELT_DEEP,
                    borderWidth: 1.5,
                    borderColor: customValid ? BRASS_GLOW : colors.rim,
                    opacity: customValid ? 1 : 0.5,
                  }}
                >
                  <Text style={{ color: FELT_SHADOW, fontSize: 15, fontWeight: '900', letterSpacing: 1 }}>
                    PLACE BID
                  </Text>
                </View>
              </Pressable>
            </View>

            <LotPlaque poolSize={poolSize} />
          </View>
        )}

        {/* ── DISTRIBUTING ────────────────────────────────────────────── */}
        {distributing && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <SharedChaserDistributor
              poolSize={poolSize}
              assignments={assignments}
              displayNames={displayNames}
              avatars={avatars}
              selfId={playerId}
              isDistributor={isWinner}
              distributorId={winnerId}
              deadlineAt={distributeDeadlineAt}
              windowMs={distributeMs}
              clockOffset={clockOffset}
              onAssign={(pid) => onAction('ASSIGN', { target_player_id: pid })}
              onSubmit={() => onAction('SUBMIT')}
              onExpire={() => onAction('EXPIRE_DISTRIBUTE')}
              accent={{ tint: BRASS_GLOW, tintGlow: BRASS, surface: FELT_SHADOW }}
            />
          </View>
        )}
      </View>

      {/* Reveal overlay */}
      {done && (
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
              backgroundColor: 'rgba(3,15,9,0.88)',
            },
            revealStyle,
          ]}
        >
          {!currentBid ? (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Gavel size={48} color={colors.fog} strokeWidth={2} />
              <Text style={{ color: colors.chalk, fontSize: 22, fontWeight: '900', letterSpacing: 1 }}>
                NO BIDS
              </Text>
              <Text style={{ color: colors.fog, fontSize: 14, fontWeight: '700' }}>
                Nobody drinks this round
              </Text>
            </View>
          ) : isWinner ? (
            <View
              style={{
                alignItems: 'center',
                paddingVertical: 26,
                paddingHorizontal: 30,
                borderRadius: 20,
                borderWidth: 2.5,
                borderColor: BRASS,
                backgroundColor: FELT_SHADOW,
                gap: 8,
              }}
            >
              <Gavel size={40} color={BRASS_GLOW} strokeWidth={2.5} />
              <Text style={{ color: colors.chalk, fontSize: 20, fontWeight: '900', letterSpacing: 1 }}>
                YOU RAN THE TABLE
              </Text>
              <Text style={{ color: colors.fog, fontSize: 13, fontWeight: '700' }}>
                Paid {currentBid.chasers} chaser{currentBid.chasers === 1 ? '' : 's'} · {currentBid.points} pts
              </Text>
            </View>
          ) : (
            <View
              style={{
                alignItems: 'center',
                paddingVertical: 26,
                paddingHorizontal: 30,
                borderRadius: 20,
                borderWidth: 2.5,
                borderColor: BRASS,
                backgroundColor: FELT_SHADOW,
                gap: 8,
              }}
            >
              {myAssigned > 0 ? (
                <>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {Array.from({ length: myAssigned }, (_, i) => (
                      <GlassWater key={i} size={32} color={colors.stop} strokeWidth={2.5} />
                    ))}
                  </View>
                  <Text style={{ color: colors.chalk, fontSize: 20, fontWeight: '900', letterSpacing: 1 }}>
                    POURED {myAssigned}
                  </Text>
                </>
              ) : (
                <>
                  <Check size={36} color={colors.go} strokeWidth={3} />
                  <Text style={{ color: colors.chalk, fontSize: 20, fontWeight: '900', letterSpacing: 1 }}>
                    SPARED
                  </Text>
                </>
              )}
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
};
