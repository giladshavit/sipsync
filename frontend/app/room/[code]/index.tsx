import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router, Redirect } from 'expo-router';
import { usePlayerIdentity } from '@/hooks/usePlayerIdentity';
import { API_BASE } from '@/constants/api';
import { colors, typography } from '@/constants/design';

// Deep-link landing pad for `/room/[code]` — shared links point to
// `https://quicklegame.com/room/[code]`, which resolves here in the browser
// (and, once associated domains are configured, inside the app too). There's
// no screen at this bare route; the real room UI lives under
// `/room/[code]/lobby`. This route's only job is the intent hand-off: send
// an unonboarded visitor to onboarding with the code preserved, or forward
// an onboarded one straight into the room, so an invite link works before
// the recipient has ever opened the app.
export default function RoomDeepLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { isLoading, isOnboarded } = usePlayerIdentity();
  const [notFound, setNotFound] = useState(false);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (isLoading || !isOnboarded || !code || checkedRef.current) return;
    checkedRef.current = true;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/rooms/${code}`);
        const data: { exists: boolean } = res.ok ? await res.json() : { exists: false };
        if (!data.exists) {
          setNotFound(true);
          return;
        }
        router.replace(`/room/${code}/lobby`);
      } catch {
        setNotFound(true);
      }
    })();
  }, [isLoading, isOnboarded, code]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.amber} />
      </View>
    );
  }

  if (!isOnboarded) {
    return <Redirect href={{ pathname: '/onboarding', params: { redirectToRoom: code } }} />;
  }

  if (notFound) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16 }}>
        <Text style={{ ...typography.title, color: colors.chalk, fontSize: 22, textAlign: 'center' }}>
          Room not found
        </Text>
        <Text style={{ color: colors.fog, fontSize: 14, textAlign: 'center' }}>
          That invite link has expired or the room no longer exists.
        </Text>
        <Pressable
          onPress={() => router.replace('/')}
          style={{ marginTop: 8, backgroundColor: colors.amber, paddingVertical: 14, paddingHorizontal: 28 }}
          className="active:opacity-80"
        >
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 12 }}>
            Back to home
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.amber} />
    </View>
  );
}
