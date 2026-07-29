import React, { useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

// Two independent mockups shown side by side — not two player roles (everyone
// in this game sees the same kind of screen), but a compare/contrast pair:
// how a round is won next to how it's lost. Both mockups grow the same dot,
// on the same clock — the miss phone taps the (wrong) spot first, the hit
// phone taps the (right) spot a beat later. Both run once and freeze on
// their final frame.

const PHONE_W = 134;
const PHONE_H = 224;
const ROW_GAP = 14;

const DOT_MAX = 32; // mini-phone-scaled hit-zone size — smaller than the real 40px reads
const DOT_APPEAR_MS = 1_600; // stands in for the real 3 s silent wait
// The real circle grows at a constant rate over a full 30 s — compressed
// here for watchability, but still linear, so it reads as "slow and steady"
// rather than a snappy pop.
const DOT_GROW_MS = 6_000;
// The hit-zone is already live at full size the instant the dot appears, so
// both taps land while it's still small — neither one waits for it to
// finish growing. Miss taps first; hit taps a beat after, once the dot's
// grown just large enough to clearly "catch."
const MISS_TAP_DELAY_MS = 1_000;
const HIT_TAP_DELAY_MS = 2_000;

const FLASH_IN_MS = 90;

// tap-gesture.png is a pointing-up hand — the actual fingertip sits near the
// top of the image, not its center. Anchoring the image by its own center
// (the naive default) leaves the fingertip floating well above whatever
// it's supposed to be touching. Shift down/right so the fingertip itself —
// not the image's bounding box — lands on the target.
const FINGER_SIZE = 40;
const FINGER_TIP_OFFSET_X = 5;
const FINGER_TIP_OFFSET_Y = 22;
// The finger travels in from a bit further down as it fades in — same
// approach-then-press idiom as ReflexTutorial's finger — instead of just
// materializing already in place.
const FINGER_APPROACH_OFFSET = 26;

// Three distinct beats, same proportions ReflexTutorial uses for its own
// finger: (1) approach — fades in while sliding up into position; (2) a
// short static hover, so the finger visibly sits there arrived and still
// before anything else happens; (3) the press itself — a clear scale
// bounce, not blended into the approach. Squeezing these together (or
// starting the press before the approach even finishes) is what made the
// tap read as just "the hand slides in," with no separate press beat.
const FINGER_APPROACH_MS = 200;
const FINGER_HOVER_MS = 280;
const FINGER_PRESS_DOWN_MS = 120;
const FINGER_PRESS_UP_MS = 220;
const FINGER_PRESS_START_MS = FINGER_APPROACH_MS + FINGER_HOVER_MS;
const FINGER_PRESS_END_MS = FINGER_PRESS_START_MS + FINGER_PRESS_DOWN_MS + FINGER_PRESS_UP_MS;
// The solid result screen waits for all three beats to actually play out
// and be seen before it rises, otherwise the press gets cut off.
const FINGER_HOLD_MS = FINGER_PRESS_END_MS + 60;

// ── Mini phone frame — matches CoinFlipTutorial's MiniPhone convention ─────

function MiniPhone({
  label,
  labelTint,
  children,
}: {
  label: string;
  labelTint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 22,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 32,
          height: 3,
          backgroundColor: colors.rim,
          borderRadius: 2,
          marginTop: 9,
          marginBottom: 8,
        }}
      />
      <View
        style={{
          flex: 1,
          width: '100%',
          backgroundColor: colors.ink,
          alignItems: 'center',
          paddingTop: 4,
        }}
      >
        <Text
          style={{
            color: labelTint,
            ...typography.label,
            fontSize: 9,
            letterSpacing: 1.5,
            fontWeight: '800',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </Text>
        <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </View>
      </View>
      <View
        style={{
          width: 44,
          height: 3,
          backgroundColor: colors.fog,
          borderRadius: 2,
          marginVertical: 8,
          opacity: 0.35,
        }}
      />
    </View>
  );
}

// ── Shared growing dot — solid fill, no border, so it never reads as a
// hollow ring while small (matches the live game's filled circle) ─────────

function GrowingDot({ growth }: { growth: Animated.SharedValue<number> }): React.ReactElement {
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ scale: Math.max(growth.value, 0.01) }],
  }));
  return (
    <Animated.View
      style={[
        { width: DOT_MAX, height: DOT_MAX, borderRadius: DOT_MAX / 2, backgroundColor: colors.electric },
        dotStyle,
      ]}
    />
  );
}

// ── One mockup, parameterized by outcome — both run the identical dot-growth
// timeline; only the tap's timing, position, and result color differ ──────

