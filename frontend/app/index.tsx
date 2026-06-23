import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';

// Full room-creation / join logic in M1 Issue #14
export default function HomeScreen() {
  const { isLoading, isOnboarded, displayName } = usePlayerIdentity();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-ink">
        <ActivityIndicator color="#F59E0B" />
      </View>
    );
  }

  if (!isOnboarded) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <View className="flex-1 justify-center px-6 bg-ink">
      <View className="mb-14">
        <Text className="text-amber text-sm font-mono tracking-widest uppercase mb-2">
          Real-time party game
        </Text>
        <Text className="text-chalk text-5xl font-bold tracking-tightest leading-none">
          SipSync
        </Text>
        {displayName && (
          <Text className="text-fog text-sm mt-3">
            Playing as {displayName}
          </Text>
        )}
      </View>

      <View className="gap-3">
        <Pressable className="bg-amber rounded-xl py-4 items-center active:opacity-80">
          <Text className="text-ink text-base font-bold tracking-wide">
            Create Room
          </Text>
        </Pressable>

        <Pressable className="border border-rim rounded-xl py-4 items-center active:opacity-60">
          <Text className="text-chalk text-base font-semibold">
            Join with code
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
