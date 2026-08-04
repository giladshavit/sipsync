import '../global.css';

import { useEffect } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { Stack, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Analytics, SpeedInsights } from '@/lib/vercelInsights';
import AdSenseScript from '@/components/AdSenseScript';
import { isAdEligiblePath } from '@/config/adPlacements';
import { AudioProvider } from '@/contexts/AudioContext';
import ErrorFallback from '@/components/ErrorFallback';

export default function RootLayout() {
  const pathname = usePathname();
  const showAdsScript = Platform.OS === 'web' && isAdEligiblePath(pathname);

  // Web-only: `height: 100%` on html/body/#root (or `100vh`) both resolve
  // against the browser's *layout* viewport, which iOS Safari doesn't
  // shrink/grow live as its address bar collapses — the result is content
  // sized for a viewport that doesn't match what's actually visible,
  // rendering as a squashed top strip. useWindowDimensions gives a
  // JS-measured height that updates on the resize event Safari fires when
  // the address bar shows/hides, so we size the root explicitly instead of
  // trusting the inherited percentage chain. (Deliberately NOT the visual
  // viewport: sizing to visualViewport.height made the whole app reflow
  // when the iOS keyboard opened — mascot riding up, content compressing —
  // which read worse than the problem it solved. Anything that needs text
  // entry keeps its input in the top part of the screen instead, e.g.
  // components/JoinRoomModal.tsx.)
  const { height } = useWindowDimensions();
  const rootStyle = Platform.OS === 'web' ? { height, width: '100%' as const } : { flex: 1 as const };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    // background-color: with viewport-fit=cover the app's own views paint
    // edge-to-edge, but the body is the fallback surface behind rubber-band
    // overscroll and mid-load — cream matches the app, not browser white.
    style.textContent = `html, body { overscroll-behavior-y: none; touch-action: pan-y; background-color: #FFF8E1; }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={rootStyle}>
        <AudioProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0A0A0F' },
              animation: 'fade',
            }}
          />
          {Platform.OS === 'web' && <Analytics />}
          {Platform.OS === 'web' && <SpeedInsights />}
          {showAdsScript && <AdSenseScript />}
        </AudioProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

// Expo Router renders this in place of the whole Stack when a child route
// throws during render. It replaces everything RootLayout would normally
// wrap, including providers that may not have survived whatever crashed —
// so it brings its own SafeAreaProvider/GestureHandlerRootView rather than
// assuming RootLayout's tree is still intact. Deliberately no AudioProvider:
// the crash may have originated inside it, and the fallback has no audio
// needs.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ErrorFallback error={error} retry={retry} />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
