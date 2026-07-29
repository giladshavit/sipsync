import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Check, ChevronRight } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { GAME_CATALOG } from '@/constants/games';
import { CategoryFilterChips, type CategoryFilter } from '@/components/CategoryFilterChips';

interface GamesSheetProps {
  /** edit: admin toggles the room's selection. view: read-only for guests —
   * shows only the already-selected games, tap opens that game's rules. */
  mode: 'edit' | 'view';
  selectedIds: string[];
  onToggle?: (id: string) => void;
  onClose: () => void;
  /** Current room size — used only to grey out a game's `minPlayers` floor
   * (e.g. auction wants a real crowd) in edit mode. Not enforced anywhere
   * server-side; an already-selected game stays toggleable off regardless. */
  playerCount?: number;
}

/**
 * Rendered inline over the lobby (not a separate route) so it shares the
 * lobby's own WebSocket connection instead of opening a new one — a second
 * HANDSHAKE from a routed screen briefly deregisters the lobby's connection
 * server-side, which every other player in the room sees as the admin
 * quietly leaving and rejoining.
 */
export function GamesSheet({ mode, selectedIds, onToggle, onClose, playerCount = 0 }: GamesSheetProps) {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  const pool = mode === 'edit'
    ? GAME_CATALOG
    : GAME_CATALOG.filter((g) => selectedIds.includes(g.id));
  const games = filter === 'all' ? pool : pool.filter((g) => g.categories.includes(filter));

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
        backgroundColor: colors.cream,
      }}
    >
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 16 }}>
        <Pressable
          onPress={onClose}
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

        <View className="mb-5">
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
            {mode === 'edit'
              ? `${selectedIds.length} of ${GAME_CATALOG.length} selected`
              : `${pool.length} game${pool.length === 1 ? '' : 's'} tonight`}
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            {mode === 'edit' ? 'Choose' : "Tonight's"}
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            {mode === 'edit' ? "tonight's games" : 'games'}
          </Text>
        </View>

        <CategoryFilterChips value={filter} onChange={setFilter} style={{ marginBottom: 16 }} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
          <View className="gap-2">
            {games.map((game) => {
              const isSelected = selectedIds.includes(game.id);
              // Below the floor, a game can still be deselected (in case the
              // room shrank after it was picked) — it just can't be newly
              // added until the room has enough players.
              const belowMinPlayers = !!game.minPlayers && playerCount < game.minPlayers;
              const locked = mode === 'edit' && !isSelected && belowMinPlayers;
              return (
                <Pressable
                  key={game.id}
                  onPress={() => {
                    if (locked) return;
                    mode === 'edit' ? onToggle?.(game.id) : router.push(`/games/${game.id}`);
                  }}
                  disabled={locked}
                  className="flex-row items-center border-2 border-[#0A0A0F] bg-white px-4 py-3 rounded-none active:opacity-70"
                  style={{ opacity: mode === 'edit' && (!isSelected || locked) ? 0.45 : 1 }}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: game.accentColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <game.Icon size={20} color={colors.parchment} strokeWidth={2} />
                  </View>
                  <View className="flex-1 ml-3">
                    <Text className="text-[#0A0A0F] text-sm font-bold tracking-wide uppercase">
                      {game.title}
                    </Text>
                    <Text className="text-[#A8977A] text-xs mt-0.5">
                      {locked ? `Needs ${game.minPlayers}+ players` : game.tagline}
                    </Text>
                  </View>
                  {mode === 'edit' ? (
                    <View
                      className="w-7 h-7 border-2 border-[#0A0A0F] items-center justify-center"
                      style={{ backgroundColor: isSelected ? colors.amber : '#FFFFFF' }}
                    >
                      {isSelected && <Check size={16} color={colors.ink} strokeWidth={3} />}
                    </View>
                  ) : (
                    <ChevronRight size={18} color={colors.dune} strokeWidth={2} />
                  )}
                </Pressable>
              );
            })}
            {games.length === 0 && (
              <Text style={{ color: colors.dune, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                No games in this category.
              </Text>
            )}
          </View>
        </ScrollView>

        {mode === 'edit' && (
          <Pressable
            onPress={onClose}
            style={{ marginBottom: insets.bottom > 0 ? insets.bottom : 16, marginTop: 4 }}
            className="bg-amber py-4 items-center rounded-none active:opacity-80"
          >
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
              Done
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
