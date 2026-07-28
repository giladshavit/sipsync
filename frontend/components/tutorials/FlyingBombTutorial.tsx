import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Bomb, Flame, GlassWater } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { CountdownRing } from '../games/CountdownRing';
import {
  MIN_SPEED,
  WALL_BOUNCE_DAMPING,
  bombExitSide,
  stepBombPhysics,
  type BombPhysicsConfig,
  type ExitSide,
} from '../games/flyingBombPhysics';

// Three phones, not one — this game's whole point is the ring topology (a
// throw always lands on a *specific* neighbor, and your two directions go
// to two *different* people), which a single-screen mockup can't show. The
// scripted story: Player 1 throws right to Player 2, Player 2 throws left
// back to Player 1, Player 1 throws left (not right this time) to Player 3
// — proving left/right are fixed, distinct routes, not "throw and it comes
// back." A real 10-second countdown runs the whole time (compressed from
// the live game's 30s so the lesson lands fast); once it hits zero,
// whoever's holding the bomb gets the same red "BOOM!" reveal the live
// game shows, everyone else gets the green "safe" one — the actual stakes
// of the mechanic, not just the routing.
//
// Physics are the real stepBombPhysics/bombExitSide (see
// games/flyingBombPhysics.ts) on every leg — the coast-in on arrival, the
// coast-out after release, any wall bounce along the way — never a
// hand-approximated curve. The one deliberately scaled constant is
// friction: these phones are ~1/4 the width of a real device, and friction
// is an *absolute* px/s², so reusing the live game's real-device constant
// here would stop the bomb dead within a few pixels. Scaling it down is
// ordinary dynamic-similarity (the same law, sized for a smaller model),
// not a different rule — see MOCKUP_FRICTION_PX_PER_S2 below.
//
// Two continuity rules the choreography enforces, not just approximates:
// 1. The drag and the release are the SAME vector. Each throw script gives
//    a *direction* (dirX/dirY) and separately a drag distance and a release
//    speed — the drag animates to `start + direction * dragDistance` and
//    the release velocity is `direction * releaseSpeed`, both built from
//    the identical unit vector. There's no way for the hand to visibly pull
//    one way and the bomb to fly off at a different angle, because the
//    angle is computed once and reused, never authored twice.
// 2. A bomb's vertical position is never reset between phones. The exact
//    (x-independent) Y it exits one screen at — post-friction, post any
//    wall bounce, whatever it actually was at the crossing instant — is
//    reported up through onExited and becomes the next phone's entry Y.
//    Nothing here is allowed to invent a fresh "look, it arrived a bit
//    higher up" constant; that number only ever comes from the physics.

const PHONE_W = 104;
const PHONE_H = 200;
const GAP = 6;
const PLAY_AREA_W = PHONE_W;
const PLAY_AREA_H = 80;

const M_BOMB_SIZE = 30; // scaled down from the real BOMB_SIZE (76)
const RING_SIZE = 34;
const HAND_SIZE = 26;
// tap-gesture.png's fingertip sits near the image's top, not its center —
// same correction StrongPointTutorial uses, scaled to this smaller hand.
const HAND_TIP_OFFSET_X = 3;
const HAND_TIP_OFFSET_Y = 14;

const ACCENT = '#B91C1C'; // mirrors FlyingBombGameUI's ACCENT
const ACCENT_GLOW = '#F87171'; // mirrors FlyingBombGameUI's ACCENT_GLOW
const BG = '#170D0B'; // mirrors FlyingBombGameUI's BG

// A real countdown, not decorative — compressed from the live game's 30s
// so the "you'd better get rid of it" lesson lands inside one short clip.
// Tightened to 7s (from an original 10s) so the buzzer lands right as the
// last hop's catcher receives the bomb — a climax, not dead air after the
// routing story has already finished.
const TUTORIAL_ROUND_MS = 7_000;
// Scaled proportionally from the live game's 5s-of-30s (1/6) danger window,
// rather than reusing the same 5s, which would spend half of this much
// shorter demo in the red.
const LOW_TIME_THRESHOLD_MS = 3_000;

