import { View, Text, Pressable } from 'react-native';

// Home screen — Create Room / Join Room — implemented in M1 (Issue #14)
export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-slate-900 px-6 gap-4">
      <Text className="text-white text-4xl font-bold mb-8">SipSync 🥃</Text>
      <Pressable className="w-full bg-indigo-500 rounded-2xl py-4 items-center">
        <Text className="text-white text-lg font-semibold">Create Room</Text>
      </Pressable>
      <Pressable className="w-full border border-indigo-500 rounded-2xl py-4 items-center">
        <Text className="text-indigo-400 text-lg font-semibold">Join Room</Text>
      </Pressable>
    </View>
  );
}
