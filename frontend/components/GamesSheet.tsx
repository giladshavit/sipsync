import { useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Check, ChevronRight, X } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { GAME_CATALOG, type GameMeta } from '@/constants/games';
import { CategoryFilterChips, type CategoryFilter } from '@/components/CategoryFilterChips';

interface GamesSheetProps {
  /** edit: admin toggles the room's selection. view: read-only for guests —
   * shows only the already-selected games, tap opens that game's rules. */
  mode: 'edit' | 'view';
  selectedIds: string[];
  /** Bulk replace — every selection change in edit mode (one card tap,
   * Select All, Deselect All) goes through this as the resulting full list,
   * so the room's selection updates as a single SET_GAMES message. Edit
   * mode only. */
  onSetSelected?: (ids: string[]) => void;
  onClose: () => void;
  /** Current room size — used only to grey out a game's `minPlayers` floor
   * (e.g. auction wants a real crowd) in edit mode. Not enforced anywhere
   * server-side; an already-selected game stays toggleable off regardless. */
  playerCount?: number;
}

// Identical constants/formula to the reference grid, frontend/app/games/index.tsx
// — H_PADDING here is this sheet's own established side padding (24, vs the
// catalog screen's 20), but the cellSize math itself is the same pattern.
const GRID_GAP = 10;
const H_PADDING = 24;
const COLUMNS = 3;

/**
 * Rendered inline over the lobby (not a separate route) so it shares the
 * lobby's own WebSocket connection instead of opening a new one — a second
 * HANDSHAKE from a routed screen briefly deregisters the lobby's connection
 * server-side, which every other player in the room sees as the admin
 * quietly leaving and rejoining.
 */
