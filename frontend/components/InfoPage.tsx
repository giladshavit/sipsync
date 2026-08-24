import type { ReactNode } from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Head from '@/lib/head';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { useWebPageBackground } from '@/hooks/useWebPageBackground';

const SITE = 'https://www.quicklegame.com';
const H_PADDING = 24;

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <Text
        style={{
          ...typography.label,
          color: colors.amber,
          fontSize: 11,
          letterSpacing: 2,
          marginBottom: 8,
        }}
      >
        {title}
      </Text>
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>{children}</Text>
    </View>
  );
}

interface InfoPageProps {
  metaTitle: string;
  metaDescription: string;
  canonicalPath: string;
  heading: string;
  lastUpdated?: string;
  intro?: string;
  children: ReactNode;
}

// Shared scaffold for the static info pages (/privacy, /about, /terms):
// same back button, heading treatment and Section rhythm on all three, and
// a per-page <Head> so each exports its own title/description/canonical.
export function InfoPage({
  metaTitle,
  metaDescription,
  canonicalPath,
  heading,
  lastUpdated,
  intro,
  children,
}: InfoPageProps) {
  useWebPageBackground(colors.cream);
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <Head>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <link rel="canonical" href={`${SITE}${canonicalPath}`} />
      </Head>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={{
            width: 42,
            height: 42,
            borderWidth: 2,
            borderColor: colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
          className="active:opacity-60"
        >
          <ArrowLeft size={20} color={colors.ink} />
        </Pressable>

        <Text style={{ ...typography.title, color: colors.amber, fontSize: 28, marginBottom: 4 }}>
          {heading}
        </Text>
        {lastUpdated && (
          <Text style={{ color: colors.dune, fontSize: 12, marginBottom: 28 }}>
            Last updated: {lastUpdated}
          </Text>
        )}
        {intro && (
          <Text
            style={{
              color: colors.ink,
              fontSize: 15,
              lineHeight: 22,
              marginBottom: 24,
              marginTop: lastUpdated ? 0 : 20,
            }}
          >
            {intro}
          </Text>
        )}
        {children}
      </ScrollView>
    </View>
  );
}
