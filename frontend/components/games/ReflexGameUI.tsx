import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import type { MiniGameProps } from '../ActiveGameScreen';

// Full Epoch Scheduling + tap logic — implemented in M4 (Issue #23)
export const ReflexGameUI: React.FC<MiniGameProps> = ({ onAction }) => {
  const bgOpacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: bgOpacity.value,
  }));

  function handleTap() {
    onAction('tap', { local_ts: Date.now() });
    bgOpacity.value = withTiming(1, { duration: 100 });
  }

  return (
    <Pressable className="flex-1" onPress={handleTap}>
      <View className="flex-1 items-center justify-center bg-red-900">
        <Animated.View
          className="absolute inset-0 bg-green-500"
          style={animatedStyle}
        />
        <Text className="text-white text-2xl font-bold z-10">
          Wait for GREEN…
        </Text>
      </View>
    </Pressable>
  );
};
