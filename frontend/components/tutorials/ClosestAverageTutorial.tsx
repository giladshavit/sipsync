import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { colors } from '@/constants/design';

// A single scripted pass over a miniature replica of the real game screen:
// a finger drags the slider to a higher number, then taps LOCK IN. Runs
// once and holds — same run-once convention as the other tutorials.

type Stage = 'idle' | 'drag' | 'settle' | 'move' | 'press' | 'locked';

const START_VALUE = 50;
const END_VALUE = 72;
const MAX_NUMBER = 99;

const T_DRAG = 350;
const DRAG_MS = 900;
const T_SETTLE = T_DRAG + DRAG_MS;
const HOLD_MS = 400;
const T_MOVE = T_SETTLE + HOLD_MS;
const MOVE_MS = 450;
const T_PRESS = T_MOVE + MOVE_MS;
const PRESS_MS = 160;
const T_LOCKED = T_PRESS + PRESS_MS + 150;

const PHONE_W = 210;
const PHONE_H = 300;
const CONTENT_W = 164;

const TRACK_W = 150;
const TRACK_H = 26;
const THUMB = 22;
const TRACK_X = (CONTENT_W - TRACK_W) / 2;

const BUTTON_W = 108;
const BUTTON_H = 32;
const FINGER_SIZE = 28;
// The tap-gesture asset's visual "tip" sits below and right of the image's
// own center, so nudge the anchor to line the tip up with the thumb/button.
const FINGER_Y_NUDGE = 10;
const FINGER_X_NUDGE = 8;

// Layout of the content column, top to bottom, all centered horizontally —
// named offsets (not measured), verified by hand against a real render, so
// the finger's static anchor points line up with what's actually on screen.
const NUMBER_H = 40;
const GAP_1 = 12;
const TRACK_TOP = NUMBER_H + GAP_1;
const TRACK_CENTER_Y = TRACK_TOP + TRACK_H / 2;
const GAP_2 = 16;
const BUTTON_TOP = TRACK_TOP + TRACK_H + GAP_2;
const BUTTON_CENTER_Y = BUTTON_TOP + BUTTON_H / 2;
const BUTTON_CENTER_X = CONTENT_W / 2;

function thumbCenterX(v: number): number {
  'worklet';
  return TRACK_X + (v / MAX_NUMBER) * (TRACK_W - THUMB) + THUMB / 2;
}

// ── Mini replica of ClosestAverageGameUI's slider ───────────────────────────

function MiniSlider({ value }: { value: SharedValue<number> }): React.ReactElement {
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbCenterX(value.value) - THUMB / 2 }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(THUMB, (value.value / MAX_NUMBER) * TRACK_W),
  }));

  return (
    <View
      style={{
        width: TRACK_W,
        height: TRACK_H,
        borderRadius: TRACK_H / 2,
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.rim,
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={[
          { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(245,158,11,0.28)' },
          fillStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: colors.amber,
            borderWidth: 2.5,
            borderColor: colors.amberGlow,
          },
          thumbStyle,
        ]}
      />
    </View>
  );
}

function MiniLockButton({ stage }: { stage: Stage }): React.ReactElement {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (stage === 'press') {
      scale.value = withSequence(
        withTiming(0.9, { duration: 90, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const locked = stage === 'locked';

  return (
    <Animated.View
      style={[
        {
          width: BUTTON_W,
          height: BUTTON_H,
          borderRadius: BUTTON_H / 2,
          backgroundColor: locked ? colors.go : colors.amber,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 5,
        },
        buttonStyle,
      ]}
    >
      {locked && <Check size={13} color={colors.chalk} strokeWidth={3} />}
      <Text style={{ color: locked ? colors.chalk : '#241A05', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }}>
        {locked ? 'LOCKED IN' : 'LOCK IN'}
      </Text>
    </Animated.View>
  );
}

// ── The animated finger — rides the thumb while dragging, then travels
// down to tap the button. Nested inside the same content column as the
// slider/button (not the outer phone frame), so its absolute coordinates
// share their coordinate frame instead of drifting by the header's height.

function ScriptedFinger({
  stage,
  value,
}: {
  stage: Stage;
  value: SharedValue<number>;
}): React.ReactElement {
  const opacity = useSharedValue(0);
  const moveX = useSharedValue(0);
  const moveY = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (stage === 'drag') {
      opacity.value = withTiming(1, { duration: 180 });
    }
    if (stage === 'move') {
      // Cancel FINGER_X_NUDGE back out here so the button tap stays centered
      // on the button — only the drag/thumb phase wants the rightward nudge.
      moveX.value = withTiming(BUTTON_CENTER_X - thumbCenterX(END_VALUE) - FINGER_X_NUDGE, {
        duration: MOVE_MS,
        easing: Easing.inOut(Easing.quad),
      });
      moveY.value = withTiming(BUTTON_CENTER_Y - TRACK_CENTER_Y, {
        duration: MOVE_MS,
        easing: Easing.inOut(Easing.quad),
      });
    }
    if (stage === 'press') {
      scale.value = withSequence(withTiming(0.85, { duration: 90 }), withTiming(1, { duration: 110 }));
    }
    if (stage === 'locked') {
      opacity.value = withDelay(200, withTiming(0, { duration: 200 }));
    }
    if (stage === 'idle') {
      opacity.value = 0;
      moveX.value = 0;
      moveY.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: thumbCenterX(value.value) - FINGER_SIZE / 2 + FINGER_X_NUDGE + moveX.value },
      { translateY: TRACK_CENTER_Y - FINGER_SIZE / 2 + FINGER_Y_NUDGE + moveY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          top: 0,
          zIndex: 30,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 10,
          elevation: 20,
        },
        fingerStyle,
      ]}
    >
      <Image source={require('@/assets/images/tap-gesture.png')} style={{ width: FINGER_SIZE, height: FINGER_SIZE }} />
    </Animated.View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function ClosestAverageTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('idle');
  const [displayValue, setDisplayValue] = useState(START_VALUE);
  const value = useSharedValue(START_VALUE);

  useAnimatedReaction(
    () => Math.round(value.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setDisplayValue)(current);
    },
  );

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage('drag'), T_DRAG),
      setTimeout(() => setStage('settle'), T_SETTLE),
      setTimeout(() => setStage('move'), T_MOVE),
      setTimeout(() => setStage('press'), T_PRESS),
      setTimeout(() => setStage('locked'), T_LOCKED),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (stage === 'drag') {
      value.value = withTiming(END_VALUE, { duration: DRAG_MS, easing: Easing.inOut(Easing.quad) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: PHONE_W,
          height: PHONE_H,
          backgroundColor: colors.ink,
          borderRadius: 26,
          borderWidth: 2,
          borderColor: colors.rim,
          overflow: 'hidden',
          alignItems: 'center',
          paddingTop: 14,
        }}
      >
        <View style={{ width: 36, height: 3, backgroundColor: colors.rim, borderRadius: 2, marginBottom: 16 }} />

        <View style={{ width: CONTENT_W }}>
          <View style={{ height: NUMBER_H, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Text style={{ color: colors.chalk, fontSize: 30, fontWeight: '900' }}>{displayValue}</Text>
          </View>

          <View style={{ marginTop: GAP_1, height: TRACK_H, alignItems: 'center' }}>
            <MiniSlider value={value} />
          </View>

          <View style={{ alignItems: 'center', marginTop: GAP_2 }}>
            <MiniLockButton stage={stage} />
          </View>

          <ScriptedFinger stage={stage} value={value} />
        </View>
      </View>
    </View>
  );
}
