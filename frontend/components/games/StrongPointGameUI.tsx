import React, { useEffect, useRef, useState } from 'react';
import { Text, View, Pressable, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import type { MiniGameProps } from '../ActiveGameScreen';
import { colors, typography } from '@/constants/design';

const DEFAULT_DIAMETER_PX = 40;
const DEFAULT_GROW_MS = 30_000;
const FLASH_IN_MS = 90;

type Phase = 'pending' | 'live' | 'resolved';
type Outcome = 'hit' | 'miss';

export const StrongPointGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { width, height } = useWindowDimensions();

  const [phase, setPhase] = useState<Phase>('pending');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reactionMs, setReactionMs] = useState<number | null>(null);

  // Refs so the tap handler and timers always read the latest value without
  // stale closures (same pattern as ReflexGameUI's isGreenRef)
  const phaseRef = useRef<Phase>('pending');
  const liveStartRef = useRef<number | null>(null);

  const activateAt =
    typeof gameState.activate_at === 'number' ? gameState.activate_at : 0;
  const target = (gameState.target as { nx: number; ny: number } | undefined) ?? {
    nx: 0.5,
    ny: 0.5,
  };
  const diameter =
    typeof gameState.target_diameter_px === 'number'
      ? gameState.target_diameter_px
      : DEFAULT_DIAMETER_PX;
  const radius = diameter / 2;
  const growMs =
    typeof gameState.grow_duration_ms === 'number'
      ? gameState.grow_duration_ms
      : DEFAULT_GROW_MS;

  // Safe bounds so the circle is always fully on-screen regardless of device
  // size — the same fixed diameter reads huge on a small phone and modest on
  // a tablet, but never clips an edge.
  const safeW = Math.max(0, width - diameter);
  const safeH = Math.max(0, height - diameter);
  const targetX = radius + target.nx * safeW;
  const targetY = radius + target.ny * safeH;

  // Growth is purely cosmetic — the hit-zone is already full-size the
  // instant activate_at passes, this only animates the visible dot. Linear
  // easing so it reads as a constant, unhurried rate rather than a snappy
  // pop — most rounds resolve long before this finishes.
  const growth = useSharedValue(0);
  const hitFlash = useSharedValue(0);
  const missFlash = useSharedValue(0);

  useEffect(() => {
    if (!activateAt) return;
    // activate_at is server UTC ms; adjust by our clock offset so the circle
    // appears at the correct physical moment regardless of clock skew
    const delay = Math.max(0, activateAt - clockOffset - Date.now());

    const timer = setTimeout(() => {
      // A too-early tap during 'pending' already resolved the round on this
      // client — don't let this stale timer resurrect the dot afterward
      if (phaseRef.current === 'resolved') return;
      phaseRef.current = 'live';
      setPhase('live');
      liveStartRef.current = Date.now();
      growth.value = withTiming(1, { duration: growMs, easing: Easing.linear });
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateAt, clockOffset, growMs]);

  function handleTap(e: GestureResponderEvent) {
    if (phaseRef.current === 'resolved') return;

    const { locationX, locationY } = e.nativeEvent;
    const now = Date.now();
    const dx = locationX - targetX;
    const dy = locationY - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const isHit = phaseRef.current === 'live' && dist <= radius;

    phaseRef.current = 'resolved';
    setPhase('resolved');
    setOutcome(isHit ? 'hit' : 'miss');
    if (isHit && liveStartRef.current !== null) {
      setReactionMs(now - liveStartRef.current);
    }
    cancelAnimation(growth); // stop growing the instant the tap lands

    // Rises and holds — no fade back — same solid-screen-until-the-room-
    // moves-on convention as HumanTimerGameUI's "tapped" phase
    const flashValue = isHit ? hitFlash : missFlash;
    flashValue.value = withTiming(1, {
      duration: FLASH_IN_MS,
      easing: Easing.out(Easing.quad),
    });

    onAction(isHit ? 'CLICK' : 'MISS', { local_ts: now });
  }

  const growthStyle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.max(growth.value, 0.01) }],
  }));
  const hitFlashStyle = useAnimatedStyle(() => ({ opacity: hitFlash.value }));
  const missFlashStyle = useAnimatedStyle(() => ({ opacity: missFlash.value }));

  // Stays on screen the whole time — pending or live — instead of vanishing
  // once the zone activates, so the screen never looks like it's just idling
  const label =
    phase === 'resolved' ? (outcome === 'hit' ? 'HIT!' : 'MISS!') : 'STAY FOCUSED';

  const reactionLabel =
    reactionMs !== null ? `${(reactionMs / 1000).toFixed(2)}s` : null;

  return (
    <Pressable style={{ flex: 1, backgroundColor: colors.ink }} onPress={handleTap}>
      <View style={{ flex: 1 }}>
        {/* Target circle — only rendered once live. Nothing on screen hints
            at where (or whether) it'll appear before then, so the screen
            stays genuinely empty through the whole silent wait. */}
        {phase === 'live' && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: targetX - radius,
              top: targetY - radius,
              width: diameter,
              height: diameter,
            }}
          >
            <Animated.View
              style={[
                {
                  width: diameter,
                  height: diameter,
                  borderRadius: diameter / 2,
                  backgroundColor: colors.electric,
                  borderWidth: 3,
                  borderColor: '#8FF0FF',
                },
                growthStyle,
              ]}
            />
          </View>
        )}

        {/* Flash overlays — rise and hold solid, same convention as
            HumanTimerGameUI's "tapped" screen. Rendered under the label so
            HIT!/MISS! and the reaction time stay readable on top of it. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.go,
            },
            hitFlashStyle,
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.stop,
            },
            missFlashStyle,
          ]}
        />

        {/* Ambient status label — no early hint of when the zone activates,
            the silence itself is the tension */}
        <View style={{ marginTop: 64, alignItems: 'center' }}>
          <Text
            style={{
              ...typography.label,
              color: phase === 'resolved' ? colors.chalk : colors.fog,
              fontSize: 12,
              letterSpacing: 4,
            }}
          >
            {label}
          </Text>
          {reactionLabel && (
            <Text
              style={{
                color: colors.chalk,
                fontSize: 24,
                fontWeight: '900',
                marginTop: 10,
              }}
            >
              {reactionLabel}
            </Text>
          )}
          {phase === 'resolved' && (
            <Animated.Text
              entering={FadeIn.delay(400).duration(300)}
              style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 22 }}
            >
              Waiting for the others…
            </Animated.Text>
          )}
        </View>
      </View>
    </Pressable>
  );
};
