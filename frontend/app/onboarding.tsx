import { View, Text } from 'react-native';

// Full implementation in M1 Issue #12
export default function OnboardingScreen() {
  return (
    <View className="flex-1 justify-center px-6 bg-ink">
      <Text className="text-amber text-sm font-mono tracking-widest uppercase mb-3">
        Before we start
      </Text>
      <Text className="text-chalk text-4xl font-bold tracking-tightest leading-tight mb-2">
        What do your{'\n'}friends call you?
      </Text>
      <Text className="text-fog text-sm mt-1">
        No account needed.
      </Text>
    </View>
  );
}
