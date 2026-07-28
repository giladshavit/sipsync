// Shared bomb physics — the single source of truth for how a thrown bomb
// moves, used by both FlyingBombGameUI (real gesture-driven bombs) and
// FlyingBombTutorial (scripted bombs). Extracted specifically so the
// tutorial's mockup can't drift out of sync with the live game's actual
// physics by hand-approximating a similar-looking curve — it calls the
// exact same stepper.

export const BOMB_SIZE = 76;

// A thrown bomb has one velocity *vector* (vx, vy), not two independent
// numbers — friction acts on its speed (the vector's magnitude) and never
// touches its direction. Shrinking that speed by a fixed amount per frame
// and rescaling both components by the identical ratio is what keeps
// direction fixed: scaling a vector by a positive scalar can shrink it, but
// never rotates it. Hitting a wall is the one moment direction is *meant*
// to change — a discrete reflection of vy, handled separately, not part of
// friction.
//
// This is a *constant* (Coulomb/dry-friction) deceleration, not a
// *proportional* (viscous) one — the difference matters for "feel": under
// viscous drag (velocity *= k per unit time) stopping time is only
// logarithmic in the initial speed, so a gentle flick and a full-force
// throw settle in almost the same time regardless of effort, which reads as
// floaty/weightless. Under constant deceleration, stopping time (v0 / F)
// and stopping distance (v0² / 2F) both scale directly with how hard you
// threw it — a heavy object sliding against real friction.
export const FRICTION_PX_PER_S2 = 2_600;

// Below this speed (px/s) the bomb is at rest — guards the direction-
// preserving divide in stepBombPhysics from a division by ~0.
export const MIN_SPEED = 4;

// Energy kept per bounce off the top/bottom wall — a little rebound, then
// it settles, rather than bouncing forever or stopping dead.
export const WALL_BOUNCE_DAMPING = 0.55;

export interface BombPhysicsBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BombPhysicsBounds {
  minY: number;
  maxY: number;
}

export interface BombPhysicsConfig {
  /** A caller rendering at a different physical scale (e.g. the tutorial's
   * mockup phones, a small fraction of a real screen's width) must pass its
   * own scaled-down value here, not the real-device constant: friction is
   * an *absolute* px/s², so the same number covers a wildly different
   * fraction of a small canvas than a real screen in the same time. This is
   * ordinary dynamic-similarity scaling (same law, rescaled for a smaller
   * model), not a different physics rule — see stepBombPhysics's own note.
   * All fields are required (no optional/default values) — this function
   * runs inside a Reanimated worklet on the native UI thread, which has no
   * red-box/error-boundary safety net the way plain JS-thread code does;
   * an uncaught throw there can crash the whole app rather than just log an
   * error, so this file deliberately avoids `?.`/`??`/default-parameter
   * syntax and validates every number it touches instead of trusting it. */
  frictionPxPerS2: number;
  wallBounceDamping: number;
  minSpeed: number;
}

export const DEFAULT_PHYSICS_CONFIG: BombPhysicsConfig = {
  frictionPxPerS2: FRICTION_PX_PER_S2,
  wallBounceDamping: WALL_BOUNCE_DAMPING,
  minSpeed: MIN_SPEED,
};

function isFiniteNumber(n: number): boolean {
  'worklet';
  // Number.isFinite would be the idiomatic call, but worklets run on a
  // restricted native JS runtime — stick to a plain comparison rather than
  // trust a less commonly worklet-exercised built-in.
  return typeof n === 'number' && n === n && n !== Infinity && n !== -Infinity;
}

/**
 * One frame of dry-friction motion plus a top/bottom wall bounce. Pure and
 * side-effect-free — callers read the returned body back into whatever
 * shared values they're driving (gesture-live or scripted).
 */
export function stepBombPhysics(
  body: BombPhysicsBody,
  dtMs: number,
  bounds: BombPhysicsBounds,
  config: BombPhysicsConfig,
): BombPhysicsBody {
  'worklet';
  let x = body.x;
  let y = body.y;
  let vx = body.vx;
  let vy = body.vy;
  const minY = bounds.minY;
  const maxY = bounds.maxY;
  const friction = config.frictionPxPerS2;
  const bounceDamping = config.wallBounceDamping;
  const minSpeed = config.minSpeed;

  // Corrupted position/velocity (a NaN that slipped through from somewhere
  // upstream) must never reach a SharedValue feeding a native transform —
  // that's the actual crash class this guards against. This is a genuine
  // "the state is broken" case, so resetting to rest is the right call.
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(vx) || !isFiniteNumber(vy)) {
    return { x: isFiniteNumber(x) ? x : 0, y: isFiniteNumber(y) ? y : minY, vx: 0, vy: 0 };
  }

  // A degenerate frame tick — dt of zero or less, which legitimately
  // happens right after a gesture handoff resets the frame clock — has
  // nothing to integrate. This is NOT corruption: skip the frame and
  // preserve velocity exactly as-is, rather than wiping the fling the
  // player (or the tutorial's script) just gave it. Confusing this with
  // the corruption case above is what broke the throw entirely: the very
  // first frame after release would zero the velocity it was meant to
  // carry.
  if (!isFiniteNumber(dtMs) || dtMs <= 0) {
    return { x, y, vx, vy };
  }

  const speed = Math.hypot(vx, vy);
  if (speed < minSpeed) {
    return { x, y, vx: 0, vy: 0 };
  }

  const newSpeed = Math.max(0, speed - friction * (dtMs / 1000));
  const scale = newSpeed / speed; // preserves direction — see FRICTION_PX_PER_S2's note
  vx = vx * scale;
  vy = vy * scale;

  x = x + vx * (dtMs / 1000);
  y = y + vy * (dtMs / 1000);

  if (y < minY) {
    y = minY;
    vy = -vy * bounceDamping;
  } else if (y > maxY) {
    y = maxY;
    vy = -vy * bounceDamping;
  }

  return { x, y, vx, vy };
}

export type ExitSide = 'left' | 'right';

/** Which edge (if any) the bomb has fully crossed, given its current
 * center-x, the play area's width, and the sprite's own size — callers
 * rendering a scaled-down sprite (e.g. the tutorial's mockup) pass their
 * own bombSize so the crossing point lines up with what's actually drawn. */
export function bombExitSide(x: number, playWidth: number, bombSize: number): ExitSide | null {
  'worklet';
  if (!isFiniteNumber(x) || !isFiniteNumber(playWidth) || !isFiniteNumber(bombSize)) {
    return null;
  }
  if (x - bombSize / 2 > playWidth) return 'right';
  if (x + bombSize / 2 < 0) return 'left';
  return null;
}
