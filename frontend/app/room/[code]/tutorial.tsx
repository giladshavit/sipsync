import { View, Text } from 'react-native';

// Tutorial — 5s timed text, auto-advances to game — implemented in M4 (Issue #22)
export default function TutorialScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-2xl font-bold mb-4">How to play</Text>
      <Text className="text-slate-300 text-base text-center">
        When the screen turns green — tap as fast as you can!
      </Text>
    </View>
  );
}
