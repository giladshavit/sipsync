import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, PenLine } from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { useRoomSocket } from '@/hooks/useRoomSocket';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';
import { colors, typography } from '@/constants/design';
import { AvatarCircle } from '@/components/games/SharedChaserDistributor';

const QUESTION_MAX_LEN = 100;
const OPTION_MAX_LEN = 24;

// Same "confession booth" wash as CustomQuestionSourceSheet — this screen is
// the very next beat of that same moment, so the background carries over
// rather than cutting back to the flat colors.ink every other in-room
// screen uses.
const WINE = '#2A1420';
const WINE_DEEP = '#140A10';

// Exactly MajorityGameUI's own OPTION_COLORS (blue A / violet B) — whatever
// the writer types into the blue box here is what every voter sees rendered
// in that same blue a moment later, so the color already means something by
// the time the round starts instead of being invented fresh for this screen.
const OPTION_COLORS: [string, string] = [colors.tapped, '#7C3AED'];

/**
 * Handles RoomState.CUSTOM_QUESTION_INPUT: the writer (picked from
 * CustomQuestionSourceSheet) fills in a prompt + two answers, centered as
 * the screen's one hero moment; every other client waits here instead,
 * watching for that player's own avatar (mirrors waiting.tsx's pulsing-icon
 * "watch and wait" idiom).
 */
