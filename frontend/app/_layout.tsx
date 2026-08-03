import '../global.css';

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Analytics, SpeedInsights } from '@/lib/vercelInsights';
import { AudioProvider } from '@/contexts/AudioContext';
import ErrorFallback from '@/components/ErrorFallback';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const style = document.createElement('style');
    style.textContent = `html, body { overscroll-behavior-y: none; touch-action: pan-y; }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
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
