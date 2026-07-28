import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Coins, Gavel, GlassWater, Minus, Plus } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// A real bid war, one mock phone, mirroring AuctionGameUI's own bidding
// screen control-for-control (bid plaque, both quick-bid chips, the custom
// panel's two steppers, the timer-reset). "You" bid first, get outbid once,
// then answer back — short enough to actually digest, and the two taps are
// exactly the two quick-bid chips (never the custom panel, which is only
// ever shown passively tracking the floor, for source fidelity — no need to
// also demonstrate its generic +/- taps here). Runs once and holds on the
// final bid, matching the other tutorials' run-once convention.

type Bidder = 'you' | 'p2';
type Action = 'chip_chaser' | 'chip_points' | null;

interface BidStep {
  chasers: number;
  points: number;
  bidder: Bidder;
  action: Action;
}

// You bid first (the floor, via the +1-chaser chip — proves the very first
// chaser raise lands on 1, not 2; see the floor-bug fix in AuctionGameUI's
// placeQuickBid) -> outbid once -> you answer via the +10-points chip. Ends
// there, on you back in the lead.
const STEPS: BidStep[] = [
  { chasers: 1, points: 0, bidder: 'you', action: 'chip_chaser' },
  { chasers: 1, points: 5, bidder: 'p2', action: null },
  { chasers: 1, points: 15, bidder: 'you', action: 'chip_points' },
];

const BIDDER_META: Record<Bidder, { name: string; ring: string }> = {
  you: { name: 'You', ring: '#F5D889' },
  p2: { name: 'Player 2', ring: '#7A5A9A' },
};

// Slower than a typical tutorial beat on purpose — this one has real numbers
// to read (two bidders, two currencies), so every step gets real time to
// land before the next begins.
const INITIAL_PAUSE_MS = 500;
const FINGER_RISE_MS = 380;
const TAP_HOLD_MS = 200;
const RETREAT_MS = 340;
const GAP_MS = 500;
const AUTO_HOLD_MS = 1_300;
const FINAL_HOLD_MS = 1_800;
// The countdown bar's own drain, decoupled from the step timings above —
// 3x slower than a first pass at this made it, so it reads as a real
// ticking clock instead of a nervous flicker. It's fine for a reset to
// interrupt this mid-drain (the next bid always resets it) — it's a rhythm
// cue, not a literal readout of the real 15s window.
const TIMER_DRAIN_MS = 3_300;

// Matches AuctionGameUI exactly — dark felt green table, brass currency accent
const FELT_DEEP = '#0B3D24';
const FELT_SHADOW = '#062015';
const BRASS = '#D4A94A';
const BRASS_GLOW = '#F5D889';

const PHONE_W = 176;
const PHONE_H = 320;

const FINGER = require('@/assets/images/tap-gesture.png');

// ── Finger — anchored below its target, pointing up at it (never centered
// over the button, so the button itself stays visible), and slides back
// down out of view after every tap instead of just vanishing ──────────────

type FingerPhase = 'idle' | 'rising' | 'tap' | 'retreating';

// Static anchor: the finger's resting frame sits this far below its target
// (well clear of it). translateY then does the actual reaching-up motion —
// negative values pull it up from that anchor, so the "risen" target has to
// be negative enough to cancel the anchor back out and land ON the button,
// not just less-far-below it.
const FINGER_ANCHOR_BELOW = -30;
const FINGER_HIDDEN_Y = 26; // further below the anchor — fully clear, opacity 0 anyway
const FINGER_TOUCH_Y = -29; // cancels the anchor down to a light touch on the button's edge
const FINGER_RETREATED_Y = 30; // slides back down below the anchor after a tap

function RisingFinger({ phase }: { phase: FingerPhase }): React.ReactElement {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(FINGER_HIDDEN_Y);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (phase === 'rising') {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withTiming(FINGER_TOUCH_Y, {
        duration: FINGER_RISE_MS,
        easing: Easing.out(Easing.quad),
      });
    } else if (phase === 'tap') {
      scale.value = withSequence(
        withTiming(0.8, { duration: 100, easing: Easing.in(Easing.quad) }),
        withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
      );
    } else if (phase === 'retreating') {
      translateY.value = withTiming(FINGER_RETREATED_Y, { duration: RETREAT_MS, easing: Easing.in(Easing.quad) });
      opacity.value = withTiming(0, { duration: RETREAT_MS });
    } else {
      opacity.value = 0;
      translateY.value = FINGER_HIDDEN_Y;
      scale.value = 1;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          bottom: FINGER_ANCHOR_BELOW,
          alignSelf: 'center',
          zIndex: 30,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.5,
          shadowRadius: 8,
          elevation: 30,
        },
        style,
      ]}
    >
      <Image source={FINGER} style={{ width: 32, height: 32 }} />
    </Animated.View>
  );
}