// See the file-level note above: friction is scaled down from the live
// game's FRICTION_PX_PER_S2 (2600) by roughly this mockup's width-vs-a-real-
// device ratio, so a throw still visibly travels and decelerates across
// this much smaller canvas instead of instantly crossing it or stopping
// dead a few pixels from the hand.
const MOCKUP_FRICTION_PX_PER_S2 = 550;
// Config passed to every stepBombPhysics call here — same wall-bounce and
// rest-threshold behavior as the live game, only friction is rescaled (see
// the note above). Built once at module scope, not inline per call, so the
// object identity is stable and there's nothing to recompute per frame.
const MOCKUP_PHYSICS_CONFIG: BombPhysicsConfig = {
  frictionPxPerS2: MOCKUP_FRICTION_PX_PER_S2,
  wallBounceDamping: WALL_BOUNCE_DAMPING,
  minSpeed: MIN_SPEED,
};

// Mirrors the backend's real handoff attenuation (see flying_bomb.py's
// _VELOCITY_ATTENUATION) — a throw arrives lighter than it left, here too.
const HANDOFF_ATTENUATION = 2;

const PRE_HAND_DELAY_MS = 500; // let the bomb settle in and register before the hand reaches for it
const HAND_RISE_MS = 240;
const HAND_HOVER_MS = 140; // hand sits arrived-and-still for a beat before dragging, same beat ReflexTutorial/StrongPointTutorial use
const DRAG_MS = 220; // short and decisive — a firm flick, not a long careful drag
const HAND_DESCEND_MS = 260;

// One throw's whole story is this one vector, used twice: scaled small for
// the visible drag, scaled large for the release. dirX/dirY need not be
// pre-normalized — normalized once at the point of use — so these can just
// be authored as "mostly rightward and a bit up" ratios.
interface ThrowScript {
  exitSide: ExitSide;
  dirX: number;
  dirY: number;
  dragDistance: number; // px the hand visibly pulls the bomb before releasing
  releaseSpeed: number; // px/s imparted at release, same direction as the drag
}

function unit(dirX: number, dirY: number): { ux: number; uy: number } {
  const len = Math.hypot(dirX, dirY) || 1;
  return { ux: dirX / len, uy: dirY / len };
}

// Drag distance is deliberately long (not a short "cock back and commit"
// flick anymore) — the hand should visibly cross a real chunk of the
// screen before releasing, reading as a frantic swipe rather than a tap.
const DRAG_DISTANCE = 40;

const THROW_0: ThrowScript = {
  // Player 1 → Player 2: mostly right, a bit up
  exitSide: 'right',
  dirX: 1,
  dirY: -0.35,
  dragDistance: DRAG_DISTANCE,
  releaseSpeed: 520,
};
const THROW_1: ThrowScript = {
  // Player 2 → Player 1: mostly left, a bit down
  exitSide: 'left',
  dirX: -1,
  dirY: 0.4,
  dragDistance: DRAG_DISTANCE,
  releaseSpeed: 500,
};
const THROW_2: ThrowScript = {
  // Player 1 → Player 3 — left this time, a different neighbor than THROW_0's right
  exitSide: 'left',
  dirX: -1,
  dirY: -0.35,
  dragDistance: DRAG_DISTANCE,
  releaseSpeed: 540,
};
const THROW_3: ThrowScript = {
  // Player 3 → Player 2 — the bomb comes back around, closing the loop
  exitSide: 'left',
  dirX: -1,
  dirY: -0.25,
  dragDistance: DRAG_DISTANCE,
  releaseSpeed: 510,
};

// The fixed part of the story: which phone holds the bomb at each hop, and
// what it does with it. What's NOT fixed — entry side, entry velocity,
// entry Y — is derived at runtime from the previous hop's actual exit (see
// buildHop below), never hand-authored.
interface HopPlan {
  phoneIndex: 0 | 1 | 2;
  throwsNext: ThrowScript | null;
}

const PLAN: HopPlan[] = [
  { phoneIndex: 0, throwsNext: THROW_0 },
  { phoneIndex: 1, throwsNext: THROW_1 },
  { phoneIndex: 0, throwsNext: THROW_2 },
  { phoneIndex: 2, throwsNext: THROW_3 },
  { phoneIndex: 1, throwsNext: null }, // story ends here — Player 2 holds it until time's up
];

interface HopRuntime {
  phoneIndex: 0 | 1 | 2;
  entrySide: ExitSide | null;
  entryVx: number;
  entryVy: number;
  entryYFrac: number;
  throwsNext: ThrowScript | null;
}

interface ExitReport {
  yFrac: number;
  vx: number;
  vy: number;
}

