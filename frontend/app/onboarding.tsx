import { View, Text } from 'react-native';

// Onboarding — set display name + emoji avatar — implemented in M1 (Issue #12)
export default function OnboardingScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6">
      <Text className="text-white text-3xl font-bold mb-2">Welcome!</Text>
      <Text className="text-slate-400 text-base text-center">
        Pick a name so your friends know who&apos;s drinking.
      </Text>
    </View>
  );
}