// ── Highest-bid plaque — scaled mirror of HighBidPlaque ─────────────────────
//
// Always renders the same two rows (numbers, then bidder) whether or not a
// bid exists yet — dashes/blank instead of conditionally omitting them — so
// the plaque never changes height and nothing on screen jumps the instant
// the first bid lands.

function MiniBidPlaque({
  step,
  flash,
}: {
  step: BidStep | null;
  flash: boolean;
}): React.ReactElement {
  const bump = useSharedValue(1);
  useEffect(() => {
    if (!flash) return;
    bump.value = withSequence(
      withTiming(1.06, { duration: 110, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 150 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));

  const meta = step ? BIDDER_META[step.bidder] : null;

  return (
    <Animated.View
      style={[
        {
          alignItems: 'center',
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: FELT_SHADOW,
          borderWidth: 2,
          borderColor: step ? BRASS : 'rgba(212,169,74,0.3)',
          gap: 6,
        },
        bumpStyle,
      ]}
    >
      <Text style={{ ...typography.label, color: step ? BRASS : colors.fog, fontSize: 8, letterSpacing: 1.2 }}>
        {step ? 'HIGHEST BID' : 'NO BIDS YET'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <GlassWater size={13} color={colors.stop} strokeWidth={2.5} />
          <Text style={{ color: colors.chalk, fontSize: 17, fontWeight: '900', width: 26, textAlign: 'center' }}>
            {step ? step.chasers : '–'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Coins size={13} color={BRASS_GLOW} strokeWidth={2.5} />
          <Text style={{ color: BRASS_GLOW, fontSize: 17, fontWeight: '900', width: 34, textAlign: 'center' }}>
            {step ? step.points : '–'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: step ? 1 : 0 }}>
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: meta?.ring ?? colors.rim,
            backgroundColor: meta?.ring ?? colors.rim,
          }}
        />
        <Text style={{ color: colors.chalk, fontSize: 10, fontWeight: '800' }}>{meta?.name ?? ' '}</Text>
      </View>
    </Animated.View>
  );
}

// ── Quick-bid chip — scaled mirror of ChipButton ────────────────────────────

function MiniChip({
  icon: Icon,
  delta,
  active,
  fingerPhase,
}: {
  icon: typeof GlassWater;
  delta: string;
  active: boolean;
  fingerPhase: FingerPhase;
}): React.ReactElement {
  return (
    <View style={{ position: 'relative' }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: BRASS,
          borderWidth: 3,
          borderColor: FELT_SHADOW,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon size={11} color={FELT_SHADOW} strokeWidth={2.5} />
        <Text style={{ color: FELT_SHADOW, fontSize: 12, fontWeight: '900' }}>{delta}</Text>
      </View>
      <RisingFinger phase={active ? fingerPhase : 'idle'} />
    </View>
  );
}

// ── Custom-bid panel — scaled mirror of the two steppers (chasers, points)
// + PLACE BID button. Shown for source fidelity — the real screen always
// has this panel on-screen underneath the chips — but never tapped in this
// script — both of "your" raises here use the chips (see the module
// docstring), which already carry their own fixed +1/+10 labels; a generic
// per-tap +1 stepper doesn't map onto that as cleanly. It just passively
// tracks the current floor, exactly like the real panel's own
// never-fall-below-the-current-bid behavior. ────────────────────────────────

function MiniStepper({
  icon: Icon,
  value,
  tint,
}: {
  icon: typeof GlassWater;
  value: number;
  tint: string;
}): React.ReactElement {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon size={10} color={tint} strokeWidth={2.5} />
      <Minus size={8} color={tint} strokeWidth={3} />
      <Text style={{ color: colors.chalk, fontSize: 12, fontWeight: '900', minWidth: 14, textAlign: 'center' }}>
        {value}
      </Text>
      <Plus size={8} color={tint} strokeWidth={3} />
    </View>
  );
}

function MiniCustomPanel({ chasers, points }: { chasers: number; points: number }): React.ReactElement {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: FELT_SHADOW,
        borderWidth: 1.5,
        borderColor: 'rgba(212,169,74,0.3)',
      }}
    >
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <MiniStepper icon={GlassWater} value={chasers} tint={colors.stop} />
        <MiniStepper icon={Coins} value={points} tint={BRASS_GLOW} />
      </View>
      <View
        style={{
          paddingVertical: 5,
          paddingHorizontal: 14,
          borderRadius: 9,
          backgroundColor: BRASS,
          borderWidth: 1.2,
          borderColor: BRASS_GLOW,
        }}
      >
        <Text style={{ color: FELT_SHADOW, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }}>
          PLACE BID
        </Text>
      </View>
    </View>
  );
}

// ── Phone frame ───────────────────────────────────────────────────────────

