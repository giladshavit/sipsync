import { useEffect } from 'react';
import { Platform } from 'react-native';

// Warns before an accidental refresh/back/tab-close drops a player mid-room
// (web only — native has no equivalent browser-chrome exit path). Callers
// gate `enabled` on whichever screens should actually prompt; see
// room/[code]/_layout.tsx for the room-wide wiring.
export function usePreventLeave(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Chrome requires returnValue to be set to show the native prompt.
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [enabled]);
}
