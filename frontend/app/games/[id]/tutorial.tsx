import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, RotateCcw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { getGameById } from '@/constants/games';
import { getTutorialComponent } from '@/constants/tutorials';
import { CueText, DrinkRow } from '@/components/tutorials/TutorialCue';

export default function TutorialPreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const game = getGameById(id ?? '');
  const TutorialComponent = game ? getTutorialComponent(game.id) : null;
  // Tutorial components play their story once and freeze on the final
  // frame — remounting via a bumped key is the simplest way to replay it.
  const [replayKey, setReplayKey] = useState(0);

  // Every game's own accent color doubles as this screen's signature —
  // a thin device-indicator underline and icon-button borders, so the same
  // shared chrome still reads as "this specific game" at a glance.
  const accent = game?.accentColor ?? colors.amber;
  const cue = game?.tutorialCue ?? game?.tagline;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.ink,
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        paddingHorizontal: 24,
      }}
    >
      <View className="flex-row items-center justify-between mb-5">
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.chalk} />
        </Pressable>

        <View
          style={{
            borderWidth: 2,
            borderColor: accent,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={{ color: accent, fontSize: 11, ...typography.label }}>How to play</Text>
        </View>

        <Pressable
          onPress={() => setReplayKey((k) => k + 1)}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-60"
        >
          <RotateCcw size={18} color={colors.chalk} />
        </Pressable>
      </View>

      {/* Title — the game's real name, no rewording, with an accent-colored
          underline instead of a soft glow: reads like a device status
          light for this specific game rather than generic ambience. */}
      <Text style={[typography.title, { color: colors.chalk, fontSize: 26, lineHeight: 28 }]}>
        {game?.title ?? 'How to play'}
      </Text>
      <View style={{ width: 44, height: 3, backgroundColor: accent, marginTop: 8 }} />

      {/* Cue line, the simulated phone screen, and the who-drinks chips —
          grouped and centered together in whatever space is left, so the
          chips sit right under the mockup instead of stranded at the
          screen's bottom edge, and the whole screen fits without scrolling. */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        {cue && (
          <View style={{ maxWidth: 300 }}>
            <CueText line={cue} />
          </View>
        )}
        {TutorialComponent ? (
          <TutorialComponent key={replayKey} />
        ) : (
          <Text style={{ color: colors.chalk, fontSize: 16, textAlign: 'center' }}>
            No tutorial preview available for this game yet.
          </Text>
        )}
        {/* Who drinks — condensed to one row of one-or-two-word chips,
            chaser-glass icon only, never a wine glass or other drink glyph.
            Extra marginTop on top of the group's own gap — this one edge
            wants more breathing room than the cue-to-mockup gap does. */}
        {game && (
          <View style={{ marginTop: 20 }}>
            <DrinkRow rules={game.drinkingRules} />
          </View>
        )}
      </View>
    </View>
  );
}