function MiniPhone({
  timerProgress,
  children,
}: {
  timerProgress: ReturnType<typeof useSharedValue<number>>;
  children: React.ReactNode;
}): React.ReactElement {
  const barStyle = useAnimatedStyle(() => ({
    width: `${timerProgress.value * 100}%` as `${number}%`,
  }));

  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 26,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 36,
          height: 3,
          backgroundColor: colors.rim,
          borderRadius: 2,
          marginTop: 10,
          marginBottom: 8,
        }}
      />
      <View style={{ flex: 1, width: '100%', backgroundColor: FELT_DEEP, alignItems: 'center', paddingTop: 8, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Gavel size={11} color={BRASS} strokeWidth={2.5} />
          <Text style={{ ...typography.label, color: BRASS, fontSize: 9 }}>AUCTION</Text>
        </View>

        <View
          style={{
            width: '100%',
            height: 4,
            marginTop: 8,
            borderWidth: 1,
            borderColor: 'rgba(212,169,74,0.3)',
            backgroundColor: FELT_SHADOW,
          }}
        >
          <Animated.View style={[{ height: '100%', backgroundColor: BRASS_GLOW }, barStyle]} />
        </View>

        <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'space-evenly' }}>
          {children}
        </View>
      </View>
      <View
        style={{
          width: 48,
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

// ── Screen ──────────────────────────────────────────────────────────────────

export function AuctionTutorial(): React.ReactElement {
  const [plaqueIndex, setPlaqueIndex] = useState(-1); // -1 == "no bids yet"
  const [flashTick, setFlashTick] = useState(0);
  // Which STEPS index is currently being acted on (not yet landed in the
  // plaque) — lets the custom panel preview the target value being dialed
  // in before the tap actually submits it, instead of still showing the
  // previous bid until the very last instant.
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [fingerPhase, setFingerPhase] = useState<FingerPhase>('idle');
  const timerProgress = useSharedValue(1);

  // Ref so the scheduling loop below (built once on mount) always reaches
  // the shared value without re-running the whole effect.
  const timerRef = useRef(timerProgress);
  timerRef.current = timerProgress;

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let t = INITIAL_PAUSE_MS;

    timers.push(
      setTimeout(() => {
        timerRef.current.value = withTiming(0.3, { duration: TIMER_DRAIN_MS, easing: Easing.linear });
      }, 0),
    );

    STEPS.forEach((step, i) => {
      const isLastStep = i === STEPS.length - 1;
      // The last bid's window is the one nobody beats — instead of resetting
      // again, let it drain all the way to empty, right through to the end
      // of the story. Snapping back to full there would read as "another
      // raise is coming," which isn't true — the auction is actually over.
      const drainTarget = isLastStep ? 0 : 0.3;
      const drainDuration = isLastStep ? FINAL_HOLD_MS : TIMER_DRAIN_MS;

      if (step.action) {
        timers.push(setTimeout(() => setActiveStepIndex(i), t));
        timers.push(setTimeout(() => setFingerPhase('rising'), t));
        t += FINGER_RISE_MS;
        // The tap landing, the bid updating, and the timer resetting all
        // happen at this exact same instant — no lag between "the finger
        // touches the button" and "the bid changes on screen."
        timers.push(
          setTimeout(() => {
            setFingerPhase('tap');
            setPlaqueIndex(i);
            setFlashTick((n) => n + 1);
            timerRef.current.value = 1;
            timerRef.current.value = withTiming(drainTarget, { duration: drainDuration, easing: Easing.linear });
          }, t),
        );
        t += TAP_HOLD_MS;
        timers.push(setTimeout(() => setFingerPhase('retreating'), t));
        t += RETREAT_MS;
        timers.push(
          setTimeout(() => {
            setFingerPhase('idle');
            setActiveStepIndex(null);
          }, t),
        );
        t += GAP_MS;
      } else {
        t += GAP_MS;
        timers.push(
          setTimeout(() => {
            setPlaqueIndex(i);
            setFlashTick((n) => n + 1);
            timerRef.current.value = 1;
            timerRef.current.value = withTiming(drainTarget, { duration: drainDuration, easing: Easing.linear });
          }, t),
        );
        t += AUTO_HOLD_MS;
      }
    });

    t += FINAL_HOLD_MS;

    return () => timers.forEach(clearTimeout);
  }, []);

  const currentStep = plaqueIndex >= 0 ? STEPS[plaqueIndex] : null;
  const activeAction = activeStepIndex !== null ? STEPS[activeStepIndex].action : null;

  return (
    <View className="items-center">
      <MiniPhone timerProgress={timerProgress}>
        <MiniBidPlaque step={currentStep} flash={flashTick > 0} />

        <View style={{ flexDirection: 'row', gap: 14 }}>
          <MiniChip
            icon={GlassWater}
            delta="+1"
            active={activeAction === 'chip_chaser'}
            fingerPhase={fingerPhase}
          />
          <MiniChip
            icon={Coins}
            delta="+10"
            active={activeAction === 'chip_points'}
            fingerPhase={fingerPhase}
          />
        </View>

        <MiniCustomPanel chasers={currentStep?.chasers ?? 1} points={currentStep?.points ?? 0} />
      </MiniPhone>
    </View>
  );
}
