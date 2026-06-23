import { useLocalSearchParams } from 'expo-router';
import { View, Text } from 'react-native';

// Full implementation in M2 Issue #16
export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <View className="flex-1 bg-ink px-6 pt-16">
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-1">
        Room code
      </Text>
      <Text className="text-amber text-5xl font-mono font-bold tracking-widest mb-8">
        {code}
      </Text>
      <Text className="text-fog text-sm">Waiting for players…</Text>
    </View>
  );
}
