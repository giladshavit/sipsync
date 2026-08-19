import { InfoPage, Section } from '@/components/InfoPage';

export default function PrivacyScreen() {
  return (
    <InfoPage
      metaTitle="Privacy Policy — Quickle"
      metaDescription="What limited data Quickle handles: no accounts, an anonymous device ID, transient room state, and how AdSense and analytics work on quicklegame.com."
      canonicalPath="/privacy"
      heading="Privacy Policy"
      lastUpdated="August 4, 2026"
      intro={
        'SipSync ("we," "us," the "App") is a party game played with friends in the same room, each on their own phone. This explains what limited data we handle and how third-party services work when you use the web version at quicklegame.com.'
      }
    >
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
    </InfoPage>
  );
}
