import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { CircleUser, LayoutGrid } from 'lucide-react-native';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { API_BASE } from '@/constants/api';
import { GAME_CATALOG } from '@/constants/games';

export default function HomeScreen() {
  const { isLoading, isOnboarded, displayName, playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();
  const [joinExpanded, setJoinExpanded] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#FFF8E1]">
        <ActivityIndicator color="#F59E0B" />
      </View>
    );
  }

  if (!isOnboarded) {
    return <Redirect href="/onboarding" />;
  }

  async function handleCreateRoom() {
    setCreating(true);
    setError(null);
    try {
      // Every game plays by default — the host narrows it down from inside
      // the lobby (see components/GamesSheet.tsx), everyone else just
      // watches the selection update live.
      const gameIds = GAME_CATALOG.map((g) => g.id);
      const res = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_id: playerId ?? '', game_ids: gameIds }),
      });
      if (!res.ok) throw new Error();
      const data: { code: string; share_url: string } = await res.json();
      router.push({
        pathname: '/room/[code]/lobby',
        params: { code: data.code, isAdmin: 'true', shareUrl: data.share_url },
      });
    } catch {
      setError('Could not create room. Check your connection.');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom() {
    const code = codeInput.trim().toUpperCase();
    if (code.length !== 6) return;
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/rooms/${code}`);
      if (!res.ok) throw new Error();
      const data: { exists: boolean; state: string | null } = await res.json();
      if (!data.exists) {
        setError('Room not found.');
        return;
      }
      // Late Join: a round already in progress no longer blocks joining —
      // lobby.tsx reads the first ROOM_STATE snapshot and routes a mid-round
      // arrival to the Waiting Room instead of the live board/tutorial.
      router.push(`/room/${code}/lobby`);
    } catch {
      setError('Could not reach server. Check your connection.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <View style={{ flex: 1 }} className="bg-[#FFF8E1]">
      <Pressable
        onPress={() => router.push('/profile')}
        style={{
          position: 'absolute',
          top: insets.top + 16,
          right: 24,
          width: 42,
          height: 42,
          borderWidth: 2,
          borderColor: '#0A0A0F',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
        }}
        className="active:opacity-60"
      >
        <CircleUser size={20} color="#0A0A0F" strokeWidth={2} />
      </Pressable>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: 80,
          // The real fix for the unreachable Start button: the page itself
          // now scrolls, and its last bit of content always clears the home
          // indicator / gesture bar instead of running under it.
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* Title block */}
        <View className="mb-14">
          <Text className="font-mono text-[11px] tracking-[0.28em] uppercase text-amber mb-6">
            Real-time party game
          </Text>

          {/* Signature: single-line wordmark, heavy amber */}
          <Text style={{ fontWeight: '900', color: '#F59E0B', fontSize: 96, lineHeight: 104, letterSpacing: -4 }}>
            Quickle
          </Text>

          {displayName && (
            <Text className="text-[#A8977A] text-sm mt-5 tracking-wide">
              Playing as {displayName}
            </Text>
          )}

          <Pressable
            onPress={() => router.push('/games')}
            className="flex-row items-center gap-2 mt-5 active:opacity-60"
          >
            <LayoutGrid size={16} color="#0A0A0F" strokeWidth={2} />
            <Text className="text-[#0A0A0F] text-sm font-bold tracking-wide">
              Browse all games
            </Text>
          </Pressable>
        </View>

        {/* Buttons */}
        <View className="gap-3">
          <Pressable
            onPress={handleCreateRoom}
            disabled={creating}
            className="bg-amber py-5 items-center rounded-none active:opacity-75 disabled:opacity-40"
          >
            {creating ? (
              <ActivityIndicator color="#0A0A0F" />
            ) : (
              <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                Create Room
              </Text>
            )}
          </Pressable>

          {!joinExpanded ? (
            <Pressable
              onPress={() => { setJoinExpanded(true); setCodeInput(''); setError(null); }}
              className="border-2 border-[#0A0A0F] py-5 items-center rounded-none active:opacity-60"
            >
              <Text className="text-[#0A0A0F] text-sm font-bold tracking-[0.18em] uppercase">
                Join with code
              </Text>
            </Pressable>
          ) : (
            <View className="gap-2">
              <View className="flex-row gap-2">
                <TextInput
                  className="flex-1 border-2 border-[#0A0A0F] py-4 px-4 text-[#0A0A0F] text-center text-xl font-mono tracking-widest bg-white rounded-none"
                  placeholder="XXXXXX"
                  placeholderTextColor="#C4B49A"
                  autoCapitalize="characters"
                  autoFocus
                  maxLength={6}
                  value={codeInput}
                  onChangeText={(t) => { setCodeInput(t.toUpperCase()); setError(null); }}
                  onSubmitEditing={handleJoinRoom}
                />
                <Pressable
                  onPress={handleJoinRoom}
                  disabled={codeInput.trim().length !== 6 || joining}
                  className="bg-amber px-6 items-center justify-center rounded-none active:opacity-80 disabled:opacity-40"
                >
                  {joining ? (
                    <ActivityIndicator color="#0A0A0F" />
                  ) : (
                    <Text className="text-ink font-bold text-sm tracking-[0.15em] uppercase">
                      Join
                    </Text>
                  )}
                </Pressable>
              </View>
              <Pressable
                onPress={() => { setJoinExpanded(false); setCodeInput(''); setError(null); }}
                className="items-center py-2"
              >
                <Text className="text-[#A8977A] text-sm">Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>

        {error && (
          <Text className="text-stop text-sm text-center mt-4">{error}</Text>
        )}
      </ScrollView>
    </View>
  );
}
