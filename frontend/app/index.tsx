import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { Redirect, router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { API_BASE } from '@/constants/api';

export default function HomeScreen() {
  const { isLoading, isOnboarded, displayName, playerId } = usePlayerIdentity();
  const [joinExpanded, setJoinExpanded] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
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
      const res = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_id: playerId ?? '' }),
      });
      if (!res.ok) throw new Error();
      const data: { code: string; share_url: string } = await res.json();
      router.push(
        `/room/${data.code}/lobby?isAdmin=true&shareUrl=${encodeURIComponent(data.share_url)}`
      );
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
      if (data.state !== 'LOBBY') {
        setError('Game already in progress.');
        return;
      }
      router.push(`/room/${code}/lobby`);
    } catch {
      setError('Could not reach server. Check your connection.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <View className="flex-1 justify-center px-6 bg-ink">
      <View className="mb-14">
        <Text className="text-amber text-sm font-mono tracking-widest uppercase mb-2">
          Real-time party game
        </Text>
        <Text className="text-chalk text-5xl font-bold tracking-tightest leading-none">
          SipSync
        </Text>
        {displayName && (
          <Text className="text-fog text-sm mt-3">Playing as {displayName}</Text>
        )}
      </View>

      <View className="gap-3">
        <Pressable
          onPress={handleCreateRoom}
          disabled={creating}
          className="bg-amber rounded-xl py-4 items-center active:opacity-80 disabled:opacity-50"
        >
          {creating ? (
            <ActivityIndicator color="#0A0A0F" />
          ) : (
            <Text className="text-ink text-base font-bold tracking-wide">Create Room</Text>
          )}
        </Pressable>

        {!joinExpanded ? (
          <Pressable
            onPress={() => { setJoinExpanded(true); setError(null); }}
            className="border border-rim rounded-xl py-4 items-center active:opacity-60"
          >
            <Text className="text-chalk text-base font-semibold">Join with code</Text>
          </Pressable>
        ) : (
          <View className="gap-2">
            <View className="flex-row gap-2">
              <TextInput
                className="flex-1 border border-rim rounded-xl py-4 px-4 text-chalk text-center text-xl font-mono tracking-widest bg-surface"
                placeholder="XXXXXX"
                placeholderTextColor="#64748B"
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
                className="border border-amber rounded-xl px-5 items-center justify-center active:opacity-80 disabled:opacity-40"
              >
                {joining ? (
                  <ActivityIndicator color="#F59E0B" />
                ) : (
                  <Text className="text-amber font-bold text-base">Join</Text>
                )}
              </Pressable>
            </View>
            <Pressable
              onPress={() => { setJoinExpanded(false); setCodeInput(''); setError(null); }}
              className="items-center py-2"
            >
              <Text className="text-fog text-sm">Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>

      {error && (
        <Text className="text-stop text-sm text-center mt-4">{error}</Text>
      )}
    </View>
  );
}
