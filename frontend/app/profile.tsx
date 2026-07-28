import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { VIBE_KEYS, VIBE_ICONS } from '@/constants/vibes';
import { colors, typography } from '@/constants/design';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { isLoading, displayName, vibe, setIdentity } = usePlayerIdentity();
  const [name, setName] = useState('');
  const [selectedVibe, setSelectedVibe] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(displayName ?? '');
    setSelectedVibe(vibe);
  }, [displayName, vibe]);

  const canSave = name.trim().length >= 2;
  const dirty = name.trim() !== (displayName ?? '') || selectedVibe !== vibe;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    await setIdentity(name.trim(), selectedVibe);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-[#FFF8E1]">
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
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

        <View className="mb-10">
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
            Your identity
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            Your
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 40, lineHeight: 44, letterSpacing: -2 }}>
            Profile
          </Text>
        </View>

        <Text
          style={{
            color: colors.dune,
            ...typography.label,
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Name
        </Text>
        <TextInput
          style={{
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: colors.parchment,
            color: colors.ink,
            fontSize: 20,
            fontWeight: '700',
            paddingHorizontal: 16,
            paddingVertical: 14,
            marginBottom: 28,
          }}
          placeholder="Your name…"
          placeholderTextColor={colors.dune}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          maxLength={20}
          returnKeyType="done"
        />

        <Text
          style={{
            color: colors.dune,
            ...typography.label,
            fontSize: 11,
            letterSpacing: 3,
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Avatar
        </Text>
        <View className="flex-row flex-wrap" style={{ gap: 10, marginBottom: 32 }}>
          {VIBE_KEYS.map((key) => {
            const Icon = VIBE_ICONS[key];
            const selected = selectedVibe === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedVibe(selected ? null : key)}
                style={{
                  width: 56,
                  height: 56,
                  borderWidth: 2,
                  borderColor: colors.ink,
                  backgroundColor: selected ? colors.amber : colors.parchment,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                className="active:opacity-70"
              >
                <Icon size={24} strokeWidth={2} color={colors.ink} />
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSave}
          disabled={!canSave || saving || (!dirty && !saved)}
          className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
        >
          {saving ? (
            <ActivityIndicator color={colors.ink} />
          ) : (
            <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
              {saved ? 'Saved' : 'Save'}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}
