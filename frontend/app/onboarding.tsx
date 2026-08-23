import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { colors, typography } from '@/constants/design';
import { AVATAR_POOL, AVATAR_IMAGES, AVATAR_COLORS } from '@/constants/avatars';

const AVATAR_SIZE = 64;
const AVATAR_GAP = 14;

export default function OnboardingScreen() {
  useWebPageBackground(colors.ink);
  const { redirectToRoom } = useLocalSearchParams<{ redirectToRoom?: string }>();
  const { displayName, isLoading, setIdentity, setPreferredAvatar } = usePlayerIdentity();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(displayName ?? '');
  }, [displayName]);

  const canContinue = name.trim().length >= 2 && avatar !== null;

  async function handleContinue() {
    if (!canContinue || saving || !avatar) return;
    setSaving(true);
    try {
      await setIdentity(name.trim(), null);
      await setPreferredAvatar(avatar);
      router.replace(redirectToRoom ? `/room/${redirectToRoom}` : '/');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Same layered-gradient-plus-glow technique as the tutorial screens —
          turns the flat colors.ink fill into something with atmosphere. */}
      <LinearGradient
        colors={[colors.surface, colors.ink]}
        locations={[0, 0.65]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -220,
          left: '50%',
          width: 460,
          height: 460,
          marginLeft: -230,
          borderRadius: 230,
          backgroundColor: colors.amber,
          opacity: 0.08,
        }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <Text
                style={{
                  ...typography.label,
                  color: colors.fog,
                  fontSize: 12,
                  marginBottom: 8,
                }}
              >
                Welcome to
              </Text>
              <Text
                style={{
                  ...typography.title,
                  color: colors.amber,
                  fontSize: 40,
                }}
              >
                Quickle
              </Text>
            </View>

            {/* Name input */}
            <View style={{ alignItems: 'center', marginBottom: 40 }}>
              <TextInput
                style={{
                  color: colors.chalk,
                  fontSize: 28,
                  fontWeight: '700',
                  textAlign: 'center',
                  borderBottomWidth: 2,
                  borderBottomColor: focused ? colors.amber : colors.rim,
                  paddingBottom: 12,
                  paddingHorizontal: 12,
                  width: '100%',
                }}
                placeholder="Your name…"
                placeholderTextColor={colors.fog}
                value={name}
                onChangeText={setName}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="words"
                autoFocus
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
            </View>

            {/* Avatar grid */}
            <View style={{ marginBottom: 24 }}>
              <Text
                style={{
                  ...typography.label,
                  color: colors.fog,
                  fontSize: 11,
                  textAlign: 'center',
                  marginBottom: 16,
                }}
              >
                Pick your avatar
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  gap: AVATAR_GAP,
                }}
              >
                {AVATAR_POOL.map((id) => {
                  const selected = avatar === id;
                  const tint = AVATAR_COLORS[id];
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setAvatar(id)}
                      style={{
                        width: AVATAR_SIZE,
                        height: AVATAR_SIZE,
                        borderRadius: AVATAR_SIZE / 2,
                        borderWidth: selected ? 3 : 1.5,
                        borderColor: selected ? colors.amber : colors.rim,
                        overflow: 'hidden',
                        transform: [{ scale: selected ? 1.12 : 1 }],
                        shadowColor: colors.amber,
                        shadowOpacity: selected ? 0.6 : 0,
                        shadowRadius: 10,
                        shadowOffset: { width: 0, height: 0 },
                        elevation: selected ? 6 : 0,
                        backgroundColor: colors.surface,
                      }}
                      className="active:opacity-80"
                    >
                      <Image
                        source={AVATAR_IMAGES[id]}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                      {!selected && (
                        <View
                          pointerEvents="none"
                          style={{
                            ...StyleSheet.absoluteFill,
                            backgroundColor: tint,
                            opacity: 0.06,
                          }}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* CTA */}
          <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
            <Pressable
              onPress={handleContinue}
              disabled={!canContinue || saving}
              style={{
                borderRadius: 16,
                paddingVertical: 20,
                alignItems: 'center',
                backgroundColor: canContinue ? colors.amber : colors.surface,
                shadowColor: colors.amber,
                shadowOpacity: canContinue ? 0.5 : 0,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 6 },
                elevation: canContinue ? 6 : 0,
              }}
              className="active:opacity-80"
            >
              <Text
                style={{
                  ...typography.title,
                  fontSize: 16,
                  color: canContinue ? colors.ink : colors.fog,
                }}
              >
                {saving ? 'Saving…' : "Let's Go"}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
