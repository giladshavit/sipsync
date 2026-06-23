import { Share } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { View, Text, Pressable } from 'react-native';

export default function LobbyScreen() {
  const { code, isAdmin, shareUrl } = useLocalSearchParams<{
    code: string;
    isAdmin?: string;
    shareUrl?: string;
  }>();

  const adminMode = isAdmin === 'true';
  const decodedShareUrl = shareUrl ? decodeURIComponent(shareUrl) : null;

  async function handleShare() {
    if (!decodedShareUrl) return;
    await Share.share({ message: `Join my SipSync room! ${decodedShareUrl}` });
  }

  return (
    <View className="flex-1 bg-ink px-6 pt-16">
      <Text className="text-fog text-xs font-mono tracking-widest uppercase mb-1">
        Room code
      </Text>
      <Text className="text-amber text-5xl font-mono font-bold tracking-widest mb-8">
        {code}
      </Text>

      {adminMode && decodedShareUrl && (
        <Pressable
          onPress={handleShare}
          className="border border-amber rounded-xl py-3 items-center mb-6 active:opacity-70"
        >
          <Text className="text-amber font-semibold text-base">Share Invite</Text>
        </Pressable>
      )}

      <Text className="text-fog text-sm">Waiting for players…</Text>
    </View>
  );
}
