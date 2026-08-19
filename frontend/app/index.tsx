import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import Head from 'expo-router/head';
import { CircleUser, LayoutGrid } from 'lucide-react-native';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import JoinRoomModal from '@/components/JoinRoomModal';
import { API_BASE } from '@/constants/api';
import { GAME_CATALOG } from '@/constants/games';

export default function HomeScreen() {
  useWebPageBackground('#FFF8E1');
  const { isLoading, isOnboarded, displayName, playerId } = usePlayerIdentity();
  const insets = useSafeAreaInsets();
  const [joinOpen, setJoinOpen] = useState(false);
  const [creating, setCreating] = useState(false);
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

  return (
    <View style={{ flex: 1 }} className="bg-[#FFF8E1]">
      <Head>
        <link rel="canonical" href="https://www.quicklegame.com/" />
      </Head>
      {/* Mascot: stands in the bottom-right corner, behind the content and
          untouchable, so it never collides with the wordmark (which spans
          the full width on phones) or blocks a button press. Hidden while
          the join modal is up — iOS Safari shrinks the viewport when the
          keyboard opens, which floated him up into the dimmed area, an
          odd background presence during code entry. */}
      {!joinOpen && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: 4, bottom: insets.bottom - 6 }}
        >
          <Image source={require('@/assets/duck.png')} style={{ width: 170, height: 170 }} />
        </View>
      )}
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
          // Wordmark sits higher now that the eyebrow line is gone — but
          // clears the notch (insets.top) and the profile button row.
          paddingTop: insets.top + 52,
          // The real fix for the unreachable Start button: the page itself
          // now scrolls, and its last bit of content always clears the home
          // indicator / gesture bar instead of running under it.
          paddingBottom: insets.bottom + 24,
        }}
      >
        {/* Title block */}
        <View className="mb-14">
          {/* Signature: single-line wordmark, alternating ink/amber letters —
              same treatment as the OG share card, so the brand reads the
              same in a WhatsApp preview and on first open. */}
          <Text style={{ fontWeight: '900', fontSize: 96, lineHeight: 104, letterSpacing: -4 }}>
            <Text style={{ color: '#0A0A0F' }}>Q</Text>
            <Text style={{ color: '#F59E0B' }}>u</Text>
            <Text style={{ color: '#0A0A0F' }}>i</Text>
            <Text style={{ color: '#F59E0B' }}>c</Text>
            <Text style={{ color: '#0A0A0F' }}>k</Text>
            <Text style={{ color: '#F59E0B' }}>l</Text>
            <Text style={{ color: '#0A0A0F' }}>e</Text>
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

          <Pressable
            onPress={() => { setJoinOpen(true); setError(null); }}
            className="border-2 border-[#0A0A0F] py-5 items-center rounded-none active:opacity-60"
          >
            <Text className="text-[#0A0A0F] text-sm font-bold tracking-[0.18em] uppercase">
              Join with code
            </Text>
          </Pressable>
        </View>

        {error && (
          <Text className="text-stop text-sm text-center mt-4">{error}</Text>
        )}
      </ScrollView>

      {joinOpen && <JoinRoomModal onClose={() => setJoinOpen(false)} />}
    </View>
  );
}
