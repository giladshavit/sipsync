// frontend/components/MockAdOverlay.tsx
import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { X } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors, typography } from '@/constants/design';

const LOBBY_AD_SECONDS = 5;

export default function MockAdOverlay({
  type,
  onClose,
}: {
  type: 'lobby' | 'podium';
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(type === 'lobby' ? LOBBY_AD_SECONDS : 0);

  useEffect(() => {
    if (type !== 'lobby' || secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [type, secondsLeft]);

  const canSkip = type === 'podium' || secondsLeft <= 0;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
      }}
    >
      {/* "AD" pill badge */}
      <View
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          backgroundColor: colors.amber,
          paddingHorizontal: 10,
          paddingVertical: 4,
        }}
      >
        <Text style={{ ...typography.label, fontSize: 10, letterSpacing: 2, color: colors.ink }}>
          Ad
        </Text>
      </View>

      {/* Podium: immediate close button. Lobby: no close button renders
          here at all until the countdown reaches zero (see the Skip Ad
          button below) — there is deliberately no early-exit affordance. */}
      {type === 'podium' && (
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(240,240,232,0.15)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="active:opacity-70"
        >
          <X size={18} color={colors.chalk} strokeWidth={2.5} />
        </Pressable>
      )}

      <Text
        style={{
          ...typography.title,
          fontSize: 32,
          color: colors.chalk,
          textAlign: 'center',
          marginBottom: 10,
          paddingHorizontal: 24,
        }}
      >
        Test Ad Placement
      </Text>
      <Text
        style={{
          color: colors.fog,
          fontSize: 13,
          textAlign: 'center',
          paddingHorizontal: 40,
        }}
      >
        Mock inventory — real ads plug in here later.
      </Text>

      {type === 'lobby' && (
        <View style={{ marginTop: 32, alignItems: 'center' }}>
          {canSkip ? (
            <Pressable
              onPress={onClose}
              style={{ backgroundColor: colors.amber, paddingVertical: 14, paddingHorizontal: 28 }}
              className="active:opacity-80"
            >
              <Text style={{ ...typography.label, fontSize: 13, color: colors.ink }}>
                Skip Ad
              </Text>
            </Pressable>
          ) : (
            <Text style={{ ...typography.label, fontSize: 13, letterSpacing: 2, color: colors.fog }}>
              Skip in {secondsLeft}s
            </Text>
          )}
        </View>
      )}
    </Animated.View>
  );
}
