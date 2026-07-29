import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Bomb, Flame, GlassWater } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MiniGameProps } from '../ActiveGameScreen';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { CountdownRing } from './CountdownRing';
import {
  BOMB_SIZE,
  DEFAULT_PHYSICS_CONFIG,
  bombExitSide,
  stepBombPhysics,
  type ExitSide,
} from './flyingBombPhysics';

// Must match the backend's FlyingBombGame constants
const ROUND_MS = 30_000;
// Send EXPIRE a beat after the corrected deadline so the server (whose clock
// is authoritative) never sees it early; retry until the round resolves.
const EXPIRE_SLACK_MS = 400;
const EXPIRE_RETRY_MS = 1_000;
// Ring flips to its danger color once this little time is left — mirrored
// exactly in FlyingBombTutorial's mockup ring.
const LOW_TIME_THRESHOLD_MS = 5_000;

interface BombState {
  holder_id: string;
  seq: number;
  entry_side: ExitSide | null;
  // Screen-widths-per-second / screen-heights-per-second — NOT raw px/s.
  // Device-independent for the same reason y_position is normalized to
  // 0..1: a fling that's 4 screen-widths/s reads as equally "hard" whether
  // it was thrown on a 350pt phone or a 1200pt tablet, and whichever device
  // receives it reconstructs local pixels from its own dimensions.
  velocity_x: number | null;
  velocity_y: number | null;
  y_position: number | null;
}

// One bomb this client currently holds — remounted (fresh `key`) every time
// its seq advances, so a returning bomb always gets a clean spawn instead of
// fighting a component instance whose shared values already settled.
interface LocalBomb {
  key: string;
  id: string;
  entrySide: ExitSide | null;
  // Normalized (widths/heights per second) — see BombState.
  velocityX: number | null;
  velocityY: number | null;
  yPosition: number | null;
}

const BG = '#170D0B'; // warm near-black with a red cast — matches the accent, no navy
const ACCENT = '#B91C1C';
const ACCENT_GLOW = '#F87171';

// ── Bomb sprite — self-contained drag physics, driven entirely by shared
// values. The parent only ever mounts/unmounts these; per-frame motion never
// touches React state. ──────────────────────────────────────────────────────

