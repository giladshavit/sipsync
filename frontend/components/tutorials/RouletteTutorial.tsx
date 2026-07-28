import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Check, GlassWater, Skull } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Demo timeline: Tomer flips a safe card (+3), then Maya hits the poison.
// The whole story lands inside the tutorial screen's 5 s window, then loops.
const FINGER_IN_MS = 300;
const TAP1_MS = 900;
const SAFE_CAPTION_MS = 1_300;
const TURN2_MS = 2_300;
const TAP2_MS = 3_000;
const POISON_CAPTION_MS = 3_400;

const CARD_W = 82;
const CARD_H = 92;
const GAP_X = 8;
const GAP_Y = 10;

// Warm table tones, matching RouletteGameUI
const BG = '#221E1A';
const CARD_BG = '#2C2721';
const CARD_RIM = '#453D31';

// Grid slots: 3 columns × 2 rows, mirroring the real game screen
function slot(col: number, row: number): { left: number; top: number } {
  return { left: col * (CARD_W + GAP_X), top: row * (CARD_H + GAP_Y) };
}

const SLOT_A = slot(0, 0); // Tomer's safe pick
const SLOT_B = slot(1, 1); // Maya's poison
const FINGER_A = { x: SLOT_A.left + 16, y: SLOT_A.top + 18 };
const FINGER_B = { x: SLOT_B.left + 16, y: SLOT_B.top + 18 };

type Stage = 'intro' | 'safe' | 'turn2' | 'poison';

interface MiniCardProps {
  rotation: SharedValue<number>;
  back: React.ReactNode;
  slot: { left: number; top: number };
}

function MiniCard({ rotation, back, slot }: MiniCardProps): React.ReactElement {
  // The flip is faked with scaleX instead of a true 3D rotateY: a rotating
  // layer with perspective intersects sibling layers in z-space and visibly
  // slices whatever overlaps it (the tap finger). scaleX reads the same at
  // this size and stays flat.
  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(rotation.value, [0, 90], [1, 0], Extrapolation.CLAMP) },
    ],
    opacity: rotation.value < 90 ? 1 : 0,
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: interpolate(rotation.value, [90, 180], [0, 1], Extrapolation.CLAMP) },
    ],
    opacity: rotation.value >= 90 ? 1 : 0,
  }));

  const face = {
    position: 'absolute' as const,
    width: CARD_W,
    height: CARD_H,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return (
    <View style={{ position: 'absolute', ...slot, width: CARD_W, height: CARD_H }}>
      <Animated.View
        style={[
          face,
          { backgroundColor: CARD_BG, borderWidth: 1.5, borderColor: CARD_RIM },
          frontStyle,
        ]}
      >
        <GlassWater size={18} color={colors.fog} strokeWidth={2} />
      </Animated.View>
      <Animated.View style={[face, backStyle]}>{back}</Animated.View>
    </View>
  );
}