interface MockupProps {
  outcome: 'hit' | 'miss';
  tapDelayMs: number;
  // Where the finger lands, relative to the phone's screen. 'center' taps
  // the dot itself (a hit); 'corner' taps well away from it (a miss).
  tapAt: 'center' | 'corner';
}

function Mockup({ outcome, tapDelayMs, tapAt }: MockupProps): React.ReactElement {
  const growth = useSharedValue(0);
  const fingerOpacity = useSharedValue(0);
  const fingerApproach = useSharedValue(FINGER_APPROACH_OFFSET);
  const fingerScale = useSharedValue(1);
  const flash = useSharedValue(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(() => {
        growth.value = withTiming(1, { duration: DOT_GROW_MS, easing: Easing.linear });
      }, DOT_APPEAR_MS),
    );

    timers.push(
      setTimeout(() => {
        // Growth stops dead the instant the tap lands — same as the real
        // game — instead of continuing to animate underneath the result
        cancelAnimation(growth);
        // Beat 1 — approach: fades in while sliding up into position
        fingerOpacity.value = withTiming(1, { duration: FINGER_APPROACH_MS });
        fingerApproach.value = withTiming(0, {
          duration: FINGER_APPROACH_MS,
          easing: Easing.out(Easing.quad),
        });
        // Beat 2 — hover: nothing animates for FINGER_HOVER_MS, so the
        // finger visibly sits arrived and still before it presses
        // Beat 3 — press: a clear, separate scale bounce
        fingerScale.value = withDelay(
          FINGER_PRESS_START_MS,
          withSequence(
            withTiming(0.78, { duration: FINGER_PRESS_DOWN_MS, easing: Easing.in(Easing.quad) }),
            withTiming(1, { duration: FINGER_PRESS_UP_MS, easing: Easing.out(Easing.quad) }),
          ),
        );
        // Rises and holds — no fade back — matching the live game's
        // persistent post-tap screen. The finger stays visible on top of it
        // (see render order below) instead of disappearing.
        flash.value = withDelay(
          FINGER_HOLD_MS,
          withTiming(1, { duration: FLASH_IN_MS, easing: Easing.out(Easing.quad) }),
        );
      }, DOT_APPEAR_MS + tapDelayMs),
    );

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(growth);
      cancelAnimation(fingerOpacity);
      cancelAnimation(fingerApproach);
      cancelAnimation(fingerScale);
      cancelAnimation(flash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [
      { translateX: FINGER_TIP_OFFSET_X },
      { translateY: FINGER_TIP_OFFSET_Y + fingerApproach.value },
      { scale: fingerScale.value },
    ],
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  // Corner tap sits further from the edge than the finger's own resting
  // offset so the whole hand stays inside the frame once it's parked there
  // for good — nothing pokes out past the bottom once it settles.
  const fingerPosition =
    tapAt === 'corner'
      ? ({ position: 'absolute', right: 16, bottom: 32 } as const)
      : ({ position: 'absolute' } as const); // 'center' relies on the parent's flex centering

  return (
    <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <GrowingDot growth={growth} />

      {/* Solid hold — rendered before the finger so the finger stays
          visible on top of it once it's fully opaque, rather than getting
          covered */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: outcome === 'hit' ? colors.go : colors.stop,
          },
          flashStyle,
        ]}
      />

      {/* Anchored on the dot's center for a hit; pinned to the corner for a
          miss. fingerStyle's translateX/Y nudges the actual fingertip (not
          the image's bounding-box center) onto that point, and stays parked
          there — visible — through the final frozen frame. */}
      <Animated.View style={[fingerPosition, fingerStyle]}>
        <Image
          source={require('@/assets/images/tap-gesture.png')}
          style={{ width: FINGER_SIZE, height: FINGER_SIZE }}
        />
      </Animated.View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function StrongPointTutorial(): React.ReactElement {
  return (
    <View className="items-center">
      {/* Two independent screens, side by side, growing the same dot on the
          same clock — the miss phone taps the wrong spot first, the hit
          phone taps the dot itself a beat later */}
      <View style={{ flexDirection: 'row', gap: ROW_GAP }}>
        <MiniPhone label="Miss" labelTint={colors.stop}>
          <Mockup outcome="miss" tapDelayMs={MISS_TAP_DELAY_MS} tapAt="corner" />
        </MiniPhone>
        <MiniPhone label="Hit" labelTint={colors.electric}>
          <Mockup outcome="hit" tapDelayMs={HIT_TAP_DELAY_MS} tapAt="center" />
        </MiniPhone>
      </View>
    </View>
  );
}
