import { useLocalSearchParams } from 'expo-router';
import { View, Text } from 'react-native';

// Lobby — player list + Admin "Start Game" — implemented in M2 (Issue #16)
export default function LobbyScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-2xl font-bold mb-2">Room {code}</Text>
      <Text className="text-slate-400 text-base">Waiting for players…</Text>
    </View>
  );
}
