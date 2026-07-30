import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { colors, typography } from '@/constants/design';
import { TUTORIAL_COMPONENTS } from '@/constants/tutorials';
import { getGameById } from '@/constants/games';
import { CueText, DrinkRow } from '@/components/tutorials/TutorialCue';
import { CustomQuestionSourceSheet } from '@/components/CustomQuestionSourceSheet';

// Majority/Minority Rules only: instead of auto-advancing like every other
// game's tutorial, the admin gets a manual "Start Game" button once the
// mandatory viewing window ends, which opens the Game Bank / Write Our Own
// choice — see CustomQuestionSourceSheet.
const CUSTOM_QUESTION_ASSETS = ['tutorial.majority', 'tutorial.minority'];

// Sacrifice's two-phone story needs the longest hold of any default-length
// tutorial (~5.1s of story + a beat to land on "room safe"); every other
// default-length tutorial finishes well within this and just holds its
// final frame the extra second.
const DEFAULT_DURATION_MS = 6_000;

// Per-tutorial overrides for stories that need more room than the default
// window — Dilemma's two-phone, two-scenario-beat story runs long enough
// that it would get cut off mid-reveal on the last scenario otherwise.
const DURATION_MS_OVERRIDES: Record<string, number> = {
  'tutorial.auction': 7_500,
  'tutorial.dilemma': 8_000,
  'tutorial.majority': 7_000,
  'tutorial.minority': 7_000,
  // Runs its own real 10s countdown to an actual reveal (not just a
  // freeze-frame mid-story) — needs the full 10s plus a beat to see it.
  'tutorial.flying_bomb': 10_800,
  // Six-beat round-trip story (three other players' turns, the viewer's
  // own tap, one more turn, then the bust), each beat 2s apart to actually
  // read, runs ~9.4s before the loss banner even starts its own reveal.
  'tutorial.twenty_one': 11_000,
  // Full round replay across two phones — pick, the Holder's 2s private
  // peek, LEAVE IT press, synced dim-and-flip reveal, skull plaque at
  // ~8.7s — plus a beat to actually read the verdict.
  'tutorial.black_box': 11_500,
};

