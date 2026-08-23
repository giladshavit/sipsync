import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Eye, Scale, Users, type LucideIcon } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

export type PracticeRole = 'player_1' | 'player_2' | 'spectator';

// Same brushed-steel vault wash BlackBoxGameUI's own backdrop uses — this
// screen is the doorway into that game, so it previews the room instead of
// staying on the rules screen's light paper background.
const VAULT = '#1E2530';
const VAULT_DEEP = '#12161D';
const VAULT_VIOLET = '#241F35';
const SLATE = '#475569';
const SLATE_GLOW = '#94A3B8';

interface RoleOption {
  role: PracticeRole;
  label: string;
  accent: string;
  Icon: LucideIcon;
}

// Player 1 = blue, Player 2 = orange — the same identity pair black_box's
// rules screen and live round use, so picking here already previews which
// color to watch for once the round starts. Spectator gets the game's own
// slate accent rather than a third arbitrary hue — it's the absence of a
// seat, not a third team. Icons match the RoleIcon each DuelAvatar wears in
// the live game (Eye/Scale), so the picker and the round speak one visual
// language.
const ROLE_OPTIONS: RoleOption[] = [
  { role: 'player_1', label: 'Player 1', accent: colors.tapped, Icon: Eye },
  { role: 'player_2', label: 'Player 2', accent: colors.orange, Icon: Scale },
  { role: 'spectator', label: 'Spectator', accent: SLATE, Icon: Users },
];

interface PracticeRoleSheetProps {
  onSelect: (role: PracticeRole) => void;
  onClose: () => void;
  loadingRole: PracticeRole | null;
}

/** A seat option, styled as a plain menu row (filled circular icon badge +
 * label in a pill) — deliberately NOT the round's own card chrome (no
 * diamond seal, no portrait rectangle), so picking a seat here never reads
 * as "one of the black-box cards" once the live round's actual sealed
 * grid appears a moment later. */
function RoleRow({
  label,
  accent,
  Icon,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  accent: string;
  Icon: LucideIcon;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: accent,
            backgroundColor: VAULT,
            opacity: disabled && !loading ? 0.35 : 1,
            transform: pressed && !disabled ? [{ scale: 0.97 }] : [{ scale: 1 }],
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {loading ? <ActivityIndicator size="small" color={VAULT_DEEP} /> : <Icon size={20} color={VAULT_DEEP} strokeWidth={2.5} />}
          </View>
          <Text style={{ ...typography.label, color: colors.chalk, fontSize: 14, flex: 1 }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Rendered inline over the rules screen (not a separate route) — same
 * reasoning as GamesSheet/AvatarPickerSheet. black_box picks its 2-player
 * duel at random each round; against bots that means a real person could
 * easily never land in it, so practice mode asks up front instead. */
export function PracticeRoleSheet({ onSelect, onClose, loadingRole }: PracticeRoleSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
    >
      <LinearGradient
        colors={[VAULT_VIOLET, VAULT_DEEP, colors.ink]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -200,
          left: '50%',
          width: 480,
          height: 480,
          marginLeft: -240,
          borderRadius: 240,
          backgroundColor: SLATE_GLOW,
          opacity: 0.06,
        }}
      />

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 24 }}>
        <Pressable
          onPress={onClose}
          disabled={!!loadingRole}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: SLATE,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {({ pressed }) => (
            <ArrowLeft size={20} color={colors.chalk} style={{ opacity: pressed ? 0.6 : 1 }} />
          )}
        </Pressable>

        {/* Biased toward the upper half rather than dead-center — a full
            center placement pushed the options close enough to the bottom
            edge to feel cramped once a thumb (or the loading spinner) was
            in play. */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: '14%', gap: 34 }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={{ ...typography.label, color: SLATE_GLOW, fontSize: 11, letterSpacing: 4 }}>
              PRACTICE VS BOTS
            </Text>
            <Text
              style={{
                color: colors.chalk,
                fontSize: 24,
                fontWeight: '800',
                letterSpacing: -0.3,
                textAlign: 'center',
              }}
            >
              Who are you this round?
            </Text>
          </View>

          <View style={{ width: '100%', maxWidth: 320, gap: 12 }}>
            {ROLE_OPTIONS.map(({ role, label, accent, Icon }) => (
              <RoleRow
                key={role}
                label={label}
                accent={accent}
                Icon={Icon}
                loading={loadingRole === role}
                disabled={!!loadingRole}
                onPress={() => !loadingRole && onSelect(role)}
              />
            ))}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}
