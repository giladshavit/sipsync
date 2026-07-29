import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { GAME_CATALOG } from '@/constants/games';
import { CategoryFilterChips, type CategoryFilter } from '@/components/CategoryFilterChips';

const GRID_GAP = 10;
const H_PADDING = 20;
const COLUMNS = 3;

export default function AllGamesScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  const cellSize = (width - H_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

  const games = useMemo(
    () => (filter === 'all' ? GAME_CATALOG : GAME_CATALOG.filter((g) => g.categories.includes(filter))),
    [filter],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* Back to home */}
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        {/* Header — split-weight signature, matches home/lobby */}
        <View className="mb-6">
          <Text
            style={{
              color: colors.amber,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {GAME_CATALOG.length} mini-games
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            All
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            Games
          </Text>
        </View>

        {/* Category filter chips */}
        <CategoryFilterChips value={filter} onChange={setFilter} style={{ marginBottom: 20 }} />

        {/* Game grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}>
          {games.map((game) => (
            <Pressable
              key={game.id}
              onPress={() => router.push(`/games/${game.id}`)}
              style={{
                width: cellSize,
                borderWidth: 2,
                borderColor: colors.ink,
                backgroundColor: colors.parchment,
              }}
              className="active:opacity-75"
            >
              {/* Image placeholder — swaps for real artwork later */}
              <View
                style={{
                  width: '100%',
                  aspectRatio: 1,
                  backgroundColor: game.accentColor,
                  borderBottomWidth: 2,
                  borderBottomColor: colors.ink,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <game.Icon size={cellSize * 0.34} color={colors.parchment} strokeWidth={1.75} />
              </View>

              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 14,
                  minHeight: 60,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: colors.ink,
                    fontSize: 13,
                    fontWeight: '900',
                    letterSpacing: 0.3,
                    lineHeight: 16,
                    textAlign: 'center',
                    textTransform: 'uppercase',
                  }}
                >
                  {game.title}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