export function GamesSheet({ mode, selectedIds, onSetSelected, onClose, playerCount = 0 }: GamesSheetProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  // Edit mode owns its own local copy of the selection instead of reading
  // `selectedIds` directly. The server's normalize_game_ids rejects an empty
  // game_ids list outright (silently no-ops the SET_GAMES message — see
  // lobby.tsx's commitGameIds), so an admin clearing every game via Deselect
  // All has nothing to actually confirm server-side yet. Local state is what
  // lets the grid still show "0 selected" and disable Done in that moment,
  // instead of either snapping back to the last server-confirmed selection
  // or silently blocking the deselect. Seeded once at mount (this component
  // is remounted fresh each time the sheet opens — see lobby.tsx) and from
  // then on is the single source of truth for what's checked; every commit
  // (see `commitSelection`) still forwards non-empty results to the server
  // immediately, same as before.
  const [localIds, setLocalIds] = useState<string[]>(selectedIds);

  function commitSelection(next: string[]) {
    setLocalIds(next);
    onSetSelected?.(next); // lobby.tsx's commitGameIds itself no-ops when next is empty
  }

  // Floored, not just divided — three independently-rounded-UP cards can sum
  // to a hair more than the row's actual available width, which is exactly
  // what tips flexWrap into bumping the 3rd card to its own line (or here,
  // off the right edge). Flooring means 3 cards can only ever round DOWN
  // from here, never past the budget.
  const cellSize = Math.floor((width - H_PADDING * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS);

  // Same category filter, same tab row, for both modes — mirrors the main
  // Game Catalog screen exactly. Edit mode filters the full catalog (the
  // admin needs to see/toggle everything); view mode further restricts to
  // only the room's already-selected games.
  const editGames = filter === 'all' ? GAME_CATALOG : GAME_CATALOG.filter((g) => g.categories.includes(filter));
  const viewPool = GAME_CATALOG.filter((g) => selectedIds.includes(g.id));
  const viewGames = filter === 'all' ? viewPool : viewPool.filter((g) => g.categories.includes(filter));

  const allSelected = localIds.length === GAME_CATALOG.length;
  const noneSelected = localIds.length === 0;

  function handleMasterToggle() {
    commitSelection(allSelected ? [] : GAME_CATALOG.map((g) => g.id));
  }

  function handleCardPress(id: string) {
    const next = localIds.includes(id) ? localIds.filter((g) => g !== id) : [...localIds, id];
    commitSelection(next);
  }

  // Chunked into fixed rows of exactly COLUMNS, rather than a flexWrap flow —
  // same defensive pattern as the All Games catalog grid.
  const rows: GameMeta[][] = [];
  for (let i = 0; i < editGames.length; i += COLUMNS) {
    rows.push(editGames.slice(i, i + COLUMNS));
  }

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
        backgroundColor: colors.cream,
      }}
    >
      <View style={{ flex: 1, paddingHorizontal: H_PADDING, paddingTop: insets.top + 16 }}>
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
              ? `${localIds.length} of ${GAME_CATALOG.length} selected`
              : `${viewPool.length} game${viewPool.length === 1 ? '' : 's'} tonight`}
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            {mode === 'edit' ? 'Choose' : "Tonight's"}
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            {mode === 'edit' ? "tonight's games" : 'games'}
          </Text>
        </View>

        {mode === 'edit' && (
          <Pressable
            onPress={handleMasterToggle}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderWidth: 2,
              borderColor: colors.ink,
              backgroundColor: allSelected ? colors.ink : colors.amber,
              paddingVertical: 14,
              marginBottom: 14,
            }}
            className="active:opacity-80"
          >
            {allSelected ? (
              <X size={16} color={colors.cream} strokeWidth={3} />
            ) : (
              <Check size={16} color={colors.ink} strokeWidth={3} />
            )}
            <Text style={{ ...typography.label, fontSize: 13, color: allSelected ? colors.cream : colors.ink }}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </Text>
            <Text
              style={{
                ...typography.label,
                fontSize: 11,
                color: allSelected ? colors.cream : colors.ink,
                opacity: 0.55,
              }}
            >
              {localIds.length}/{GAME_CATALOG.length}
            </Text>
          </Pressable>
        )}

        {/* Category tab filter — identical component/config to the main Game
            Catalog screen. Filters which cards are DISPLAYED; tapping a card
            itself is what changes the room's selection. */}
        <CategoryFilterChips value={filter} onChange={setFilter} style={{ marginBottom: 16 }} />

        {mode === 'edit' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 4, paddingBottom: 16 }}>
            <View style={{ gap: GRID_GAP }}>
              {rows.map((row, rowIndex) => (
                <View key={rowIndex} style={{ flexDirection: 'row', gap: GRID_GAP }}>
                  {row.map((game) => {
                    const isSelected = localIds.includes(game.id);
                    // Below the floor, a game can still be deselected (in
                    // case the room shrank after it was picked) — it just
                    // can't be newly added one at a time until the room has
                    // enough players. Select All is an explicit bulk
                    // override and bypasses this.
                    const belowMinPlayers = !!game.minPlayers && playerCount < game.minPlayers;
                    const locked = !isSelected && belowMinPlayers;
                    return (
                      <GameGridCard
                        key={game.id}
                        game={game}
                        cellSize={cellSize}
                        selected={isSelected}
                        locked={locked}
                        onPress={() => handleCardPress(game.id)}
                      />
                    );
                  })}
                </View>
              ))}
              {editGames.length === 0 && (
                <Text style={{ color: colors.dune, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                  No games in this category.
                </Text>
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            <View className="gap-2">
              {viewGames.map((game) => (
                <Pressable
                  key={game.id}
                  onPress={() => router.push(`/games/${game.id}`)}
                  className="flex-row items-center border-2 border-[#0A0A0F] bg-white px-4 py-3 rounded-none active:opacity-70"
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
                    <Text className="text-[#A8977A] text-xs mt-0.5">{game.tagline}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.dune} strokeWidth={2} />
                </Pressable>
              ))}
              {viewGames.length === 0 && (
                <Text style={{ color: colors.dune, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                  No games in this category.
                </Text>
              )}
            </View>
          </ScrollView>
        )}

        {mode === 'edit' && (
          <Pressable
            onPress={onClose}
            disabled={noneSelected}
            style={{
              marginBottom: insets.bottom > 0 ? insets.bottom : 16,
              marginTop: 4,
              opacity: noneSelected ? 0.4 : 1,
            }}
            className={`py-4 items-center rounded-none ${noneSelected ? 'bg-amber' : 'bg-amber active:opacity-80'}`}
          >
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
              {noneSelected ? 'Pick at least one game' : 'Done'}
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// ── Grid card — deliberately mirrors the main Game Catalog screen's card
// chrome exactly (2px ink border, ink-bordered icon tile, fixed-height
// centered text block) rather than inventing its own look. The only
// additions this screen needs on top of that shared chrome are a selection
// checkmark and a dimmed-but-still-colored "not selected" state. ───────────

// Fixed, not `minHeight` — every card in a row must be the same height
// regardless of title length, or short titles vs. long ones misalign the
// row. Slightly taller than the catalog screen's own 60 (not identical) to
// leave room for the occasional "Needs N+ players" locked note, which only
// this screen has.
const TEXT_BLOCK_H = 64;

function GameGridCard({
  game,
  cellSize,
  selected,
  locked,
  onPress,
}: {
  game: GameMeta;
  cellSize: number;
  selected: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={locked} style={{ width: cellSize }} className={locked ? '' : 'active:opacity-75'}>
      <View
        style={{
          width: cellSize,
          borderWidth: 2,
          borderColor: colors.ink,
          backgroundColor: colors.parchment,
          // Dimmed, not desaturated — the accent color underneath stays
          // exactly what it is; only the whole card's opacity drops, so an
          // unselected game still reads as itself, just "switched off".
          opacity: selected ? 1 : 0.4,
        }}
      >
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
          <game.Icon size={cellSize * 0.32} color={colors.parchment} strokeWidth={1.75} />

          {/* Inset, not overflowing the card's own bounds — a badge hanging
              past the card's edge (as an earlier version did) risked being
              clipped by the ScrollView's own clip bounds for the rightmost
              column and the first row, since there's no slack left there
              once the grid math already spends the full row width. */}
          {selected && (
            <View
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: colors.amber,
                borderWidth: 2,
                borderColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={11} color={colors.ink} strokeWidth={3} />
            </View>
          )}
        </View>

        <View
          style={{
            height: TEXT_BLOCK_H,
            paddingHorizontal: cellSize * 0.08,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{
              color: colors.ink,
              fontSize: Math.max(10, Math.min(12, cellSize * 0.115)),
              fontWeight: '900',
              letterSpacing: 0.2,
              lineHeight: Math.max(12, Math.min(15, cellSize * 0.14)),
              textAlign: 'center',
              textTransform: 'uppercase',
            }}
          >
            {game.title}
          </Text>
          {locked && (
            <Text style={{ color: colors.stop, fontSize: 8, marginTop: 2, fontWeight: '700', textAlign: 'center' }}>
              {game.minPlayers}+ players
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
