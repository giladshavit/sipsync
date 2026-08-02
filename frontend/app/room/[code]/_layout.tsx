import { Stack, useSegments } from 'expo-router';
import { usePreventLeave } from '@/hooks/usePreventLeave';

export default function RoomLayout() {
  const segments = useSegments();
  // Every room/[code] screen warns before an accidental leave except the
  // lobby itself — that's the one screen where navigating away/refreshing
  // is an expected, safe action (see usePreventLeave design spec).
  const onLobby = segments[segments.length - 1] === 'lobby';
  usePreventLeave(!onLobby);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0f172a' },
        animation: 'fade',
      }}
    />
  );
}
