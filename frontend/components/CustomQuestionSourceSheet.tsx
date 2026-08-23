import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, PenLine, Shuffle } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';
import { AvatarCircle } from '@/components/games/SharedChaserDistributor';
import type { Player } from '@/hooks/useRoomSocket';

interface CustomQuestionSourceSheetProps {
  players: Record<string, Player>;
  onUseBank: () => void;
  onPickWriter: (playerId: string) => void;
  onClose: () => void;
}

// How long a picked writer's card sits highlighted (haptic + fill) before the
// sheet hands off — same confirm-before-close idiom as AvatarPickerSheet.
const CONFIRM_DELAY_MS = 350;

// A "confession booth" wash — deep wine rather than black_box's slate-violet
// vault or the plain flat colors.ink every other in-room screen uses, so
// this one specific moment (someone's about to write a secret prompt) reads
// as its own occasion rather than a generic dark screen. Same
// gradient-wash + soft glow technique as PracticeRoleSheet, different mood.
const WINE = '#2A1420';
const WINE_DEEP = '#140A10';

// Game Bank reads cool/neutral (a system doing something automatic); Write
// Our Own gets the app's own amber — its one warm, "this is the special
// choice" signal, same accent every primary CTA elsewhere already uses.
const BANK_ACCENT = colors.electric;
const WRITE_ACCENT = colors.amber;

/**
 * Rendered inline over the in-room tutorial screen once the admin taps
 * "Start Game" on a Majority/Minority tutorial. Two stages: pick a source,
 * then (if writing their own) pick who holds the pen.
 */
export function CustomQuestionSourceSheet({
  players,
  onUseBank,
  onPickWriter,
  onClose,
}: CustomQuestionSourceSheetProps) {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<'choose' | 'pick-writer'>('choose');
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  // Late Join: someone still `waiting_for_next_game` is parked on
  // waiting.tsx for the rest of this round and has no way to reach the
  // writer's input screen — excluded here so the admin can't hand them the
  // pen and strand the room in CUSTOM_QUESTION_INPUT with no one able to
  // submit.
  const roster = Object.entries(players).filter(
    ([, p]) => p.connected !== false && !p.waiting_for_next_game,
  );

  function handlePickWriter(playerId: string) {
    if (confirmedId) return; // already confirming a pick
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmedId(playerId);
    setTimeout(() => onPickWriter(playerId), CONFIRM_DELAY_MS);
  }

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
    >
      <LinearGradient
        colors={[WINE, WINE_DEEP, colors.ink]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -180,
          left: '50%',
          width: 440,
          height: 440,
          marginLeft: -220,
          borderRadius: 220,
          backgroundColor: colors.amberGlow,
          opacity: 0.07,
        }}
      />

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
        <Pressable
          onPress={() => (stage === 'pick-writer' ? setStage('choose') : onClose())}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.rim,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.chalk} />
        </Pressable>

        {stage === 'choose' ? (
          <View>
            <View style={{ alignItems: 'center', gap: 8, marginBottom: 32 }}>
              <Text style={{ color: colors.amber, ...typography.label, fontSize: 11, letterSpacing: 4 }}>
                Custom question
              </Text>
              <Text
                style={{
                  color: colors.chalk,
                  fontSize: 24,
                  fontWeight: '800',
                  letterSpacing: -0.3,
                  textAlign: 'center',
                  lineHeight: 30,
                }}
              >
                Where do you want{'\n'}the question to come from?
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 14 }}>
              <SourceOptionCard
                Icon={Shuffle}
                accent={BANK_ACCENT}
                title="Game Bank"
                subtitle="Pull a random prompt from the deck"
                onPress={onUseBank}
              />
              <SourceOptionCard
                Icon={PenLine}
                accent={WRITE_ACCENT}
                title="Write Our Own"
                subtitle="Choose a player from the room to write it"
                onPress={() => setStage('pick-writer')}
              />
            </View>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={{ color: colors.amber, ...typography.label, fontSize: 11, letterSpacing: 4 }}>
                Custom question
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
                Who should write the question?
              </Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}
            >
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 22, maxWidth: 340 }}>
                  {roster.map(([pid, p]) => {
                    const isConfirmed = confirmedId === pid;
                    const isDimmed = confirmedId !== null && !isConfirmed;
                    return (
                      <Pressable
                        key={pid}
                        onPress={() => handlePickWriter(pid)}
                        disabled={confirmedId !== null}
                        style={{ width: 84, alignItems: 'center', opacity: isDimmed ? 0.3 : 1 }}
                        className="active:opacity-70"
                      >
                        <View
                          style={{
                            borderWidth: isConfirmed ? 3 : 0,
                            borderColor: colors.amber,
                            borderRadius: 40,
                            padding: isConfirmed ? 2 : 0,
                          }}
                        >
                          <AvatarCircle name={p.display_name} avatar={p.avatar} size={72} ringColor={colors.rim} />
                        </View>
                        <Text
                          numberOfLines={1}
                          style={{ color: colors.chalk, fontSize: 12, fontWeight: '700', marginTop: 8, textAlign: 'center', width: 84 }}
                        >
                          {p.display_name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {roster.length === 0 && (
                  <Text style={{ color: colors.fog, fontSize: 13, textAlign: 'center', marginTop: 24 }}>
                    No connected players to choose from.
                  </Text>
                )}
              </View>
            </ScrollView>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

function SourceOptionCard({
  Icon,
  accent,
  title,
  subtitle,
  onPress,
}: {
  Icon: typeof Shuffle;
  accent: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }} className="active:opacity-75">
      <View
        style={{
          borderWidth: 2,
          borderColor: accent,
          backgroundColor: 'rgba(255,255,255,0.04)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 22,
          paddingHorizontal: 14,
          gap: 12,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={26} color={colors.ink} strokeWidth={2.25} />
        </View>
        <Text style={{ color: colors.chalk, fontSize: 15, fontWeight: '800', textAlign: 'center' }}>
          {title}
        </Text>
        <Text style={{ color: colors.silver, fontSize: 12, fontWeight: '500', textAlign: 'center', lineHeight: 16 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