export default function TutorialScreen() {
  const { code, tutorialType: _tutorialType, tutorialAsset } = useLocalSearchParams<{
    code: string;
    tutorialType: string;
    tutorialAsset: string;
  }>();

  const { playerId } = usePlayerIdentity();
  const { snapshot, send } = useRoomSocket(code);
  const insets = useSafeAreaInsets();
  const isAdmin = !!snapshot && snapshot.admin_id === playerId;
  const isCustomQuestionGame = !!tutorialAsset && CUSTOM_QUESTION_ASSETS.includes(tutorialAsset);
  // Custom Question games hold here once the mandatory viewing window ends
  // instead of auto-sending TUTORIAL_DONE — the admin picks a source first
  // (see handleUseBank/handlePickWriter below).
  const [countdownDone, setCountdownDone] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);

  const durationMs = tutorialAsset ? (DURATION_MS_OVERRIDES[tutorialAsset] ?? DEFAULT_DURATION_MS) : DEFAULT_DURATION_MS;

  // Stable ref so the setTimeout closure always calls the latest send
  const sendRef = useRef(send);
  sendRef.current = send;

  // Animated countdown bar: 1 → 0 over durationMs on the native UI thread
  const progress = useSharedValue(1);
  const barStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%` as `${number}%`,
  }));

  // Start countdown on mount — no skip possible
  useEffect(() => {
    progress.value = withTiming(0, { duration: durationMs, easing: Easing.linear });

    const timer = setTimeout(() => {
      if (isCustomQuestionGame) {
        setCountdownDone(true);
      } else {
        // Everyone sends; server silently ignores non-admin senders
        sendRef.current({ type: 'TUTORIAL_DONE' });
      }
    }, durationMs);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, isCustomQuestionGame]);

  // Navigate when the server confirms PLAYING, or hand off to the writer's
  // input screen (or every other client's waiting view for them) once the
  // admin picked "Write Our Own".
  useEffect(() => {
    if (snapshot?.state === 'PLAYING') {
      router.replace({ pathname: '/room/[code]/game', params: { code } });
    } else if (snapshot?.state === 'CUSTOM_QUESTION_INPUT') {
      router.replace({
        pathname: '/room/[code]/custom-question',
        params: { code, writerId: snapshot.writerId ?? '' },
      });
    }
  }, [snapshot?.state, snapshot?.writerId, code]);

  function handleUseBank() {
    setChooserOpen(false);
    send({ type: 'TUTORIAL_DONE' });
  }

  function handlePickWriter(writerId: string) {
    setChooserOpen(false);
    send({ type: 'START_CUSTOM_QUESTION', writer_id: writerId });
  }

  const TutorialComponent = tutorialAsset ? (TUTORIAL_COMPONENTS[tutorialAsset] ?? null) : null;
  // tutorialAsset is always `tutorial.<game_id>` (see constants/tutorials.ts)
  const game = getGameById(tutorialAsset?.replace(/^tutorial\./, '') ?? '');
  const accent = game?.accentColor ?? colors.amber;
  const cue = game?.tutorialCue ?? game?.tagline;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      {/* Same layered depth wash as the standalone preview (see
          games/[id]/tutorial.tsx) — a subtle vertical gradient plus this
          game's own accent bleeding faintly from the top, instead of a flat
          fill. */}
      <LinearGradient
        colors={[colors.surface, colors.ink]}
        locations={[0, 0.65]}
        style={StyleSheet.absoluteFillObject}
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
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 24,
        }}
      >
        {/* Same "how to play" chrome as the standalone preview reached from
            the rules screen — minus the back/replay buttons, since this
            screen can't be left early or replayed: it runs once for a fixed
            duration and then the round starts. No subtitle here: the game's
            own instruction line already renders as CueText right above the
            mockup below, so a second copy up here was pure redundancy, not
            real information. Pinned to a fixed footprint with an explicit
            bottom buffer (flexShrink: 0 is RN's default for a non-flex
            child, set here for clarity) so it never gets squeezed or
            crowded by the mockup below it. */}
        <View style={{ flexShrink: 0, marginBottom: 20 }}>
          <Text
            style={{
              color: colors.amber,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 4,
              textAlign: 'center',
              marginBottom: 4,
            }}
          >
            How to play
          </Text>

          {game && (
            <>
              <Text style={[typography.title, { color: colors.chalk, fontSize: 24, lineHeight: 26, textAlign: 'center' }]}>
                {game.title}
              </Text>
              <View style={{ width: 40, height: 3, backgroundColor: accent, marginTop: 10, alignSelf: 'center' }} />
            </>
          )}
        </View>

        {/* Cue line, the simulated phone screen, and the who-drinks chips —
            scrollable rather than forced into a fixed centered box: on
            shorter screens the mockup's own fixed height plus the cue line
            and drink chips can add up to more than the space left under the
            header (and, here, above the countdown bar / Start Game button),
            and a rigid flex:1 + overflow:hidden box was clipping the cue
            text and chip labels instead of just gracefully yielding scroll.
            flexGrow + centered contentContainerStyle keeps content
            vertically centered exactly like before whenever it *does* fit,
            and only turns into a scroll on the screens where it doesn't. */}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 16, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ alignItems: 'center', gap: 22 }}>
            {cue && (
              <View style={{ maxWidth: 300 }}>
                <CueText line={cue} />
              </View>
            )}
            {TutorialComponent ? (
              <TutorialComponent />
            ) : (
              <Text className="text-chalk text-2xl font-bold leading-snug text-center">
                Get ready for the next round!
              </Text>
            )}
            {game && (
              <View style={{ marginTop: 14 }}>
                <DrinkRow rules={game.drinkingRules} />
              </View>
            )}
          </View>
        </ScrollView>

        {!countdownDone ? (
          <>
            {/* Countdown bar — mandatory, no skip */}
            <View
              style={{
                height: 6,
                backgroundColor: colors.surface,
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={[
                  {
                    height: '100%',
                    backgroundColor: colors.amber,
                    borderRadius: 3,
                    shadowColor: colors.amberGlow,
                    shadowOpacity: 0.8,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 0 },
                  },
                  barStyle,
                ]}
              />
            </View>

            <Text
              style={{
                color: colors.fog,
                fontSize: 11,
                letterSpacing: 1,
                textAlign: 'center',
                marginTop: 12,
              }}
            >
              Starting in {durationMs / 1000} seconds…
            </Text>
          </>
        ) : isAdmin ? (
          <Pressable
            onPress={() => setChooserOpen(true)}
            style={{
              backgroundColor: colors.amber,
              borderWidth: 2,
              borderColor: colors.amberGlow,
              paddingVertical: 18,
              alignItems: 'center',
              shadowColor: colors.amber,
              shadowOpacity: 0.45,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 10,
            }}
            className="active:opacity-80"
          >
            <Text style={{ color: colors.ink, fontWeight: '900', fontSize: 14, letterSpacing: 2 }} className="uppercase">
              Start Game
            </Text>
          </Pressable>
        ) : (
          <Text
            style={{
              color: colors.fog,
              ...typography.label,
              fontSize: 11,
              letterSpacing: 3,
              textAlign: 'center',
              paddingVertical: 12,
            }}
          >
            Waiting for host to start
          </Text>
        )}
      </View>

      {chooserOpen && (
        <CustomQuestionSourceSheet
          players={snapshot?.players ?? {}}
          onUseBank={handleUseBank}
          onPickWriter={handlePickWriter}
          onClose={() => setChooserOpen(false)}
        />
      )}
    </View>
  );
}
