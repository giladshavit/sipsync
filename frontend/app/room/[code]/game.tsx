import { View, Text } from 'react-native';
import { ActiveGameScreen } from '@/components/ActiveGameScreen';

// Game screen — GAME_REGISTRY switcher — implemented in M4 (Issue #23)
export default function GameScreen() {
  return (
    <View className="flex-1 bg-slate-900">
      <ActiveGameScreen gameId={null} />
    </View>
  );
}
