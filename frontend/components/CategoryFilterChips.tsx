import { View, Text, Pressable } from 'react-native';
import { colors } from '@/constants/design';
import { CATEGORY_LABELS, type GameCategory } from '@/constants/games';

export type CategoryFilter = GameCategory | 'all';

export const CATEGORY_FILTERS: CategoryFilter[] = ['all', 'reflex', 'luck', 'strategy'];

interface CategoryFilterChipsProps {
  value: CategoryFilter;
  onChange: (filter: CategoryFilter) => void;
  style?: object;
}

/** Fixed-width segmented row (4 known categories) — deliberately not a
 * scrollable, content-sized chip row: that let a short label ("Luck") end up
 * a different width than a selected long one ("Strategy"), which either
 * clipped or ballooned depending on which chip was active. */
export function CategoryFilterChips({ value, onChange, style }: CategoryFilterChipsProps) {
  return (
    <View style={[{ flexDirection: 'row', gap: 8 }, style]}>
      {CATEGORY_FILTERS.map((cat) => {
        const isActive = value === cat;
        const label = cat === 'all' ? 'All' : CATEGORY_LABELS[cat];
        return (
          <Pressable
            key={cat}
            onPress={() => onChange(cat)}
            style={{
              flex: 1,
              borderWidth: 2,
              borderColor: colors.ink,
              backgroundColor: isActive ? colors.ink : 'transparent',
              paddingVertical: 9,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            className="active:opacity-70"
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{
                color: isActive ? colors.cream : colors.ink,
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
