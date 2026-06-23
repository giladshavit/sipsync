import { useEffect } from 'react';
import { View, Text, Pressable, Share, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';

export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, isConnected, send } = useRoomSocket(code);

  const isRoomAdmin = !!snapshot && snapshot.admin_id === playerId;
  const players = Object.entries(snapshot?.players ?? {});

  // Navigate when FSM transitions out of LOBBY
  useEffect(() => {
    if (snapshot?.state === 'TUTORIAL') {
      router.replace(`/room/${code}/tutorial`);
    }
  }, [snapshot?.state, code]);

  async function handleShare() {
    await Share.share({ message: `Join my SipSync room! sipsync://room/${code}` });
  }

  function handleStartGame() {
    send({ type: 'ADMIN_START' });
  }

  return (
    <View className="flex-1 bg-ink px-6 pt-16">
      {/* Header */}
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-1">
        Room code
      </Text>
      <Text className="text-amber text-5xl font-mono font-bold tracking-widest mb-2">
        {code}
      </Text>

      {/* Connection pill */}
      <View className="flex-row items-center gap-1.5 mb-8">
        <View
          className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-go' : 'bg-fog'}`}
        />
        <Text className="text-fog text-xs">
          {isConnected ? 'Connected' : 'Connecting…'}
        </Text>
      </View>

      {/* Share button — always visible to admin */}
      {isRoomAdmin && (
        <Pressable
          onPress={handleShare}
          className="border border-amber rounded-xl py-3 items-center mb-6 active:opacity-70"
        >
          <Text className="text-amber font-semibold text-base">Share Invite</Text>
        </Pressable>
      )}

      {/* Player list */}
      <Text className="text-fog text-xs tracking-widest uppercase mb-3">
        Players ({players.length})
      </Text>

      {!snapshot ? (
        <ActivityIndicator color="#F59E0B" />
      ) : (
        <View className="gap-2 mb-8">
          {players.map(([pid, player]) => (
            <View
              key={pid}
              className="flex-row items-center px-4 py-3 bg-surface rounded-xl border border-rim"
            >
              <Text className="text-chalk flex-1">{player.display_name}</Text>
              {pid === snapshot.admin_id && (
                <Text className="text-amber text-xs font-mono tracking-widest">HOST</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Start Game — admin only, requires ≥ 2 players */}
      {isRoomAdmin && (
        <Pressable
          onPress={handleStartGame}
          disabled={players.length < 2}
          className="bg-amber rounded-xl py-4 items-center active:opacity-80 disabled:opacity-40"
        >
          <Text className="text-ink text-base font-bold">
            {players.length < 2 ? 'Waiting for players…' : 'Start Game'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