// Builds the runtime hop from the fixed plan plus whatever the *previous*
// hop's physics actually produced at the moment it exited — this is the
// only place entrySide/entryVx/entryVy/entryYFrac come from. Hop 0 has no
// predecessor, so it's the one hard-coded starting condition: centered, at
// rest, exactly like a bomb nobody has thrown yet in the live game.
function buildHop(index: number, lastExit: ExitReport | null): HopRuntime {
  const plan = PLAN[index];
  const previousThrow = index > 0 ? PLAN[index - 1].throwsNext : null;

  if (!previousThrow || !lastExit) {
    return {
      phoneIndex: plan.phoneIndex,
      entrySide: null,
      entryVx: 0,
      entryVy: 0,
      entryYFrac: 0.5,
      throwsNext: plan.throwsNext,
    };
  }

  return {
    phoneIndex: plan.phoneIndex,
    entrySide: previousThrow.exitSide === 'right' ? 'left' : 'right',
    entryVx: lastExit.vx / HANDOFF_ATTENUATION,
    entryVy: lastExit.vy / HANDOFF_ATTENUATION,
    entryYFrac: lastExit.yFrac,
    throwsNext: plan.throwsNext,
  };
}

const PHONE_LABELS = ['PLAYER 1', 'PLAYER 2', 'PLAYER 3'];

// ── Scripted bomb + hand for whichever phone currently holds it ────────────
// Remounted (fresh `key`, see the parent) every time the bomb changes hands,
// same reasoning as FlyingBombGameUI's per-throw remount: a clean spawn
// beats fighting a shared-value instance that already settled elsewhere.

