import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';

export default function NotFoundScreen() {
  useWebPageBackground(colors.cream);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.cream,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Head>
        <title>Page Not Found — Quickle</title>
      </Head>
      <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, marginBottom: 8 }}>
        Page not found
      </Text>
      <Text
        style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 24, textAlign: 'center' }}
      >
        This page doesn't exist — maybe the room ended, or the link got mangled.
      </Text>
      <Link href="/" asChild>
        <Pressable
          style={{ backgroundColor: colors.amber, paddingVertical: 16, paddingHorizontal: 32 }}
          className="active:opacity-75"
        >
          <Text style={{ ...typography.label, color: colors.ink, fontSize: 13 }}>Back to Quickle</Text>
        </Pressable>
      </Link>
    </View>
  );
}
