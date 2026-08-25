import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { CueText, DrinkRow } from './TutorialCue';
import type { DrinkingRule, RuleLine } from '@/constants/games';

// The three stacked pieces every tutorial screen shows — the cue line, the
// simulated phone, and the who-drinks chips — plus the arithmetic that keeps
// all three on screen at once.
//
// Shared by both hosts (app/room/[code]/tutorial.tsx and
// app/games/[id]/tutorial.tsx) so the fit rule can't drift between them.
//
// Why this exists: five tutorials (reflex/tap_race/roulette/human_timer/
// twenty_one) draw their phone mockup at a hard-coded height: 450, with the
// cue line above and the chip row below stacked on top of that. On a 375x667
// screen the stack ran ~171px taller than the box it had to live in, putting
// the chip labels 105px below the bottom of the window — and the in-round host
// auto-advances after a fixed 6-11s, so anything below the fold is content the
// player never sees (issue #131).
//
// Two levers, in this order:
//   1. Compress the whitespace. The gaps and padding here are ~100px of pure
//      air; spending that before shrinking anything readable is free.
//   2. Scale the stack down, floored at MIN_SCALE.
//
// Both are driven by *measured* heights of the three blocks, which don't
// depend on the spacing this component chooses — so the decision is a pure
// function of its inputs and can't oscillate between two layouts. Transforms
// don't participate in layout, so the scale never feeds back into the
// measurements either.

type Spacing = {
  padTop: number;
  /** Cue → mockup, and mockup → chip group. */
  gap: number;
  /** The chip row wants a little more air above it than the other gaps. */
  chipGap: number;
  padBottom: number;
};

const ROOMY: Spacing = { padTop: 16, gap: 22, chipGap: 14, padBottom: 28 };
// Same layout with the air squeezed out — still legible spacing, just tight.
// Worth ~60px, which is the whole deficit on most of the screens that missed.
const TIGHT: Spacing = { padTop: 8, gap: 12, chipGap: 6, padBottom: 16 };

// Floor on the shrink. Past this the chip labels and cue text stop being
// comfortably readable, so anything that still doesn't fit is handed back to
// the host's ScrollView to scroll — a worse outcome, but a rare one, and
// better than illegible.
const MIN_SCALE = 0.72;

/** Heights of the three stacked blocks, measured. Null until first layout. */
type Measured = { cue: number; body: number; chips: number };

function stackHeight(m: Measured, s: Spacing): number {
  const gaps = (m.cue > 0 ? s.gap : 0) + (m.chips > 0 ? s.gap + s.chipGap : 0);
  return m.cue + m.body + m.chips + gaps;
}

export function TutorialStage({
  cue,
  rules,
  availableHeight,
  children,
}: {
  cue?: RuleLine;
  rules?: DrinkingRule[];
  /** The host ScrollView's own measured height. Null until first layout. */
  availableHeight: number | null;
  children: ReactNode;
}) {
  // Tutorial stories animate, and some grow taller partway through (a banner
  // drops in, a result plaque appears). Keeping the tallest height each block
  // has ever reported means the layout is chosen for the story's worst moment
  // rather than clipping the instant it gets there.
  const [measured, setMeasured] = useState<Measured>({ cue: 0, body: 0, chips: 0 });

  function measure(key: keyof Measured) {
    return (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      setMeasured((prev) => (h > prev[key] + 0.5 ? { ...prev, [key]: h } : prev));
    };
  }

  const ready = availableHeight != null && measured.body > 0;
  const spacing =
    ready && stackHeight(measured, ROOMY) + ROOMY.padTop + ROOMY.padBottom > availableHeight
      ? TIGHT
      : ROOMY;

  const budget = availableHeight != null ? availableHeight - spacing.padTop - spacing.padBottom : null;
  const natural = stackHeight(measured, spacing);
  const scale =
    ready && budget != null && budget > 0 && natural > budget
      ? Math.max(MIN_SCALE, budget / natural)
      : 1;

  return (
    <View
      style={{
        paddingTop: spacing.padTop,
        paddingBottom: spacing.padBottom,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          alignItems: 'center',
          // Claim the scaled footprint so a shrunk stack doesn't leave a block
          // of dead space under itself — but only once there's a real
          // measurement and a real shrink.
          height: scale < 1 && natural > 0 ? natural * scale : undefined,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            gap: spacing.gap,
            transform: [{ scale }],
            transformOrigin: 'top center',
          }}
        >
          {cue && (
            <View onLayout={measure('cue')} style={{ maxWidth: 300 }}>
              <CueText line={cue} />
            </View>
          )}
          <View onLayout={measure('body')}>{children}</View>
          {/* Who drinks — condensed to one row of one-or-two-word chips,
              chaser-glass icon only, never a wine glass or other drink glyph.
              Extra top margin on top of the group's own gap: this one edge
              wants more breathing room than the cue-to-mockup gap does. */}
          {rules && (
            <View onLayout={measure('chips')} style={{ marginTop: spacing.chipGap }}>
              <DrinkRow rules={rules} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