function MockupBomb({
  hop,
  onExited,
}: {
  hop: HopRuntime;
  onExited?: (report: ExitReport) => void;
}): React.ReactElement {
  const minY = M_BOMB_SIZE / 2;
  const maxY = PLAY_AREA_H - M_BOMB_SIZE / 2;
  const initialX =
    hop.entrySide === 'left'
      ? -M_BOMB_SIZE / 2
      : hop.entrySide === 'right'
        ? PLAY_AREA_W + M_BOMB_SIZE / 2
        : PLAY_AREA_W / 2;
  const initialY = Math.min(maxY, Math.max(minY, hop.entryYFrac * PLAY_AREA_H));

  const x = useSharedValue(initialX);
  const y = useSharedValue(initialY);
  const vx = useSharedValue(hop.entryVx);
  const vy = useSharedValue(hop.entryVy);
  const dragging = useSharedValue(false);
  const hasExited = useSharedValue(false);

  // Hand: tracks the bomb's live (x, y) while "attached" (rising, hovering,
  // dragging); once released it freezes at the release point and retreats
  // on its own, independent of the bomb's onward flight.
  const handOpacity = useSharedValue(0);
  const handAttached = useSharedValue(true);
  const handFrozenX = useSharedValue(0);
  const handFrozenY = useSharedValue(0);
  const handDescend = useSharedValue(0);

  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  function handleExitedJS(yFrac: number, exitVx: number, exitVy: number) {
    onExitedRef.current?.({ yFrac, vx: exitVx, vy: exitVy });
  }

  // Same physics loop as the live game, driven by a script instead of a
  // finger — see flyingBombPhysics.ts's stepBombPhysics for the model.
  // frictionPxPerS2 is the one deliberately-scaled input — see the
  // file-level note on MOCKUP_FRICTION_PX_PER_S2.
  useFrameCallback((frame) => {
    'worklet';
    if (dragging.value || hasExited.value) return;
    const dt = typeof frame.timeSincePreviousFrame === 'number' ? frame.timeSincePreviousFrame : 16.7;

    const next = stepBombPhysics(
      { x: x.value, y: y.value, vx: vx.value, vy: vy.value },
      dt,
      { minY, maxY },
      MOCKUP_PHYSICS_CONFIG,
    );
    x.value = next.x;
    y.value = next.y;
    vx.value = next.vx;
    vy.value = next.vy;

    if (!hop.throwsNext) return; // final hop — settle and stay put

    const exitSide = bombExitSide(x.value, PLAY_AREA_W, M_BOMB_SIZE);
    if (exitSide) {
      hasExited.value = true;
      // Report the actual crossing state — not the script's original
      // numbers — so the next phone picks up exactly where this one left
      // off, friction and any wall bounce along the way included.
      runOnJS(handleExitedJS)(y.value / PLAY_AREA_H, vx.value, vy.value);
    }
  });

  useEffect(() => {
    const t = hop.throwsNext;
    if (!t) return; // final hop — no hand, no throw
    const { ux, uy } = unit(t.dirX, t.dirY);
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(
      setTimeout(() => {
        handOpacity.value = withTiming(1, { duration: HAND_RISE_MS });
      }, PRE_HAND_DELAY_MS),
    );

    timers.push(
      setTimeout(
        () => {
          dragging.value = true;
          // Drag *from wherever the bomb actually is* (its real entry point,
          // not a re-guessed constant) along the throw's own direction —
          // this is the same vector the release below uses, just scaled to
          // a short visible pull instead of a real launch speed.
          const dragToX = x.value + ux * t.dragDistance;
          const dragToY = Math.min(maxY, Math.max(minY, y.value + uy * t.dragDistance));
          x.value = withTiming(dragToX, { duration: DRAG_MS, easing: Easing.out(Easing.cubic) });
          y.value = withTiming(dragToY, { duration: DRAG_MS, easing: Easing.out(Easing.cubic) });
        },
        PRE_HAND_DELAY_MS + HAND_RISE_MS + HAND_HOVER_MS,
      ),
    );

    timers.push(
      setTimeout(
        () => {
          dragging.value = false;
          // The strong-throw release — same unit vector the drag just
          // followed, scaled up to a real launch speed, so the bomb
          // continues on the exact line the hand was pulling it along
          // rather than snapping to an unrelated angle.
          vx.value = ux * t.releaseSpeed;
          vy.value = uy * t.releaseSpeed;
          // The hand lets go — freeze its position, then have it drop away
          // and fade while the bomb flies on under its own physics.
          handFrozenX.value = x.value;
          handFrozenY.value = y.value;
          handAttached.value = false;
          handOpacity.value = withTiming(0, { duration: HAND_DESCEND_MS });
          handDescend.value = withTiming(22, {
            duration: HAND_DESCEND_MS,
            easing: Easing.in(Easing.quad),
          });
        },
        PRE_HAND_DELAY_MS + HAND_RISE_MS + HAND_HOVER_MS + DRAG_MS,
      ),
    );

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bombStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value - M_BOMB_SIZE / 2 },
      { translateY: y.value - M_BOMB_SIZE / 2 },
    ],
  }));
  const handStyle = useAnimatedStyle(() => {
    const baseX = handAttached.value ? x.value : handFrozenX.value;
    const baseY = (handAttached.value ? y.value : handFrozenY.value) + handDescend.value;
    return {
      opacity: handOpacity.value,
      transform: [
        { translateX: baseX - HAND_SIZE / 2 + HAND_TIP_OFFSET_X },
        { translateY: baseY - HAND_SIZE / 2 + HAND_TIP_OFFSET_Y },
      ],
    };
  });

  // Fuse flicker — matches FlyingBombGameUI's bomb sprite exactly
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
    <>
      <Animated.View
        style={[{ position: 'absolute', width: M_BOMB_SIZE, height: M_BOMB_SIZE }, bombStyle]}
      >
        <View
          style={{
            width: M_BOMB_SIZE,
            height: M_BOMB_SIZE,
            borderRadius: M_BOMB_SIZE / 2,
            backgroundColor: '#1C1917',
            borderWidth: 2,
            borderColor: '#3F3F46',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bomb size={M_BOMB_SIZE * 0.5} color={colors.chalk} strokeWidth={2} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: -8, left: M_BOMB_SIZE / 2 - 6 }, flameStyle]}
        >
          <Flame size={12} color="#FB923C" fill="#F59E0B" strokeWidth={1.5} />
        </Animated.View>
      </Animated.View>

      {hop.throwsNext && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', width: HAND_SIZE, height: HAND_SIZE }, handStyle]}
        >
          <Image
            source={require('@/assets/images/tap-gesture.png')}
            style={{ width: HAND_SIZE, height: HAND_SIZE }}
          />
        </Animated.View>
      )}
    </>
  );
}

// ── One phone frame — chrome mirrors FlyingBombGameUI exactly (ring +
// status chip + the same done-reveal, red for the loser / green for safe)

