import { Stack, useSegments } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { usePreventLeave } from '@/hooks/usePreventLeave';

export default function RoomLayout() {
  // A phone that auto-locks mid-round looks like a disconnect to the whole
  // room (grace timers, dimmed tiles). Rooms are short-lived; hold the screen
  // for the entire room session, lobby included.
  // suppressDeactivateWarnings: on web without the Screen Wake Lock API
  // (iOS Safari <16.4, Firefox Android) or when activation was denied, the
  // unmount cleanup's deactivateKeepAwake throws ERR_KEEP_AWAKE_TAG_INVALID
  // on every room exit — this silences that expected failure.
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });

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
