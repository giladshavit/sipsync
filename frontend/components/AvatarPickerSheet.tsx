import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowLeft } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { AVATAR_POOL, AVATAR_IMAGES, AVATAR_COLORS } from '@/constants/avatars';

// Exactly 4 per row, responsive to screen width — not an indirect "scale a
// 6-column baseline" guess, which didn't reliably land on 4.
const COLS = 4;
const GAP = 10;
const H_PADDING = 16;
// Square frame drawn around whichever avatar is currently selected.
const FRAME_PADDING = 6;
const FRAME_BORDER = 3;
// How long the square frame sits on the new pick before the sheet closes
// itself — long enough to register as confirmation, short enough not to feel
// like a stall.
const CONFIRM_DELAY_MS = 450;

interface AvatarPickerSheetProps {
  currentAvatar: string | null | undefined;
  /** Avatars already in use by other players in this room — not selectable. */
  takenAvatars: Set<string>;
  onSelect: (avatar: string) => void;
  onClose: () => void;
}

/** Rendered inline over the lobby, same reasoning as GamesSheet: reuses the
 * lobby's own WebSocket connection instead of opening a new one. */
export function AvatarPickerSheet({ currentAvatar, takenAvatars, onSelect, onClose }: AvatarPickerSheetProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const slotSize = (width - H_PADDING * 2 - GAP * (COLS - 1)) / COLS;
  const cellSize = slotSize - (FRAME_PADDING + FRAME_BORDER) * 2;

  // Optimistic: the frame jumps to the tap immediately rather than waiting
  // on the SET_AVATAR round trip, since the whole point is instant
  // confirmation before auto-closing.
  const [selectedPreview, setSelectedPreview] = useState<string | null | undefined>(currentAvatar);
  const displayedSelection = selectedPreview ?? currentAvatar;

  function handleSelect(avatar: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedPreview(avatar);
    onSelect(avatar);
    setTimeout(onClose, CONFIRM_DELAY_MS);
  }

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{
        position: 'absolute',
        top: 0, bottom: 0, left: 0, right: 0,
        backgroundColor: colors.cream,
      }}
    >
      <View style={{ flex: 1, paddingHorizontal: H_PADDING, paddingTop: insets.top + 16 }}>
        <Pressable
          onPress={onClose}
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

        <View className="mb-5">
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
            Pick your look
          </Text>
          <Text style={{ fontWeight: '200', color: colors.ink, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            Your
          </Text>
          <Text style={{ fontWeight: '900', color: colors.amber, fontSize: 34, lineHeight: 38, letterSpacing: -1.5 }}>
            avatar
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: GAP }}>
            {AVATAR_POOL.map((avatar) => {
              const isMine = avatar === displayedSelection;
              const isTaken = takenAvatars.has(avatar) && !isMine;
              return (
                <View
                  key={avatar}
                  style={{
                    width: slotSize,
                    height: slotSize,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: isMine ? FRAME_BORDER : 0,
                    borderColor: colors.ink,
                  }}
                >
                  <Pressable
                    disabled={isTaken}
                    onPress={() => handleSelect(avatar)}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: cellSize / 2,
                      borderWidth: 3,
                      borderColor: AVATAR_COLORS[avatar],
                      backgroundColor: colors.parchment,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isTaken ? 0.3 : 1,
                      overflow: 'hidden',
                    }}
                    className="active:opacity-70"
                  >
                    <Image
                      source={AVATAR_IMAGES[avatar]}
                      style={{ width: cellSize, height: cellSize }}
                      resizeMode="cover"
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}
