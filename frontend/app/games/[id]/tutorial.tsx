import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Head from '@/lib/head';
import { ArrowLeft, RotateCcw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { GAME_CATALOG, getGameById } from '@/constants/games';
import { getTutorialComponent } from '@/constants/tutorials';
import { TutorialStage } from '@/components/tutorials/TutorialStage';

// Static export: prerender a real HTML page per catalog game.
export function generateStaticParams(): { id: string }[] {
  return GAME_CATALOG.map((g) => ({ id: g.id }));
}

export default function TutorialPreviewScreen() {
  useWebPageBackground(colors.ink);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  // Short-window mode. Unlike the in-round host, this screen carries a
  // back/replay button row, which costs ~66px it can't otherwise give back —
  // enough that a laptop window shorter than this pushed the who-drinks chips
  // past the bottom of the stage even after TutorialStage had compressed and
  // scaled everything it owns. Phones never hit this: the shortest one we
  // support is 667px.
  const compact = useWindowDimensions().height < 700;
  const game = getGameById(id ?? '');
  const TutorialComponent = game ? getTutorialComponent(game.id) : null;
  // Tutorial components play their story once and freeze on the final
  // frame — remounting via a bumped key is the simplest way to replay it.
  const [replayKey, setReplayKey] = useState(0);
  // The stage scales itself to fit this; null until the ScrollView lays out.
  const [stageHeight, setStageHeight] = useState<number | null>(null);

  // Every game's own accent color doubles as this screen's signature —
  // a thin device-indicator underline and icon-button borders, so the same
  // shared chrome still reads as "this specific game" at a glance.
  const accent = game?.accentColor ?? colors.amber;
  const cue = game?.tutorialCue ?? game?.tagline;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {game && (
        <Head>
          <title>{`${game.title} Tutorial — Quickle`}</title>
          {/* The tutorial is an animated near-duplicate of the rules page —
              canonicalize it there. */}
          <link rel="canonical" href={`https://www.quicklegame.com/games/${game.id}`} />
        </Head>
      )}
      {/* Depth wash + this game's own accent bleeding faintly from the top —
          same layered-gradient-plus-glow technique PracticeRoleSheet uses to
          turn a flat colors.ink fill into something with actual atmosphere,
          rather than inventing a new background language for this screen. */}
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
          backgroundColor: accent,
          opacity: 0.08,
        }}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + (compact ? 8 : 16),
          // Extra clearance beyond the raw safe-area inset: the who-drinks
          // chip row is the last thing on this screen, sitting right above
          // the home indicator — the ScrollView's own bottom padding (below)
          // covers the last scrolled inch of content, but this is the fixed
          // gap between the ScrollView's box and the safe area that's always
          // there even when nothing needs to scroll.
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 24,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: compact ? 12 : 24 }}>
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

        {/* Split-weight header — the app's own eyebrow/title pairing (see
            typography.label vs typography.title in constants/design.ts)
            rather than the old bordered "How to play" badge. No subtitle
            here: the game's own instruction line already renders as
            CueText right above the mockup below, so a second copy up here
            was pure redundancy, not real information. Pinned to a fixed
            footprint with an explicit bottom buffer (flexShrink: 0 is RN's
            default for a non-flex child, set here for clarity) so it never
            gets squeezed or crowded by the content below it. */}
        <View style={{ flexShrink: 0, marginBottom: compact ? 12 : 24 }}>
          <Text style={{ color: colors.amber, ...typography.label, fontSize: 11, letterSpacing: 4, marginBottom: 4 }}>
            How to play
          </Text>
          <Text
            style={[
              typography.title,
              { color: colors.chalk, fontSize: compact ? 22 : 28, lineHeight: compact ? 24 : 30 },
            ]}
          >
            {game?.title ?? 'How to play'}
          </Text>
          <View style={{ width: 44, height: 3, backgroundColor: accent, marginTop: compact ? 6 : 10 }} />
        </View>

        {/* Cue line, the simulated phone screen, and the who-drinks chips —
            handed to TutorialStage, which scales the whole group down to
            whatever height this ScrollView actually got. The ScrollView stays
            as the last-resort fallback for the rare screen too short even at
            the stage's minimum scale; flexGrow + centered contentContainer
            keeps the group vertically centered whenever it does fit. */}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
          onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}
          showsVerticalScrollIndicator={false}
        >
          <TutorialStage cue={cue} rules={game?.drinkingRules} availableHeight={stageHeight}>
            {TutorialComponent ? (
              <TutorialComponent key={replayKey} />
            ) : (
              <Text style={{ color: colors.chalk, fontSize: 16, textAlign: 'center' }}>
                No tutorial preview available for this game yet.
              </Text>
            )}
          </TutorialStage>
        </ScrollView>
      </View>
    </View>
  );
}
