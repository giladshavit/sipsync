import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';

// Every screen declares its own background through this hook, which makes it
// the one place that knows what the system chrome should sit on:
//
// Web: paints the browser page itself (html/body) to match the current
// screen's background, so the zones the app's views don't reach — outside
// the safe area under the iPhone notch / home indicator, and the
// rubber-band overscroll area — show the screen's own color instead of a
// one-size-fits-all fallback. Accepts any CSS background value, so dynamic
// colors (e.g. summary's win/lose color) and gradients both work.
//
// Native: picks the status bar's icon color to contrast with that same
// background. The root layout's <StatusBar style="light"> is right for the
// ink screens, but on the cream ones (home, lobby, catalog, rules) it left
// white battery/clock glyphs on a near-white surface — invisible on Android,
// faint on iOS. Non-hex backgrounds (gradients) are treated as dark, which is
// what every one of them is.
//
// Built on useFocusEffect rather than useEffect: stack navigation keeps
// previous screens mounted, so plain mount effects wouldn't re-fire when
// popping back — focus does.
export function useWebPageBackground(background: string) {
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') {
        document.documentElement.style.background = background;
        document.body.style.background = background;
        return;
      }
      setStatusBarStyle(isLightBackground(background) ? 'dark' : 'light', true);
    }, [background]),
  );
}

// Relative luminance of a #rgb / #rrggbb color; anything else counts as dark.
function isLightBackground(background: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(background.trim());
  if (!m) return false;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.5;
}
