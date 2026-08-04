import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Web-only: paints the browser page itself (html/body) to match the current
// screen's background, so the zones the app's views don't reach — outside
// the safe area under the iPhone notch / home indicator, and the
// rubber-band overscroll area — show the screen's own color instead of a
// one-size-fits-all fallback. Accepts any CSS background value, so dynamic
// colors (e.g. summary's win/lose color) and gradients both work.
//
// Built on useFocusEffect rather than useEffect: stack navigation keeps
// previous screens mounted, so plain mount effects wouldn't re-fire when
// popping back — focus does.
export function useWebPageBackground(background: string) {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') return;
      document.documentElement.style.background = background;
      document.body.style.background = background;
    }, [background]),
  );
}
