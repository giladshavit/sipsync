import { View, Text, Pressable, ScrollView, Image, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowLeft } from 'lucide-react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming, interpolateColor } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { AVATAR_POOL, AVATAR_IMAGES, AVATAR_COLORS, lightenColor } from '@/constants/avatars';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Exactly 4 per row, responsive to screen width — not an indirect "scale a
// 6-column baseline" guess, which didn't reliably land on 4.
const COLS = 4;
const GAP = 10;
const H_PADDING = 16;
// Thin ring drawn around the avatar the sheet opened with — fixed for the
// sheet's lifetime, not a moving selection marker (see `isMine` below). Kept
// subtle (in the avatar's own color, not a heavy black square) since the
// press itself now carries the primary feedback via AvatarCell's lighten.
const FRAME_PADDING = 6;
const RING_BORDER = 2;
// How long a tap sits (as a plain pressed-opacity dim, plus the haptic)
// before the sheet closes itself — long enough to register as confirmation,
// short enough not to feel like a stall.
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
  const cellSize = slotSize - (FRAME_PADDING + RING_BORDER) * 2;

  function handleSelect(avatar: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
              // Reflects only the avatar you had when the sheet opened —
              // tapping a different one doesn't drag the ring along with
              // it; the tap itself gets its own lighten feedback (see
              // AvatarCell), and the sheet closes on its own right after.
              const isMine = avatar === currentAvatar;
              const isTaken = takenAvatars.has(avatar) && !isMine;
              return (
                <AvatarCell
                  key={avatar}
                  avatar={avatar}
                  isMine={isMine}
                  isTaken={isTaken}
                  slotSize={slotSize}
                  cellSize={cellSize}
                  onPress={() => handleSelect(avatar)}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

interface AvatarCellProps {
  avatar: string;
  isMine: boolean;
  isTaken: boolean;
  slotSize: number;
  cellSize: number;
  onPress: () => void;
}

// Button-press gesture: tapping an avatar lightens its own border and fill
// toward white, in place of a separate highlight color, and holds there
// (rather than springing back) since the sheet closes itself right after.
function AvatarCell({ avatar, isMine, isTaken, slotSize, cellSize, onPress }: AvatarCellProps) {
  const baseColor = AVATAR_COLORS[avatar];
  const litBorder = lightenColor(baseColor, 0.55);
  const litBackground = lightenColor(baseColor, 0.8);
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(pressed.value, [0, 1], [baseColor, litBorder]),
    backgroundColor: interpolateColor(pressed.value, [0, 1], [colors.parchment, litBackground]),
  }));

  function handlePress() {
    pressed.value = withTiming(1, { duration: 180 });
    onPress();
  }

  return (
    <View
      style={{
        width: slotSize,
        height: slotSize,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: isMine ? RING_BORDER : 0,
        borderColor: baseColor,
      }}
    >
      <AnimatedPressable
        disabled={isTaken}
        onPress={handlePress}
        style={[
          {
            width: cellSize,
            height: cellSize,
            borderRadius: cellSize / 2,
            borderWidth: 3,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isTaken ? 0.3 : 1,
            overflow: 'hidden',
          },
          animatedStyle,
        ]}
      >
        <Image
          source={AVATAR_IMAGES[avatar]}
          style={{ width: cellSize, height: cellSize }}
          resizeMode="cover"
        />
      </AnimatedPressable>
    </View>
  );
}