export default function CustomQuestionScreen() {
  useWebPageBackground(`linear-gradient(180deg, ${WINE} 0%, ${WINE_DEEP} 50%, ${colors.ink} 100%)`);
  const { code, writerId: paramWriterId } = useLocalSearchParams<{ code: string; writerId: string }>();
  const { playerId } = usePlayerIdentity();
  const { snapshot, send, dissolved } = useRoomSocket(code);
  const insets = useSafeAreaInsets();
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [question, setQuestion] = useState('');
  const [optionA, setOptionA] = useState('');
  const [optionB, setOptionB] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const writerId = snapshot?.writerId ?? paramWriterId ?? null;
  const isWriter = !!playerId && playerId === writerId;
  const writer = writerId ? snapshot?.players[writerId] : undefined;

  useEffect(() => {
    if (dissolved) router.replace('/');
  }, [dissolved]);

  useEffect(() => {
    if (snapshot?.state === 'PLAYING') {
      router.replace({ pathname: '/room/[code]/game', params: { code } });
    }
  }, [snapshot?.state, code]);

  const canSubmit = question.trim().length > 0 && optionA.trim().length > 0 && optionB.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit || submitted) return;
    setSubmitted(true);
    send({
      type: 'SUBMIT_CUSTOM_QUESTION',
      question_data: {
        question: question.trim(),
        option_a: optionA.trim(),
        option_b: optionB.trim(),
      },
    });
  }

  function handleLeave() {
    send({ type: 'LEAVE_ROOM' });
    router.replace('/');
  }

  // Gentle breathing scale — same ambient idiom as waiting.tsx's hourglass.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={[WINE, WINE_DEEP, colors.ink]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFillObject}
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

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: 24 }}>
        <Pressable
          onPress={() => setConfirmingLeave(true)}
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

        {isWriter ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          >
            <Animated.View entering={FadeInDown.duration(300)} style={{ alignItems: 'center', marginBottom: 32 }}>
              <Text style={{ color: colors.amber, ...typography.label, fontSize: 11, letterSpacing: 4, marginBottom: 6 }}>
                Your turn
              </Text>
              <Text
                style={{ color: colors.chalk, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' }}
              >
                Write the question
              </Text>
            </Animated.View>

            {/* The question itself — a plainly bordered field, same
                affordance language as the two options below it, just bigger
                and set apart since it's the screen's one hero moment. A
                borderless input read as decorative text rather than
                something to tap and fill in. */}
            <Animated.View entering={FadeInDown.delay(60).duration(300)} style={{ marginBottom: 24 }}>
              <Text
                style={{
                  ...typography.label,
                  color: colors.fog,
                  fontSize: 10,
                  letterSpacing: 1.5,
                  marginBottom: 8,
                  textAlign: 'center',
                }}
              >
                The question
              </Text>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Sea or pool?"
                placeholderTextColor={colors.fog}
                maxLength={QUESTION_MAX_LEN}
                multiline
                textAlign="center"
                style={{
                  color: colors.chalk,
                  fontSize: 19,
                  fontWeight: '700',
                  lineHeight: 25,
                  borderWidth: 2,
                  borderColor: colors.amber,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  paddingVertical: 18,
                  paddingHorizontal: 16,
                  minHeight: 88,
                }}
              />
            </Animated.View>

            {/* The two options — side by side, not stacked, so they read as
                a single either/or choice rather than a form's list of rows. */}
            <Animated.View entering={FadeInDown.delay(120).duration(300)} style={{ flexDirection: 'row', gap: 14 }}>
              <OptionField
                letter="A"
                accent={OPTION_COLORS[0]}
                value={optionA}
                onChangeText={setOptionA}
                placeholder="Sea"
              />
              <OptionField
                letter="B"
                accent={OPTION_COLORS[1]}
                value={optionB}
                onChangeText={setOptionB}
                placeholder="Pool"
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(180).duration(300)} style={{ marginTop: 32 }}>
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit || submitted}
                className="bg-amber py-5 items-center rounded-none active:opacity-80 disabled:opacity-40"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  {submitted ? 'Starting…' : 'Start Game'}
                </Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <Animated.View entering={FadeInDown.duration(400)} style={pulseStyle}>
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 48,
                  borderWidth: 3,
                  borderColor: colors.amber,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {writer ? (
                  <AvatarCircle name={writer.display_name} avatar={writer.avatar} size={90} ringColor={colors.rim} />
                ) : (
                  <PenLine size={36} color={colors.amber} strokeWidth={2} />
                )}
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ alignItems: 'center' }}>
              <Text
                style={{
                  color: colors.amber,
                  ...typography.label,
                  fontSize: 11,
                  letterSpacing: 4,
                  textAlign: 'center',
                  marginBottom: 8,
                }}
              >
                Custom question
              </Text>
              <Text
                style={{ color: colors.chalk, fontSize: 20, lineHeight: 27, textAlign: 'center', fontWeight: '600', maxWidth: 280 }}
              >
                Waiting for{' '}
                <Text style={{ fontWeight: '900', color: colors.amber }}>
                  {writer?.display_name ?? 'them'}
                </Text>{' '}
                to craft a spicy question…
              </Text>
            </Animated.View>
          </View>
        )}
      </View>

      {confirmingLeave && (
        <Animated.View
          entering={FadeIn.duration(150)}
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <View
            style={{
              alignSelf: 'stretch',
              backgroundColor: colors.surface,
              borderWidth: 2,
              borderColor: colors.rim,
              padding: 24,
            }}
          >
            <Text style={{ fontWeight: '900', color: colors.chalk, fontSize: 24, letterSpacing: -0.5, marginBottom: 8 }}>
              Leave the room?
            </Text>
            <Text style={{ color: colors.fog, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>
              You can rejoin anytime with the code.
            </Text>
            <View style={{ gap: 10 }}>
              <Pressable
                onPress={() => setConfirmingLeave(false)}
                className="bg-amber py-4 items-center rounded-none active:opacity-80"
              >
                <Text className="text-ink text-sm font-bold tracking-[0.18em] uppercase">
                  Stay
                </Text>
              </Pressable>
              <Pressable
                onPress={handleLeave}
                style={{ borderWidth: 2, borderColor: colors.stop }}
                className="py-4 items-center rounded-none active:opacity-60"
              >
                <Text style={{ color: colors.stop }} className="text-sm font-bold tracking-[0.18em] uppercase">
                  Leave room
                </Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      )}
    </KeyboardAvoidingView>
  );
}

function OptionField({
  letter,
  accent,
  value,
  onChangeText,
  placeholder,
}: {
  letter: 'A' | 'B';
  accent: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, justifyContent: 'center' }}>
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '900' }}>{letter}</Text>
        </View>
        <Text style={{ ...typography.label, color: colors.fog, fontSize: 10, letterSpacing: 1.5 }}>
          Option {letter}
        </Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.fog}
        maxLength={OPTION_MAX_LEN}
        textAlign="center"
        style={{
          color: colors.chalk,
          fontSize: 16,
          fontWeight: '700',
          borderWidth: 2,
          borderColor: accent,
          backgroundColor: 'rgba(255,255,255,0.03)',
          paddingVertical: 14,
          paddingHorizontal: 10,
        }}
      />
    </View>
  );
}
