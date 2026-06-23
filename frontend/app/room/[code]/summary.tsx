import { View, Text } from 'react-native';

// Full implementation in M5 Issue #24 (6-second drinking window, Reanimated lock)
export default function SummaryScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-stop px-6">
      <Text className="text-white text-8xl font-bold tracking-tightest leading-none mb-2">
        DRINK
      </Text>
      <Text className="text-white/60 text-xl">2 chasers · −50 pts</Text>
      <Text className="text-white/40 text-sm mt-4">Total: 150 pts</Text>
    </View>
  );
}
