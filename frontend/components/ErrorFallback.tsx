import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

// Rendered by Expo Router's ErrorBoundary export (see app/_layout.tsx) in
// place of the crashed route tree. Keeps the raw error out of the UI —
// console.error is the only place the stack trace goes — while still giving
// the user a branded way out instead of a blank white screen.
export default function ErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error);
  }, [error]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.surface, colors.ink]}
        locations={[0, 0.65]}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -220,
          left: '50%',
          width: 460,
          height: 460,
          marginLeft: -230,
          borderRadius: 230,
          backgroundColor: colors.stop,
          opacity: 0.08,
        }}
      />
      <View style={styles.content}>
        <AlertTriangle size={56} color={colors.stop} strokeWidth={2} />
        <Text style={[typography.title, styles.title]}>Oops! Something went wrong</Text>
        <Text style={styles.subtitle}>
          The app hit a snag. Give it another try — your room and progress are usually still there.
        </Text>
        <Pressable onPress={retry} style={styles.button} className="active:opacity-80">
          <RefreshCw size={18} color={colors.ink} strokeWidth={2.5} />
          <Text style={[typography.title, styles.buttonText]}>Try Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  title: {
    fontSize: 20,
    color: colors.chalk,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.fog,
    textAlign: 'center',
    lineHeight: 22,
  },
  button: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 28,
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonText: {
    fontSize: 15,
    color: colors.ink,
  },
});
