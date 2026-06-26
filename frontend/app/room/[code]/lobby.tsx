import { useEffect, useState } from 'react';
import { View, Text, Pressable, Share, ScrollView, ActivityIndicator } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';

const AVATAR_COLORS = [
  '#C4852A', '#8A4A2A', '#7A6A3A', '#A05C2A', '#6A4A1A',
  '#4A8A6F', '#3D6A5A', '#5A8888', '#3D7A6A', '#5A7A4A',
  '#3D7FA5', '#2D5A8A', '#4A6A9A', '#3D5A7A', '#5A7A9A',
  '#C4577A', '#A04A6A', '#8A3A5A', '#C46A5A', '#A05A5A',
  '#7A5A9A', '#6A4A8A', '#8A6A9A', '#5A7A5A', '#7A5A3A',
  '#6A7A9A', '#9A6A4A', '#5A6A7A',
];

const COLS = 6;

function avatarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) & 0xffffffff;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send } = useRoomSocket(code);
  const [copied, setCopied] = useState(false);

  const isRoomAdmin = !!snapshot && snapshot.admin_id === playerId;
  const players = Object.entries(snapshot?.players ?? {});
  const playerRows = chunkArray(players, COLS);

  useEffect(() => {
    if (snapshot?.state === 'TUTORIAL') {
      router.replace({
        pathname: '/room/[code]/tutorial',
        params: {
          code,
          tutorialType: snapshot.tutorialType ?? 'timed_text',
          tutorialAsset: snapshot.tutorialAsset ?? '',
        },
      });
    }
  }, [snapshot?.state, code]);

  async function handleCopy() {
    await Clipboard.setStringAsync(code ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare() {
    await Share.share({ message: `Join my SipSync room! Code: ${code}` });
  }

  function handleStartGame() {
    send({ type: 'ADMIN_START' });
  }

  const lobbyTitle = players.length < 2
    ? 'Waiting for friends…'
    : players.length < 5
    ? 'Almost there!'
    : 'Ready to play!';

  return (
    <View className="flex-1 bg-ink px-6 pt-20 pb-14">

      {/* Header */}
      <View className="mb-8">
        <Text style={{ fontWeight: '800', color: '#F0F0E8', fontSize: 32, letterSpacing: -1 }}>
          {lobbyTitle}
        </Text>
        <Text className="font-mono text-[11px] tracking-[0.28em] uppercase text-amber mt-2">
          {players.length} {players.length === 1 ? 'player' : 'players'} joined
        </Text>
      </View>

      {/* Avatar grid — vertically centered in available space */}
      {!snapshot ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#F59E0B" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 14 }}
        >
          {playerRows.map((row, rowIdx) => (
            <View key={rowIdx} className="flex-row justify-center" style={{ gap: 10 }}>
              {row.map(([pid, player]) => {
                const color = avatarColor(pid);
                const initial = (player.display_name?.match(/[A-Za-zא-ת؀-ۿ]/)?.[0] ?? '?').toUpperCase();
                const isAdmin = pid === snapshot.admin_id;
                const shortName = (player.display_name ?? '').substring(0, 8);

                return (
                  <View key={pid} style={{ width: 48, alignItems: 'center' }}>
                    <View
                      style={{
                        width: 48,
                        height: 48,
                        backgroundColor: color,
                        borderWidth: isAdmin ? 2 : 1,
                        borderColor: isAdmin ? '#F59E0B' : '#252538',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ color: '#F0F0E8', fontSize: 20, fontWeight: '700' }}>
                        {initial}
                      </Text>
                    </View>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: '#64748B',
                        fontSize: 9,
                        marginTop: 3,
                        fontWeight: '500',
                        textAlign: 'center',
                        width: 48,
                      }}
                    >
                      {shortName}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Bottom section */}
      <View className="gap-3 mt-4">
        {/* Code box — centered code, icon absolute right */}
        <Pressable
          onPress={handleCopy}
          className="bg-surface border border-amber py-4 items-center rounded-none active:opacity-70"
          style={{ position: 'relative' }}
        >
          <Text
            style={{
              color: '#F0F0E8',
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
            <Feather
              name={copied ? 'check' : 'copy'}
              size={20}
              color={copied ? '#16A34A' : '#F0F0E8'}
            />
          </View>
        </Pressable>

        {/* Admin actions */}
        {isRoomAdmin && (
          <>
            <Pressable
              onPress={handleShare}
              className="bg-surface border border-rim py-4 flex-row items-center justify-center gap-2 rounded-none active:opacity-60"
            >
              <Feather name="share" size={16} color="#F0F0E8" />
              <Text className="text-chalk text-sm font-bold tracking-[0.18em] uppercase">
                Share Invite
              </Text>
            </Pressable>

            <Pressable
              onPress={handleStartGame}
              disabled={players.length < 2}
              className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
            >
              <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                {players.length < 2 ? 'Waiting for players…' : 'Start Game'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
