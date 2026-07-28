import { useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { GlassWater } from 'lucide-react-native';
import { colors } from '@/constants/design';
import type { DrinkingRule, RuleLine } from '@/constants/games';

// Shared between the two tutorial hosts — the standalone preview reached
// from a game's rules screen (app/games/[id]/tutorial.tsx) and the mandatory
// in-room pre-round screen (app/room/[code]/tutorial.tsx) — so the "how to
// play" chrome looks and behaves identically in both places.

// The tutorial chip's fallback (when a game hasn't been given a shortLabel
// yet) needs a plain one-line string, never colored segments — this just
// concatenates a RuleLine's text, dropping any color/bold styling.
function plainText(line: RuleLine): string {
  return typeof line === 'string' ? line : line.map((seg) => seg.text).join('');
}

function segmentColor(color: 'red' | 'green' | 'amber' | 'blue' | 'orange' | undefined): string {
  if (color === 'red') return colors.stop;
  if (color === 'green') return colors.go;
  if (color === 'amber') return colors.amber;
  if (color === 'blue') return colors.tapped;
  if (color === 'orange') return colors.orange;
  return colors.chalk;
}

// The cue line's own treatment — larger and looser-tracked than both the
// screen title and the rules screen's body copy, so it reads as a distinct
// "caption" rather than a restyled rules row. The block itself sits centered
// on screen (its parent centers it), but the text inside is left-aligned —
// a centered paragraph that wraps to 2 lines reads worse than a left-leading
// one. Segments keep the same red/green/amber word-coloring convention as
// the real rules.
export function CueText({ line }: { line: RuleLine }) {
  const baseStyle = { fontSize: 19, fontWeight: '800' as const, lineHeight: 25, textAlign: 'left' as const };
  if (typeof line === 'string') {
    return <Text style={[baseStyle, { color: colors.chalk }]}>{line}</Text>;
  }
  return (
    <Text style={baseStyle}>
      {line.map((seg, i) => (
        <Text key={i} style={{ color: segmentColor(seg.color) }}>
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

// Floor on the shared chip width — content-hugging alone reads cramped for
// a 1-word label like "SAFE" or "Pledged"; this keeps every chip at least
// this wide even when the widest sibling doesn't need it.
const MIN_CHIP_WIDTH = 96;

// One condensed chip per outcome — one or two words, never the full
// rules-screen sentence. Falls back to `description` only if a game hasn't
// been given a shortLabel yet. `width` is left unset on the first render so
// the chip reports its own natural content width via onLayout; DrinkRow
// then re-renders every chip at the widest one's width (floored at
// MIN_CHIP_WIDTH), so the row sizes to its content instead of stretching
// across the screen.
function DrinkChip({
  rule,
  width,
  onMeasured,
}: {
  rule: DrinkingRule;
  width?: number;
  onMeasured?: (width: number) => void;
}) {
  function handleLayout(e: LayoutChangeEvent) {
    onMeasured?.(e.nativeEvent.layout.width);
  }

  return (
    <View
      onLayout={onMeasured ? handleLayout : undefined}
      style={{
        width,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 2,
        borderColor: colors.rim,
        backgroundColor: colors.surface,
        paddingVertical: 12,
        paddingHorizontal: 12,
      }}
    >
      {rule.chasers === 0 ? (
        <Text style={{ color: colors.go, fontSize: 11, fontWeight: '800' }}>SAFE</Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {Array.from({ length: rule.chasers }).map((_, i) => (
            <GlassWater key={i} size={18} color={colors.stop} strokeWidth={2} />
          ))}
        </View>
      )}
      <Text
        style={{ color: colors.chalk, fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 15 }}
        numberOfLines={1}
      >
        {rule.shortLabel ?? plainText(rule.description)}
      </Text>
    </View>
  );
}

export function DrinkRow({ rules }: { rules: DrinkingRule[] }) {
  const [commonWidth, setCommonWidth] = useState<number | undefined>(undefined);
  const measured = useRef<number[]>([]);

  function handleMeasured(index: number, width: number) {
    measured.current[index] = width;
    if (measured.current.length === rules.length && measured.current.every((w) => w != null)) {
      setCommonWidth(Math.max(MIN_CHIP_WIDTH, ...measured.current));
    }
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
      {rules.map((rule, i) => (
        <DrinkChip
          key={i}
          rule={rule}
          width={commonWidth}
          onMeasured={commonWidth ? undefined : (w) => handleMeasured(i, w)}
        />
      ))}
    </View>
  );
}
