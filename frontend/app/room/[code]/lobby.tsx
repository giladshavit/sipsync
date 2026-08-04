import { useEffect, useState } from 'react';
import { View, Text, Pressable, Share, ScrollView, ActivityIndicator, Image } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Check, Copy, Eye, Pencil, Share2, Volume2, VolumeX } from 'lucide-react-native';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useAudio } from '@/contexts/AudioContext';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { buildRoomShareMessage } from '@/lib/deepLink';
import { VIBE_ICONS } from '@/constants/vibes';
import { colors, typography } from '@/constants/design';
import { GAME_CATALOG, getGameById } from '@/constants/games';
import { AVATAR_IMAGES, AVATAR_COLORS, avatarFallbackColor } from '@/constants/avatars';
import { GamesSheet } from '@/components/GamesSheet';
import { AvatarPickerSheet } from '@/components/AvatarPickerSheet';

// ~1.4x the original 56px slot — big enough that flex-wrap (not a fixed
// column count) decides how many fit per row on any given screen width.
const AVATAR_SIZE = 78;

export default function LobbyScreen() {
  useWebPageBackground(colors.cream);
  const { code } = useLocalSearchParams<{ code: string }>();
  const insets = useSafeAreaInsets();
  const { playerId } = usePlayerIdentity();
  const { isMuted, toggleMute } = useAudio();
  const { snapshot, send } = useRoomSocket(code);
  const [copied, setCopied] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [gamesSheetMode, setGamesSheetMode] = useState<'edit' | 'view' | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const isRoomAdmin = !!snapshot && snapshot.admin_id === playerId;
  const players = Object.entries(snapshot?.players ?? {});
  // A disconnected player stays in `players` (seat/score/avatar reserved for
  // the server's reconnection grace period) but shouldn't count toward
  // headcount-driven copy or gating — those should reflect who's actually here.
  const connectedPlayers = players.filter(([, p]) => p.connected !== false);
  const gameIds = snapshot?.gameIds ?? [];
  const selectedGames = gameIds
    .map((id) => getGameById(id))
    .filter((g): g is NonNullable<typeof g> => g != null);
  const myPlayer = playerId ? snapshot?.players[playerId] : undefined;
  const myAvatar = myPlayer?.avatar ?? null;
  const takenAvatars = new Set(
    players.filter(([pid]) => pid !== playerId).map(([, p]) => p.avatar).filter((a): a is string => !!a),
  );

  useEffect(() => {
    if (!snapshot?.state) return;

    // Late Join: a fresh arrival mid-round is flagged waiting_for_next_game
    // by the server (see handle_handshake) — they have no data for the live
    // tutorial/board of a round they weren't part of, so the Waiting Room
    // holds them until it ends instead of routing onward like everyone else.
    if (myPlayer?.waiting_for_next_game && (snapshot.state === 'TUTORIAL' || snapshot.state === 'PLAYING')) {
      router.replace({ pathname: '/room/[code]/waiting', params: { code } });
      return;
    }

    if (snapshot.state === 'TUTORIAL') {
      router.replace({
        pathname: '/room/[code]/tutorial',
        params: {
          code,
          tutorialType: snapshot.tutorialType ?? 'timed_text',
          tutorialAsset: snapshot.tutorialAsset ?? '',
        },
      });
      return;
    }

    // Defensive fallbacks for a client that somehow lands on lobby.tsx
    // after the room has already moved on (e.g. a join whose first
    // snapshot arrives mid-round, past TUTORIAL, but not flagged waiting —
    // an existing participant reconnecting here rather than on the screen
    // they left) — route straight to where that state actually lives
    // instead of leaving them stuck on the lobby roster.
    if (snapshot.state === 'CUSTOM_QUESTION_INPUT') {
      router.replace({
        pathname: '/room/[code]/custom-question',
        params: { code, writerId: snapshot.writerId ?? '' },
      });
      return;
    }
    if (snapshot.state === 'PLAYING') {
      router.replace({ pathname: '/room/[code]/game', params: { code } });
      return;
    }
    if (snapshot.state === 'PERSONAL_SUMMARY' || snapshot.state === 'PODIUM') {
      router.replace({ pathname: '/room/[code]/podium', params: { code } });
    }
  }, [snapshot?.state, snapshot?.writerId, myPlayer?.waiting_for_next_game, code]);

  async function handleCopy() {
    await Clipboard.setStringAsync(code ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare() {
    await Share.share({ message: buildRoomShareMessage(code ?? '') });
  }

  function handleStartGame() {
    send({ type: 'ADMIN_START' });
  }

  function handleLeave() {
    send({ type: 'LEAVE_ROOM' });
    router.replace('/');
  }

  // Shared by every path that can change the room's game selection — always
  // reorders to catalog order and never lets the list go empty (the server's
  // own normalize_game_ids rejects an empty list, silently no-oping the
  // SET_GAMES message, so this guard keeps the UI truthful about what will
  // actually apply).
  function commitGameIds(next: string[]) {
    const ordered = GAME_CATALOG.filter((g) => next.includes(g.id)).map((g) => g.id);
    if (ordered.length === 0) return;
    send({ type: 'SET_GAMES', game_ids: ordered });
  }

  // Every selection change in GamesSheet's edit mode — one card tap, Select
  // All, or Deselect All — goes through this single bulk path, so GamesSheet
  // can own its own local "what's checked right now" state (including a
  // transient all-deselected state the server itself will never accept) and
  // just hand us the resulting full list each time.
  function handleSetGames(ids: string[]) {
    commitGameIds(Array.from(new Set(ids)));
  }

  // Split-weight titles — thin ink line over heavy amber line, like the
  // home screen's Sip / Sync signature.
  const [titleThin, titleHeavy] = connectedPlayers.length < 2
    ? ['Waiting for', 'friends…']
    : connectedPlayers.length < 5
    ? ['Almost', 'there!']
    : ['Ready to', 'play!'];

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.cream,
        paddingTop: insets.top + 20,
        paddingBottom: insets.bottom + 20,
      }}
      className="px-6"
    >

      {/* Top bar: back to home + mute toggle */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <Pressable
          onPress={() => setConfirmingLeave(true)}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        <Pressable
          onPress={toggleMute}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          {isMuted ? (
            <VolumeX size={20} color={colors.ink} />
          ) : (
            <Volume2 size={20} color={colors.ink} />
          )}
        </Pressable>
      </View>

      {/* Header */}
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
          {connectedPlayers.length} {connectedPlayers.length === 1 ? 'player' : 'players'} joined
        </Text>
        <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
          {titleThin}
        </Text>
        <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
          {titleHeavy}
        </Text>
      </View>

      {/* Tonight's games — horizontal strip, live for every player */}
      {selectedGames.length > 0 && (
        <View className="mb-5">
          <View className="flex-row items-center justify-between mb-2.5">
            <Text
              style={{
                color: colors.dune,
                ...typography.label,
                fontSize: 10,
                letterSpacing: 2.5,
                textTransform: 'uppercase',
              }}
            >
              {selectedGames.length} game{selectedGames.length === 1 ? '' : 's'} tonight
            </Text>
            {isRoomAdmin ? (
              <Pressable
                onPress={() => setGamesSheetMode('edit')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderWidth: 1.5,
                  borderColor: colors.ink,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                }}
                className="active:opacity-60"
              >
                <Pencil size={11} color={colors.ink} strokeWidth={2} />
                <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '700' }}>
                  Edit games
                </Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => setGamesSheetMode('view')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  borderWidth: 1.5,
                  borderColor: colors.ink,
                  paddingHorizontal: 9,
                  paddingVertical: 5,
                }}
                className="active:opacity-60"
              >
                <Eye size={11} color={colors.ink} strokeWidth={2} />
                <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '700' }}>
                  View games
                </Text>
              </Pressable>
            )}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10 }}
          >
            {selectedGames.map((game) => (
              <Pressable
                key={game.id}
                onPress={() => router.push(`/games/${game.id}`)}
                style={{ width: 68, alignItems: 'center' }}
                className="active:opacity-70"
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    backgroundColor: game.accentColor,
                    borderWidth: 2,
                    borderColor: colors.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <game.Icon size={26} color={colors.parchment} strokeWidth={2} />
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.ink,
                    fontSize: 10,
                    fontWeight: '700',
                    marginTop: 5,
                    textAlign: 'center',
                    width: 68,
                  }}
                >
                  {game.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Avatar grid — vertically centered in available space */}
      {!snapshot ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.amber} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        >
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            {players.map(([pid, player]) => {
              const initial = (player.display_name?.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();
              const isAdmin = pid === snapshot.admin_id;
              const isSelf = pid === playerId;
              const shortName = (player.display_name ?? '').substring(0, 8);
              const VibeIcon = player.vibe ? VIBE_ICONS[player.vibe] : undefined;
              const AvatarBox = isSelf ? Pressable : View;
              // Force a circular clip + colored ring in code rather than
              // trusting the source image's own baked-in circle — don't
              // depend on the asset alone to look round.
              const avatarSource = player.avatar ? AVATAR_IMAGES[player.avatar] : undefined;
              // The border matches this specific avatar's own accent color
              // when there's an image; otherwise falls back to the per-player
              // hash color used for the vibe/initial placeholder.
              const ringColor = player.avatar ? AVATAR_COLORS[player.avatar] : undefined;
              const fallbackColor = avatarFallbackColor(pid);
              // Still in the roster (seat/score/avatar reserved) but their
              // socket dropped — the server keeps them for a reconnection
              // grace period before a PLAYER_LEFT actually removes them.
              const isDisconnected = player.connected === false;

              return (
                <Animated.View
                  key={pid}
                  entering={FadeInDown.duration(300)}
                  style={{ width: AVATAR_SIZE, alignItems: 'center', opacity: isDisconnected ? 0.4 : 1 }}
                >
                  {/* Plain wrapper (no overflow clipping) so the edit badge
                      below can sit half outside the circle without being
                      cut off by the circle's own clip — and, since it's
                      absolutely positioned, it takes no layout space, so
                      every avatar in the row stays the same height whether
                      or not it's yours. */}
                  <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
                    <AvatarBox
                      {...(isSelf ? { onPress: () => setAvatarPickerOpen(true) } : {})}
                      style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        borderRadius: AVATAR_SIZE / 2,
                        overflow: 'hidden',
                        borderWidth: 3,
                        borderColor: ringColor ?? colors.ink,
                        backgroundColor: avatarSource ? colors.parchment : fallbackColor,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      className={isSelf ? 'active:opacity-70' : undefined}
                    >
                      {avatarSource ? (
                        <Image
                          source={avatarSource}
                          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
                          resizeMode="cover"
                        />
                      ) : VibeIcon ? (
                        <VibeIcon size={32} strokeWidth={2} color={colors.parchment} />
                      ) : (
                        <Text style={{ color: colors.parchment, fontSize: 30, fontWeight: '700' }}>
                          {initial}
                        </Text>
                      )}
                    </AvatarBox>
                    {isSelf && (
                      <Pressable
                        onPress={() => setAvatarPickerOpen(true)}
                        hitSlop={6}
                        style={{
                          position: 'absolute',
                          bottom: -3,
                          right: -3,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: colors.amber,
                          borderWidth: 2,
                          borderColor: colors.ink,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        className="active:opacity-70"
                      >
                        <Pencil size={12} color={colors.ink} strokeWidth={2.5} />
                      </Pressable>
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: isAdmin ? colors.amber : colors.dune,
                      fontSize: 11,
                      marginTop: 6,
                      fontWeight: isAdmin ? '800' : '600',
                      textAlign: 'center',
                      width: AVATAR_SIZE,
                    }}
                  >
                    {shortName}
                  </Text>
                  {isDisconnected ? (
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      style={{
                        color: colors.dune,
                        ...typography.label,
                        fontSize: 7,
                        letterSpacing: 0.6,
                        fontWeight: '700',
                        marginTop: 1,
                        textAlign: 'center',
                        width: AVATAR_SIZE,
                      }}
                    >
                      RECONNECTING
                    </Text>
                  ) : isAdmin ? (
                    <Text
                      style={{
                        color: colors.amber,
                        ...typography.label,
                        fontSize: 8,
                        letterSpacing: 1.5,
                        fontWeight: '700',
                        marginTop: 1,
                      }}
                    >
                      HOST
                    </Text>
                  ) : null}
                </Animated.View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Bottom section */}
      <View className="gap-3 mt-4">
        {/* Code box — centered code, icon absolute right. Deliberately kept
            monospace (unlike the rest of the app's former Courier New
            usage) — this is an actual shared alphanumeric code, where fixed
            character widths and 1/I/l disambiguation are real functional
            wins, not just a leftover default. */}
        <Pressable
          onPress={handleCopy}
          style={{
            backgroundColor: colors.parchment,
            borderWidth: 2,
            borderColor: colors.ink,
            paddingVertical: 16,
            alignItems: 'center',
          }}
          className="active:opacity-70"
        >
          <Text
            style={{
              color: colors.ink,
              fontSize: 26,
              fontFamily: 'Courier New',
              fontWeight: '700',
              letterSpacing: 9,
              textAlign: 'center',
            }}
          >
            {code}
          </Text>
          <View style={{ position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center' }}>
            {copied ? (
              <Check size={20} color={colors.go} />
            ) : (
              <Copy size={20} color={colors.ink} />
            )}
          </View>
        </Pressable>

        {/* Admin actions */}
        {isRoomAdmin ? (
          <>
            <Pressable
              onPress={handleShare}
              style={{ borderWidth: 2, borderColor: colors.ink }}
              className="py-4 flex-row items-center justify-center gap-2 rounded-none active:opacity-60"
            >
              <Share2 size={16} color={colors.ink} />
              <Text style={{ color: colors.ink }} className="text-sm font-bold tracking-[0.18em] uppercase">
                Share Invite
              </Text>
            </Pressable>

            <Pressable
              onPress={handleStartGame}
              disabled={connectedPlayers.length < 2}
              className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
            >
              <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                {connectedPlayers.length < 2 ? 'Waiting for players…' : 'Start Game'}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text
            style={{
              color: colors.dune,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 3,
              textTransform: 'uppercase',
              textAlign: 'center',
              paddingVertical: 12,
            }}
          >
            Waiting for host to start
          </Text>
        )}
      </View>

      {/* Leave confirmation overlay */}
      {confirmingLeave && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(10,10,15,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: colors.cream,
              borderWidth: 2,
              borderColor: colors.ink,
              padding: 24,
            }}
          >
            <Text style={{ fontWeight: '900', color: colors.ink, fontSize: 24, letterSpacing: -0.5, marginBottom: 8 }}>
              Leave the room?
            </Text>
            <Text style={{ color: colors.dune, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
              {isRoomAdmin
                ? 'Hosting passes to a random player. You can rejoin with the code.'
                : 'You can rejoin anytime with the code.'}
            </Text>

            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmingLeave(false)}
                className="bg-amber py-4 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Stay
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLeave}
                style={{ borderWidth: 2, borderColor: colors.stop }}
                className="py-4 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: colors.stop }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  Leave room
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Games sheet — edit (admin) or view (everyone else), rendered inline
          so it reuses this screen's own socket connection (see GamesSheet) */}
      {gamesSheetMode && (
        <GamesSheet
          mode={gamesSheetMode}
          selectedIds={gameIds}
          onSetSelected={gamesSheetMode === 'edit' ? handleSetGames : undefined}
          onClose={() => setGamesSheetMode(null)}
          playerCount={connectedPlayers.length}
        />
      )}

      {/* Avatar picker — same inline-overlay reasoning as GamesSheet */}
      {avatarPickerOpen && (
        <AvatarPickerSheet
          currentAvatar={myAvatar}
          takenAvatars={takenAvatars}
          onSelect={(avatar) => {
            // Deliberately doesn't close the sheet — the square frame moves
            // to the newly picked avatar once the server confirms it (see
            // currentAvatar), which is the confirmation the user actually
            // wants to see before they back out on their own.
            send({ type: 'SET_AVATAR', avatar });
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </View>
  );
}
