import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldCheck, Wine } from 'lucide-react-native';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import * as SecureStore from '@/lib/secureStorage';
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

  // Age-gate consent: shown once, before the name/avatar form, on every
  // fresh install. `null` = still checking storage, `false` = show the
  // consent stage, `true` = already confirmed, proceed to the name form.
  const AGE_KEY = 'sipsync.age_confirmed'; // legacy prefix on purpose — see usePlayerIdentity
  const [ageConfirmed, setAgeConfirmed] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(AGE_KEY)
      .then((v) => setAgeConfirmed(v === '1'))
      .catch(() => setAgeConfirmed(false));
  }, []);

  async function handleConfirmAge() {
    try { await SecureStore.setItemAsync(AGE_KEY, '1'); } catch { /* still let them in — storage may be blocked */ }
    setAgeConfirmed(true);
  }

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
        {ageConfirmed === null ? (
          // Still reading storage — same backdrop, just a spinner, so there's
          // no flash between "loading" and whichever stage comes next.
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.amber} />
          </View>
        ) : ageConfirmed === false ? (
          // First launch: gate the name/avatar form behind a one-time 18+
          // consent. Friendly framing, not a legal wall — Apple wants honest
          // age declaration plus responsible-drinking language, not a EULA.
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
            <View
              style={{
                alignSelf: 'center',
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: colors.surface,
                borderWidth: 1.5,
                borderColor: colors.rim,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
              }}
            >
              <ShieldCheck size={28} color={colors.amber} strokeWidth={2} />
            </View>
            <Text style={{ ...typography.title, color: colors.amber, fontSize: 40, textAlign: 'center' }}>
              Quickle
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                marginTop: 8,
                marginBottom: 28,
              }}
            >
              <Wine size={12} color={colors.fog} strokeWidth={2} />
              <Text style={{ ...typography.label, color: colors.fog, fontSize: 12, textAlign: 'center' }}>
                A party game for adults
              </Text>
            </View>
            <Text style={{ color: colors.chalk, fontSize: 17, lineHeight: 26, textAlign: 'center' }}>
              Quickle is a social party game with drinking-game mechanics, intended for
              players of legal drinking age. It plays just as well with any beverage —
              alcoholic or not.
            </Text>
            <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 16 }}>
              If you drink, drink responsibly. Never drink and drive.
            </Text>
            <Pressable
              onPress={handleConfirmAge}
              style={{ marginTop: 32, backgroundColor: colors.amber, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}
              className="active:opacity-80"
            >
              <Text style={{ ...typography.label, color: colors.ink, fontSize: 15 }}>
                I'm 18 or older — let's play
              </Text>
            </Pressable>
          </View>
        ) : (
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
                            style={[StyleSheet.absoluteFill, { backgroundColor: tint, opacity: 0.06 }]}
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
        )}
      </SafeAreaView>
    </View>
  );
}
