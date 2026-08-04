import { ScrollView, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';

const H_PADDING = 24;

function Section({ title, children }: { title: string; children: string }) {
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
      <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22 }}>
        {children}
      </Text>
    </View>
  );
}

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.cream }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: H_PADDING,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Pressable
          onPress={() => router.back()}
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
          Privacy Policy
        </Text>
        <Text style={{ color: colors.dune, fontSize: 12, marginBottom: 28 }}>
          Last updated: August 4, 2026
        </Text>

        <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 22, marginBottom: 24 }}>
          SipSync ("we," "us," the "App") is a party game played with friends in the
          same room, each on their own phone. This explains what limited data we
          handle and how third-party services work when you use the web version at
          quicklegame.com.
        </Text>

        <Section title="What we don't collect">
          No account, email, phone number, or login is required. There's no sign-up.
        </Section>

        <Section title="What we do collect">
          A random, anonymous device identifier (UUID) stored locally on your
          device, used only to identify you within a room you join — not tied to
          your real identity. A display name and avatar/vibe icon you choose,
          visible only to other players in your room. Room and gameplay data (room
          codes, scores, game actions), held temporarily on our servers only for
          the duration of an active room, not permanently stored.
        </Section>

        <Section title="Advertising">
          The web version shows ads served by Google AdSense. Google and its
          partners may use cookies or similar technologies to serve ads based on
          your visits to this and other sites. You can review your ad
          personalization choices via Google's Ads Settings
          (adssettings.google.com) or the consent banner shown on this site. See
          Google's policy at policies.google.com/technologies/partner-sites for
          details.
        </Section>

        <Section title="Analytics">
          We use Vercel Web Analytics and Speed Insights to understand aggregate,
          anonymized traffic and performance; no personally identifying data is
          collected through this.
        </Section>

        <Section title="Children">
          SipSync is a drinking game intended for adults. It is not directed at
          children, and we do not knowingly collect data from children.
        </Section>

        <Section title="Data retention">
          Because there are no accounts, most data (room state, scores) is
          discarded once a room ends. Your locally-stored device ID persists only
          on your device until app storage is cleared.
        </Section>

        <Section title="Changes">
          We may update this policy occasionally; the "last updated" date above
          reflects the most recent change.
        </Section>

        <Section title="Contact">
          Questions about this policy: giladshavit1@gmail.com
        </Section>
      </ScrollView>
    </View>
  );
}
