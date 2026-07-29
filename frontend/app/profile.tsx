import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { colors, typography } from '@/constants/design';
import { AVATAR_IMAGES, AVATAR_COLORS } from '@/constants/avatars';
import { AvatarPickerSheet } from '@/components/AvatarPickerSheet';

const H_PADDING = 24;
const HERO_SIZE = 116;

// The large preview up top — a button, not just a display: empty state
// invites the tap with a dashed ring + prompt copy, filled state pops on
// every change so picking a new avatar reads as a confirmed choice, and
// carries the same small edit-pencil affordance as the lobby's own avatar.
function AvatarHero({ avatar, onPress }: { avatar: string | null; onPress: () => void }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!avatar) return;
    scale.value = withSequence(
      withTiming(1.08, { duration: 180, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 160 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tint = avatar ? AVATAR_COLORS[avatar] : colors.dune;

  return (
    <View style={{ alignItems: 'center', marginBottom: 28 }}>
      <Pressable onPress={onPress} className="active:opacity-80">
        <View style={{ width: HERO_SIZE, height: HERO_SIZE }}>
          <Animated.View
            style={[
              {
                width: HERO_SIZE,
                height: HERO_SIZE,
                borderRadius: HERO_SIZE / 2,
                borderWidth: avatar ? 4 : 2.5,
                borderStyle: avatar ? 'solid' : 'dashed',
                borderColor: tint,
                backgroundColor: colors.parchment,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                shadowColor: tint,
                shadowOpacity: avatar ? 0.45 : 0,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: avatar ? 8 : 0,
              },
              style,
            ]}
          >
            {avatar ? (
              <Image source={AVATAR_IMAGES[avatar]} style={{ width: HERO_SIZE, height: HERO_SIZE }} resizeMode="cover" />
            ) : (
              <View style={{ alignItems: 'center', gap: 6, paddingHorizontal: 14 }}>
                <Sparkles size={22} color={colors.dune} strokeWidth={2} />
                <Text style={{ color: colors.dune, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>
                  Press to{'\n'}pick one
                </Text>
              </View>
            )}
          </Animated.View>
          {avatar && (
            <View
              style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: colors.amber,
                borderWidth: 2,
                borderColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pencil size={14} color={colors.ink} strokeWidth={2.5} />
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { isLoading, displayName, vibe, preferredAvatar, setIdentity, setPreferredAvatar } = usePlayerIdentity();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  useEffect(() => {
    setName(displayName ?? '');
  }, [displayName]);

  const canSave = name.trim().length >= 2;
  const dirty = name.trim() !== (displayName ?? '');

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    await setIdentity(name.trim(), vibe);
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
          paddingHorizontal: H_PADDING,
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

        <View className="mb-8">
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
            marginBottom: 32,
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
            marginBottom: 14,
            textAlign: 'center',
          }}
        >
          Preferred avatar
        </Text>

        <AvatarHero avatar={preferredAvatar} onPress={() => setAvatarPickerOpen(true)} />

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

      {/* Cute full-screen avatar picker — same component the in-room lobby
          uses, reused as-is: this is a personal preference, not a room
          seat, so it's opened with an empty "taken" set (nothing here is
          ever off-limits). */}
      {avatarPickerOpen && (
        <AvatarPickerSheet
          currentAvatar={preferredAvatar}
          takenAvatars={new Set()}
          onSelect={(avatar) => setPreferredAvatar(avatar)}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </View>
  );
}
