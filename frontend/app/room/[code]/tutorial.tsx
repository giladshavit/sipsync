import { View, Text } from 'react-native';

// Full implementation in M4 Issue #22
export default function TutorialScreen() {
  return (
    <View className="flex-1 justify-center px-6 bg-ink">
      <Text className="text-amber text-sm font-mono tracking-widest uppercase mb-4">
        This round
      </Text>
      <Text className="text-chalk text-4xl font-bold tracking-tightest leading-tight">
        Red Light,{'\n'}Green Light
      </Text>
      <Text className="text-fog text-base mt-6 leading-relaxed">
        Screen turns green — tap fast.{'\n'}
        Slowest player drinks.
      </Text>
    </View>
  );
}