function MiniPhone({
  label,
  holding,
  roundOver,
  deadlineAt,
  children,
}: {
  label: string;
  holding: boolean;
  roundOver: boolean;
  deadlineAt: number;
  children: React.ReactNode;
}): React.ReactElement {
  const caught = roundOver && holding;

  return (
    <View
      style={{
        width: PHONE_W,
        height: PHONE_H,
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 2,
        borderColor: colors.rim,
        overflow: 'hidden',
      }}
    >
      <View style={{ flex: 1, alignItems: 'center' }}>
        <View
          style={{
            width: 26,
            height: 3,
            backgroundColor: colors.rim,
            borderRadius: 2,
            marginTop: 8,
            marginBottom: 5,
          }}
        />
        <View style={{ flex: 1, width: '100%', backgroundColor: BG, alignItems: 'center' }}>
          <Text
            style={{
              ...typography.label,
              color: colors.fog,
              fontSize: 7,
              letterSpacing: 1,
              fontWeight: '800',
            }}
          >
            {label}
          </Text>

          <View style={{ marginTop: 4 }}>
            <CountdownRing
              deadlineAt={deadlineAt}
              clockOffset={0}
              totalMs={TUTORIAL_ROUND_MS}
              active={!roundOver}
              size={RING_SIZE}
              strokeWidth={4}
              precision="seconds"
              lowTimeThresholdMs={LOW_TIME_THRESHOLD_MS}
              highTimeColor={ACCENT_GLOW}
              lowTimeColor={colors.stop}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderRadius: 10,
              backgroundColor: holding ? ACCENT : colors.surface,
              borderWidth: 1.5,
              borderColor: holding ? ACCENT_GLOW : colors.rim,
            }}
          >
            <Bomb size={9} color={colors.chalk} strokeWidth={2.5} />
            <Text
              style={{
                ...typography.label,
                color: colors.chalk,
                fontSize: 7,
                fontWeight: '800',
              }}
            >
              {holding ? 'HOLDING' : 'CLEAR'}
            </Text>
          </View>

          <View style={{ width: PLAY_AREA_W, height: PLAY_AREA_H, marginTop: 6 }}>
            {children}
          </View>
        </View>
        <View
          style={{
            width: 30,
            height: 3,
            backgroundColor: colors.fog,
            borderRadius: 2,
            marginVertical: 8,
            opacity: 0.35,
          }}
        />
      </View>

      {/* Done reveal — mirrors FlyingBombGameUI's exactly: red BOOM!/chaser
          for whoever's holding it when time runs out, green safe for
          everyone else. */}
      {roundOver && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(10,10,15,0.82)',
          }}
        >
          <View
            style={{
              alignItems: 'center',
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: 'rgba(255,255,255,0.3)',
              backgroundColor: caught ? colors.stop : colors.go,
            }}
          >
            <Text style={{ color: colors.chalk, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
              {caught ? 'BOOM!' : 'CLEAR'}
            </Text>
            {caught && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                <GlassWater size={9} color={colors.chalk} strokeWidth={2.5} />
                <Text style={{ color: colors.chalk, fontSize: 8, fontWeight: '900' }}>1 CHASER</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function FlyingBombTutorial(): React.ReactElement {
  const [hopIndex, setHopIndex] = useState(0);
  const [lastExit, setLastExit] = useState<ExitReport | null>(null);
  const [roundOver, setRoundOver] = useState(false);
  // Computed once — a real, shared deadline so all three rings tick down in
  // sync exactly like a real room, ending the story with the actual stakes
  // instead of freezing mid-routing.
  const [deadlineAt] = useState(() => Date.now() + TUTORIAL_ROUND_MS);

  const hop = buildHop(hopIndex, lastExit);

  useEffect(() => {
    const timer = setTimeout(() => setRoundOver(true), TUTORIAL_ROUND_MS);
    return () => clearTimeout(timer);
  }, []);

  function handleExited(report: ExitReport) {
    setLastExit(report);
    setHopIndex((i) => Math.min(i + 1, PLAN.length - 1));
  }

  return (
    <View className="items-center">
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {PHONE_LABELS.map((label, i) => (
          <MiniPhone
            key={label}
            label={label}
            holding={hop.phoneIndex === i}
            roundOver={roundOver}
            deadlineAt={deadlineAt}
          >
            {hop.phoneIndex === i && (
              <MockupBomb
                key={hopIndex}
                hop={hop}
                onExited={hop.throwsNext ? handleExited : undefined}
              />
            )}
          </MiniPhone>
        ))}
      </View>
    </View>
  );
}
