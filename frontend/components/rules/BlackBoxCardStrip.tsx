import React from 'react';
import { View, Text } from 'react-native';
import { GlassWater } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// A literal 2×3 spec-sheet TABLE — Drink / Distribute rows, 1/2/3 chaser
// columns — with real ruled grid lines separating the headers and every
// cell, like a printed reference chart. Every column width is FIXED (never
// flex): the table's parent sizes to content, and flex children inside a
// content-sized parent collapse to zero-basis widths in RN, which mangled
// the whole grid. Ink borders on parchment, matching the light rules-screen
// language rather than the game's dark vault palette.

const CARD_W = 58;
const CARD_H = 78;
const CELL_PAD = 6;
const DATA_COL_W = CARD_W + CELL_PAD * 2; // 70
const LABEL_COL_W = 92;
const HEADER_ROW_H = 34;
const DATA_ROW_H = CARD_H + CELL_PAD * 2; // 90
const GRID_LINE = 1.5;

// One outcome card — a SOLID red/green plate with white chaser icons,
// mirroring the live round's revealed card face exactly; both rows render
// identically, color alone carries Drink vs Distribute.
function MiniCard({ count, tint }: { count: number; tint: string }): React.ReactElement {
  return (
    <View
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 10,
        backgroundColor: tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 3, width: CARD_W - 12 }}>
        {Array.from({ length: count }, (_, i) => (
          <GlassWater key={i} size={13} color={colors.chalk} strokeWidth={2.5} />
        ))}
      </View>
    </View>
  );
}

// A single table cell with a fixed width and height — the ruled grid comes
// from each cell drawing its own top/left divider (skipped on the first
// row/column so the outer 2px frame stays clean).
function Cell({
  firstCol,
  firstRow,
  width,
  height,
  children,
}: {
  firstCol: boolean;
  firstRow: boolean;
  width: number;
  height: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View
      style={{
        width,
        height,
        borderLeftWidth: firstCol ? 0 : GRID_LINE,
        borderTopWidth: firstRow ? 0 : GRID_LINE,
        borderColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

export function BlackBoxCardStrip(): React.ReactElement {
  const rows: { label: string; tint: string }[] = [
    { label: 'Drink', tint: colors.stop },
    { label: 'Distribute', tint: colors.go },
  ];

  return (
    <View
      style={{
        alignSelf: 'center',
        borderWidth: 2,
        borderColor: colors.ink,
        backgroundColor: colors.parchment,
      }}
    >
      {/* Header row — corner label + the 1/2/3 chaser columns */}
      <View style={{ flexDirection: 'row' }}>
        <Cell firstCol firstRow width={LABEL_COL_W} height={HEADER_ROW_H}>
          <Text style={{ ...typography.label, color: colors.dune, fontSize: 9 }}>Chasers</Text>
        </Cell>
        {[1, 2, 3].map((n) => (
          <Cell key={n} firstCol={false} firstRow width={DATA_COL_W} height={HEADER_ROW_H}>
            <Text style={{ ...typography.label, color: colors.ink, fontSize: 12 }}>{n}</Text>
          </Cell>
        ))}
      </View>

      {/* Outcome rows */}
      {rows.map(({ label, tint }) => (
        <View key={label} style={{ flexDirection: 'row' }}>
          <Cell firstCol firstRow={false} width={LABEL_COL_W} height={DATA_ROW_H}>
            <Text
              numberOfLines={1}
              style={{ ...typography.label, color: tint, fontSize: 9, textAlign: 'center' }}
            >
              {label}
            </Text>
          </Cell>
          {[1, 2, 3].map((n) => (
            <Cell key={n} firstCol={false} firstRow={false} width={DATA_COL_W} height={DATA_ROW_H}>
              <MiniCard count={n} tint={tint} />
            </Cell>
          ))}
        </View>
      ))}
    </View>
  );
}