function BombSprite({
  entrySide,
  velocityX,
  velocityY,
  yPosition,
  playing,
  playWidth,
  playHeight,
  onThrow,
}: {
  entrySide: ExitSide | null;
  // Normalized (widths/heights per second) — denormalized to this device's
  // own local pixels below, immediately on entry into live physics.
  velocityX: number | null;
  velocityY: number | null;
  yPosition: number | null;
  playing: boolean;
  playWidth: number;
  playHeight: number;
  // Reports back in the same normalized units it received — see the
  // playWidth/playHeight divide in handleExit below.
  onThrow: (exitSide: ExitSide, velocityX: number, velocityY: number, yFraction: number) => void;
}): React.ReactElement {
  const initialX =
    entrySide === 'left'
      ? -BOMB_SIZE / 2
      : entrySide === 'right'
        ? playWidth + BOMB_SIZE / 2
        : playWidth / 2;
  const minY = BOMB_SIZE / 2;
  const maxY = Math.max(minY, playHeight - BOMB_SIZE / 2);
  const initialY = Math.min(maxY, Math.max(minY, (yPosition ?? 0.5) * playHeight));

  const x = useSharedValue(initialX);
  const y = useSharedValue(initialY);
  // The live velocity vector, in this device's own local px/s. A network
  // arrival's normalized (widths/s, heights/s) is denormalized against this
  // device's own playWidth/playHeight right here — no separate "kick it
  // off" effect needed — so a bomb that arrives already moving and is never
  // touched still coasts through under its own momentum, same as one a
  // player just released, and at the same *perceived* (screen-relative)
  // speed it left the previous screen at, whatever that screen's size was.
  const vx = useSharedValue((velocityX ?? 0) * playWidth);
  const vy = useSharedValue((velocityY ?? 0) * playHeight);
  const hasExited = useSharedValue(false);
  const dragging = useSharedValue(false);

  const onThrowRef = useRef(onThrow);
  onThrowRef.current = onThrow;
  function handleExit(exitSide: ExitSide, exitVxPx: number, exitVyPx: number, yFraction: number) {
    // Normalize back to widths/heights-per-second before it leaves this
    // device — the wire format (and the next device's own denormalize
    // above) only ever deals in screen-relative units, never raw pixels.
    onThrowRef.current(
      exitSide,
      exitVxPx / playWidth,
      exitVyPx / playHeight,
      Math.min(1, Math.max(0, yFraction)),
    );
  }

  // One physics loop drives both axes together, exactly like a thrown
  // object: see flyingBombPhysics.ts's stepBombPhysics for the friction +
  // wall-bounce model itself (shared verbatim with FlyingBombTutorial, so
  // the two can't drift apart). This loop is just the wiring: feed it the
  // current body, write the result back to the shared values, then resolve
  // horizontal exit — the one thing that isn't part of the shared stepper,
  // since only this screen knows its own playWidth.
  useFrameCallback((frame) => {
    'worklet';
    if (dragging.value || hasExited.value) return;
    const dt = typeof frame.timeSincePreviousFrame === 'number' ? frame.timeSincePreviousFrame : 16.7;

    const next = stepBombPhysics(
      { x: x.value, y: y.value, vx: vx.value, vy: vy.value },
      dt,
      { minY, maxY },
      DEFAULT_PHYSICS_CONFIG,
    );
    x.value = next.x;
    y.value = next.y;
    vx.value = next.vx;
    vy.value = next.vy;

    const exitSide = bombExitSide(x.value, playWidth, BOMB_SIZE);
    if (exitSide) {
      hasExited.value = true;
      runOnJS(handleExit)(exitSide, vx.value, vy.value, y.value / playHeight);
    }
  });

  const pan = Gesture.Pan()
    .enabled(playing)
    .onBegin(() => {
      dragging.value = true;
      vx.value = 0; // the finger owns motion now, not leftover inertia on either axis
      vy.value = 0;
    })
    .onChange((e) => {
      x.value += e.changeX;
      // Solid wall while dragging too — the bomb can't be dragged past the
      // top/bottom edge, only up to it.
      y.value = Math.min(maxY, Math.max(minY, y.value + e.changeY));
    })
    .onEnd((e) => {
      dragging.value = false;
      vx.value = e.velocityX;
      vy.value = e.velocityY;
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - BOMB_SIZE / 2 },
      { translateY: y.value - BOMB_SIZE / 2 },
    ],
  }));

  // Fuse flicker — a small looping flame that never stops while the bomb's alive
  const flicker = useSharedValue(0);
  useEffect(() => {
    flicker.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 220, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.3, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const flameStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + flicker.value * 0.4,
    transform: [{ scale: 0.85 + flicker.value * 0.3 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: BOMB_SIZE,
            height: BOMB_SIZE,
          },
          style,
        ]}
      >
        <View
          style={{
            width: BOMB_SIZE,
            height: BOMB_SIZE,
            borderRadius: BOMB_SIZE / 2,
            backgroundColor: '#1C1917',
            borderWidth: 3,
            borderColor: '#3F3F46',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bomb size={BOMB_SIZE * 0.5} color={colors.chalk} strokeWidth={2} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: -14, left: BOMB_SIZE / 2 - 10 },
            flameStyle,
          ]}
        >
          <Flame size={20} color="#FB923C" fill="#F59E0B" strokeWidth={1.5} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export const FlyingBombGameUI: React.FC<MiniGameProps> = ({
  gameState,
  onAction,
  clockOffset,
}) => {
  const { playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();

  const status = (gameState.status as string) ?? 'PLAYING';
  const bombs = (gameState.bombs as Record<string, BombState>) ?? {};
  const roundMs = (gameState.round_ms as number) ?? ROUND_MS;
  const roundEndAt = (gameState.round_end_at as number) ?? 0;

  const playing = status === 'PLAYING';
  const done = status === 'DONE';

  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  // ── Play area measurement — bombs spawn/decay relative to this box ──────
  const [playSize, setPlaySize] = useState({ width: 0, height: 0 });

  // ── Reconcile the bombs I'm holding against the last broadcast state.
  // Keyed by `${id}-${seq}` so a bomb that returns to me later remounts
  // fresh instead of reusing an instance whose shared values already
  // settled at the edge it last exited from. ──────────────────────────────
  const [localBombs, setLocalBombs] = useState<LocalBomb[]>([]);
  useEffect(() => {
    if (!playerId) return;
    setLocalBombs((prev) => {
      const prevBySpawnKey = new Set(prev.map((b) => b.key));
      const next: LocalBomb[] = [];
      for (const [id, bomb] of Object.entries(bombs)) {
        if (bomb.holder_id !== playerId) continue;
        const key = `${id}-${bomb.seq}`;
        const existing = prev.find((b) => b.id === id);
        if (existing && prevBySpawnKey.has(key) && existing.key === key) {
          next.push(existing);
        } else {
          next.push({
            key,
            id,
            entrySide: bomb.entry_side,
            velocityX: bomb.velocity_x,
            velocityY: bomb.velocity_y,
            yPosition: bomb.y_position,
          });
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.bombs, playerId]);

  function handleThrow(id: string) {
    // velocityX/velocityY arrive already normalized (widths/heights per
    // second) — BombSprite.handleExit converts from its own local px/s
    // before calling this, so nothing device-specific crosses the wire.
    return (exitSide: ExitSide, velocityX: number, velocityY: number, yFraction: number) => {
      setLocalBombs((prev) => prev.filter((b) => b.id !== id));
      onActionRef.current('THROW_BOMB', {
        bomb_id: id,
        exit_side: exitSide,
        velocity_x: velocityX,
        velocity_y: velocityY,
        y_position: yFraction,
      });
    };
  }

  // Deadline watchdog — every client nudges the server once the round shuts;
  // the server validates against its own clock before resolving
  useEffect(() => {
    if (!playing || !roundEndAt) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const wait = Math.max(0, roundEndAt - clockOffset - Date.now()) + EXPIRE_SLACK_MS;
    const timer = setTimeout(() => {
      onActionRef.current('EXPIRE');
      retry = setInterval(() => onActionRef.current('EXPIRE'), EXPIRE_RETRY_MS);
    }, wait);
    return () => {
      clearTimeout(timer);
      if (retry) clearInterval(retry);
    };
  }, [roundEndAt, playing, clockOffset]);

  const myBombCount = localBombs.length;

  // Final tally re-derived from the broadcast state — same trust model as
  // closest_average/coin_flip: the round's own state is authoritative, no
  // separate reveal payload needed.
  const finalBombsHeld = playerId
    ? Object.values(bombs).filter((b) => b.holder_id === playerId).length
    : 0;
  const caught = done && finalBombsHeld > 0;

  const revealOpacity = useSharedValue(0);
  useEffect(() => {
    if (!done) return;
    revealOpacity.value = withDelay(250, withTiming(1, { duration: 200 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  const revealStyle = useAnimatedStyle(() => ({ opacity: revealOpacity.value }));

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 420,
          alignSelf: 'center',
          paddingHorizontal: 20,
          paddingTop: 24 + insets.top,
          paddingBottom: 20 + insets.bottom,
        }}
      >
        {/* Round timer — a numeric ring instead of a bar, so the remaining
            whole seconds are always legible at a glance, not just implied
            by a shrinking width. No in-screen game title, matching every
            other live GameUI (the name lives in the tutorial/rules chrome,
            not baked into gameplay). */}
        <View style={{ alignItems: 'center', opacity: playing || done ? 1 : 0 }}>
          <CountdownRing
            deadlineAt={roundEndAt}
            clockOffset={clockOffset}
            totalMs={roundMs}
            active={playing}
            size={92}
            strokeWidth={7}
            precision="seconds"
            lowTimeThresholdMs={LOW_TIME_THRESHOLD_MS}
            highTimeColor={ACCENT_GLOW}
            lowTimeColor={colors.stop}
          />
        </View>

        {/* Status chip */}
        <View style={{ alignItems: 'center', marginTop: 14 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 16,
              borderRadius: 18,
              backgroundColor: myBombCount > 0 ? ACCENT : colors.surface,
              borderWidth: 1.5,
              borderColor: myBombCount > 0 ? ACCENT_GLOW : colors.rim,
            }}
          >
            <Bomb size={16} color={colors.chalk} strokeWidth={2.5} />
            <Text
              style={{
                ...typography.label,
                color: colors.chalk,
                fontSize: 13,
                fontWeight: '800',
              }}
            >
              {myBombCount === 0
                ? "YOU'RE CLEAR"
                : `HOLDING ${myBombCount} — SWIPE IT AWAY`}
            </Text>
          </View>
        </View>

        {/* Play area */}
        <View
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setPlaySize({ width, height });
          }}
          style={{ flex: 1, marginTop: 16 }}
        >
          {playSize.width > 0 &&
            localBombs.map((b) => (
              <BombSprite
                key={b.key}
                entrySide={b.entrySide}
                velocityX={b.velocityX}
                velocityY={b.velocityY}
                yPosition={b.yPosition}
                playing={playing}
                playWidth={playSize.width}
                playHeight={playSize.height}
                onThrow={handleThrow(b.id)}
              />
            ))}
        </View>
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
              backgroundColor: 'rgba(10,10,15,0.82)',
            },
            revealStyle,
          ]}
        >
          <View
            style={{
              alignItems: 'center',
              paddingVertical: 26,
              paddingHorizontal: 30,
              borderRadius: 20,
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.3)',
              backgroundColor: caught ? colors.stop : colors.go,
              maxWidth: 320,
            }}
          >
            <Text
              style={{
                color: colors.chalk,
                fontSize: 24,
                fontWeight: '900',
                letterSpacing: 2,
              }}
            >
              {caught ? 'BOOM!' : "YOU'RE CLEAR"}
            </Text>
            {caught && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <GlassWater size={20} color={colors.chalk} strokeWidth={2.5} />
                <Text style={{ color: colors.chalk, fontSize: 20, fontWeight: '900' }}>
                  {finalBombsHeld} {finalBombsHeld === 1 ? 'CHASER' : 'CHASERS'}
                </Text>
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
};
