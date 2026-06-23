import { View, Text } from 'react-native';

// Podium — animated leaderboard — implemented in M5 (Issue #25)
export default function PodiumScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-2xl font-bold">🏆 Podium</Text>
      <Text className="text-slate-400 mt-2">Rankings coming soon.</Text>
    </View>
  );
}
