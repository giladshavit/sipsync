import { View, Text } from 'react-native';

// Full implementation in M5 Issue #25
export default function PodiumScreen() {
  return (
    <View className="flex-1 bg-ink px-6 pt-16">
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-2">
        Leaderboard
      </Text>
      <Text className="text-chalk text-5xl font-bold tracking-tightest">
        Podium
      </Text>
    </View>
  );
}
