import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { apiFetch } from '@/lib/api';
import { trackPixelEvent } from '@/lib/metaPixel';

// Room-code entry as an overlay card anchored to the TOP of the screen.
// A modal instead of an inline field is deliberate: on iOS Safari the
// keyboard covers the bottom half of the page without resizing it, so any
// input living down there gets buried or forces the page to pan. A card in
// the top third sits above where the keyboard can ever reach — no viewport
// tricks needed.
export default function JoinRoomModal({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6 || joining) return;
    setJoining(true);
    setError(null);
    try {
      const res = await apiFetch(`/rooms/${trimmed}`);
      if (!res.ok) throw new Error();
      const data: { exists: boolean; state: string | null } = await res.json();
      if (!data.exists) {
        setError('Room not found.');
        return;
      }
      // Late Join is allowed — lobby.tsx routes a mid-round arrival to the
      // Waiting Room off the first ROOM_STATE snapshot.
      trackPixelEvent('room_joined', { via: 'code' });
      onClose();
      router.push(`/room/${trimmed}/lobby`);
    } catch {
      setError('Could not reach server. Check your connection.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(10, 10, 15, 0.6)',
        zIndex: 10,
      }}
    >
      {/* Tapping the dim closes; the card itself swallows its taps. */}
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={onClose} />

      <View
        style={{
          marginTop: insets.top + 76,
          marginHorizontal: 24,
          backgroundColor: colors.parchment,
          borderWidth: 2,
          borderColor: colors.ink,
          padding: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 12, letterSpacing: 3 }}>
            Join a room
          </Text>
          <Pressable onPress={onClose} hitSlop={10} className="active:opacity-60">
            <X size={20} color={colors.ink} strokeWidth={2.5} />
          </Pressable>
        </View>

        <TextInput
          style={{
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: '#FFFFFF',
            color: colors.ink,
            fontSize: 24,
            textAlign: 'center',
            paddingVertical: 14,
            letterSpacing: 8,
          }}
          className="font-mono"
          placeholder="XXXXXX"
          placeholderTextColor="#C4B49A"
          autoCapitalize="characters"
          autoFocus
          maxLength={6}
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase());
            setError(null);
          }}
          onSubmitEditing={handleJoin}
        />

        {error && (
          <Text style={{ color: colors.stop, fontSize: 13, textAlign: 'center', marginTop: 10 }}>
            {error}
          </Text>
        )}

        <Pressable
          onPress={handleJoin}
          disabled={code.trim().length !== 6 || joining}
          className="bg-amber items-center rounded-none active:opacity-80 disabled:opacity-40"
          style={{ paddingVertical: 16, marginTop: 14 }}
        >
          {joining ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">Join</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
