import { View, Text } from 'react-native';

// PERSONAL_SUMMARY — 6-second drinking window — implemented in M5 (Issue #24)
export default function SummaryScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-2xl font-bold">Outcome</Text>
      <Text className="text-slate-400 mt-2">6-second window coming soon.</Text>
    </View>
  );
}