function ClosedMiniCard({ slot }: { slot: { left: number; top: number } }): React.ReactElement {
  return (
    <View
      style={{
        position: 'absolute',
        ...slot,
        width: CARD_W,
        height: CARD_H,
        backgroundColor: CARD_BG,
        borderWidth: 1.5,
        borderColor: CARD_RIM,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <GlassWater size={18} color={colors.fog} strokeWidth={2} />
    </View>
  );
}

export function RouletteTutorial(): React.ReactElement {
  const [stage, setStage] = useState<Stage>('intro');

  const rotationA = useSharedValue(0);
  const rotationB = useSharedValue(0);
  const fingerX = useSharedValue(FINGER_A.x);
  const fingerY = useSharedValue(FINGER_A.y);
  const fingerScale = useSharedValue(1);
  const fingerOpacity = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    function pressFinger() {
      fingerScale.value = withSequence(
        withTiming(0.78, { duration: 110, easing: Easing.in(Easing.quad) }),
        withTiming(1.0, { duration: 200, easing: Easing.out(Easing.quad) }),
      );
    }

    function startCycle() {
      setStage('intro');
      rotationA.value = 0;
      rotationB.value = 0;
      shake.value = 0;
      fingerScale.value = 1;
      fingerOpacity.value = 0;
      fingerX.value = FINGER_A.x;
      fingerY.value = FINGER_A.y;

      // Finger glides in over Tomer's card
      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(1, { duration: 250 });
        }, FINGER_IN_MS),
      );

      // Tap 1 → safe flip
      timers.push(
        setTimeout(() => {
          pressFinger();
          rotationA.value = withDelay(
            120,
            withTiming(180, { duration: 420, easing: Easing.inOut(Easing.cubic) }),
          );
        }, TAP1_MS),
      );
      timers.push(setTimeout(() => setStage('safe'), SAFE_CAPTION_MS));

      // Maya's turn — finger slides to the second card
      timers.push(
        setTimeout(() => {
          setStage('turn2');
          fingerX.value = withTiming(FINGER_B.x, {
            duration: 450,
            easing: Easing.inOut(Easing.quad),
          });
          fingerY.value = withTiming(FINGER_B.y, {
            duration: 450,
            easing: Easing.inOut(Easing.quad),
          });
        }, TURN2_MS),
      );

      // Tap 2 → poison flip + phone shake
      timers.push(
        setTimeout(() => {
          pressFinger();
          rotationB.value = withDelay(
            120,
            withTiming(180, { duration: 420, easing: Easing.inOut(Easing.cubic) }),
          );
          const hit = (amp: number) =>
            withTiming(amp, { duration: 50, easing: Easing.linear });
          shake.value = withDelay(
            420,
            withSequence(hit(-9), hit(9), hit(-7), hit(7), hit(-3), hit(0)),
          );
        }, TAP2_MS),
      );
      timers.push(setTimeout(() => setStage('poison'), POISON_CAPTION_MS));

      // Finger bows out — runs once and holds; replay button re-triggers it
      timers.push(
        setTimeout(() => {
          fingerOpacity.value = withTiming(0, { duration: 250 });
        }, POISON_CAPTION_MS + 700),
      );
    }

    startCycle();

    return () => {
      timers.forEach(clearTimeout);
      [rotationA, rotationB, fingerX, fingerY, fingerScale, fingerOpacity, shake].forEach(
        cancelAnimation,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fingerStyle = useAnimatedStyle(() => ({
    opacity: fingerOpacity.value,
    transform: [
      { translateX: fingerX.value },
      { translateY: fingerY.value },
      { scale: fingerScale.value },
    ],
  }));
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const turnName = stage === 'intro' || stage === 'safe' ? 'TOMER' : 'MAYA';

  return (
    <View className="items-center">
      {/* Phone-in-phone container — matches the other tutorials' frame */}
      <View
        className="items-center overflow-hidden"
        style={{
          width: 288,
          height: 450,
          backgroundColor: colors.surface,
          borderRadius: 34,
          borderWidth: 2,
          borderColor: colors.rim,
        }}
      >
        {/* Speaker grill */}
        <View
          style={{
            width: 80,
            height: 5,
            backgroundColor: colors.rim,
            borderRadius: 2,
            marginTop: 18,
            marginBottom: 14,
          }}
        />

        {/* Simulated game screen — warm dark table, matching the real board */}
        <Animated.View
          style={[
            {
              flex: 1,
              width: '100%',
              alignItems: 'center',
              backgroundColor: BG,
              paddingTop: 14,
            },
            shakeStyle,
          ]}
        >
          {/* Turn header */}
          <Text
            style={{
              color: stage === 'poison' ? colors.stop : colors.go,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textTransform: 'uppercase',
              fontWeight: '700',
            }}
          >
            {stage === 'poison' ? 'MAYA LOSES' : `${turnName}'S TURN`}
          </Text>

          {/* Mini card grid: 3 × 2, two scripted cards + four extras */}
          <View
            style={{
              width: CARD_W * 3 + GAP_X * 2,
              height: CARD_H * 2 + GAP_Y,
              marginTop: 16,
            }}
          >
            <MiniCard
              rotation={rotationA}
              slot={SLOT_A}
              back={
                <View
                  style={{
                    width: CARD_W,
                    height: CARD_H,
                    backgroundColor: CARD_BG,
                    borderWidth: 1.5,
                    borderColor: colors.go,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check size={16} color={colors.go} strokeWidth={2.5} />
                  <Text style={{ color: colors.amberGlow, fontSize: 16, fontWeight: '900' }}>
                    +3
                  </Text>
                  <Text
                    style={{
                      color: colors.fog,
                      ...typography.label,
                      fontSize: 8,
                      letterSpacing: 1,
                      textTransform: 'uppercase',
                      marginTop: 2,
                    }}
                  >
                    Tomer
                  </Text>
                </View>
              }
            />
            <ClosedMiniCard slot={slot(1, 0)} />
            <ClosedMiniCard slot={slot(2, 0)} />
            <ClosedMiniCard slot={slot(0, 1)} />
            <MiniCard
              rotation={rotationB}
              slot={SLOT_B}
              back={
                <View
                  style={{
                    width: CARD_W,
                    height: CARD_H,
                    backgroundColor: colors.stop,
                    borderWidth: 1.5,
                    borderColor: colors.chalk,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Skull size={22} color={colors.chalk} strokeWidth={2} />
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 4 }}>
                    <GlassWater size={10} color={colors.chalk} strokeWidth={2} />
                    <GlassWater size={10} color={colors.chalk} strokeWidth={2} />
                    <GlassWater size={10} color={colors.chalk} strokeWidth={2} />
                  </View>
                </View>
              }
            />
            <ClosedMiniCard slot={slot(2, 1)} />

            {/* Tapping finger, moving between the two scripted cards.
                zIndex keeps it above the mid-flip cards — a rotateY in
                progress otherwise pushes the card in front of the finger */}
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  zIndex: 30,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 12 },
                  shadowOpacity: 0.5,
                  shadowRadius: 16,
                  elevation: 30,
                },
                fingerStyle,
              ]}
            >
              <Image
                source={require('@/assets/images/tap-gesture.png')}
                style={{ width: 64, height: 64 }}
              />
            </Animated.View>
          </View>

          {/* Caption */}
          <View style={{ height: 44, justifyContent: 'center' }}>
            {stage === 'intro' && (
              <Text style={{ color: colors.fog, fontSize: 12 }}>
                Pick any card on your turn…
              </Text>
            )}
            {stage === 'safe' && (
              <Text style={{ color: colors.go, fontSize: 13, fontWeight: '700' }}>
                Safe! Tomer banks +3 points
              </Text>
            )}
            {stage === 'turn2' && (
              <Text style={{ color: colors.fog, fontSize: 12 }}>
                Now it&apos;s Maya&apos;s turn…
              </Text>
            )}
            {stage === 'poison' && (
              <Text style={{ color: colors.stop, fontSize: 13, fontWeight: '800' }}>
                POISON! −15 pts · 3 chasers
              </Text>
            )}
          </View>
        </Animated.View>

        {/* Home bar */}
        <View
          style={{
            width: 90,
            height: 5,
            backgroundColor: colors.fog,
            borderRadius: 2,
            marginVertical: 14,
            opacity: 0.35,
          }}
        />
      </View>
    </View>
  );
}
