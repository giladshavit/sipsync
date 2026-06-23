import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { router } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';

const EMOJIS = ['🍺', '🥃', '🍹', '🎯', '🔥', '💀', '🥂', '🎲'];

export default function OnboardingScreen() {
  const { setDisplayName } = usePlayerIdentity();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canContinue = name.trim().length >= 2;

  async function handleContinue() {
    if (!canContinue || saving) return;
    setSaving(true);
    const displayName = emoji ? `${emoji} ${name.trim()}` : name.trim();
    await setDisplayName(displayName);
    router.replace('/');
  }

  return (
    <View className="flex-1 bg-ink px-6 pt-16 pb-10 justify-between">
      <View>
        <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-3">
          First time here
        </Text>
        <Text className="text-chalk text-4xl font-bold tracking-tightest leading-tight">
          What do your{'\n'}friends call you?
        </Text>

        <TextInput
          className="text-chalk text-3xl font-bold border-b border-rim pb-3 mt-10 mb-10"
          placeholder="Your name…"
          placeholderTextColor="#64748B"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoFocus
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />

        <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-4">
          Pick a vibe (optional)
        </Text>
        <View className="flex-row flex-wrap gap-3">
          {EMOJIS.map((e) => (
            <Pressable
              key={e}
              onPress={() => setEmoji(emoji === e ? null : e)}
              className={`w-14 h-14 rounded-xl items-center justify-center ${
                emoji === e ? 'bg-amber' : 'bg-surface'
              }`}
            >
              <Text className="text-2xl">{e}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        onPress={handleContinue}
        disabled={!canContinue || saving}
        className={`rounded-xl py-4 items-center ${
          canContinue ? 'bg-amber active:opacity-80' : 'bg-surface'
        }`}
      >
        <Text
          className={`text-base font-bold tracking-wide ${
            canContinue ? 'text-ink' : 'text-fog'
          }`}
        >
          {saving ? 'Saving…' : "Let's go →"}
        </Text>
      </Pressable>
    </View>
  );
}
