import { Platform, Text, View } from 'react-native';
import { Link, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '@/constants/design';

const LINKS = [
  { href: '/games', label: 'Games' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
] as const;

// Web-only site chrome for quicklegame.com's public content pages (home,
// catalog, rule pages, FAQ, about, terms, privacy). Real <a> links via
// expo-router's Link, so crawlers can walk the site the way a reader does.
// Never rendered inside a room, onboarding, profile or the tutorial preview
// — those are app screens — and never on native, where the rules screen
// keeps its own back button. `bar` is a full-width strip pinned above a
// page's ScrollView; `overlay` is the home variant, a bare row of links
// floating top-left opposite the profile button.
export default function SiteNav({ variant = 'bar' }: { variant?: 'bar' | 'overlay' }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'web') return null;

  const links = LINKS.map((link) => {
    const active = link.href === '/games' ? pathname.startsWith('/games') : pathname === link.href;
    return (
      <Link key={link.href} href={link.href}>
        <Text style={{ ...typography.label, fontSize: 11, color: active ? colors.amber : colors.ink }}>{link.label}</Text>
      </Link>
    );
  });

  if (variant === 'overlay') {
    return (
      <View
        style={{
          position: 'absolute',
          top: insets.top + 28,
          left: 24,
          flexDirection: 'row',
          gap: 18,
          zIndex: 1,
        }}
      >
        {links}
      </View>
    );
  }

  return (
    <View
      style={{
        paddingTop: insets.top + 14,
        paddingBottom: 12,
        paddingHorizontal: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 2,
        borderBottomColor: colors.ink,
        backgroundColor: colors.cream,
      }}
    >
      <Link href="/">
        <Text style={{ fontWeight: '900', color: colors.ink, fontSize: 18, letterSpacing: -0.5 }}>Quickle</Text>
      </Link>
      <View style={{ flexDirection: 'row', gap: 18 }}>{links}</View>
    </View>
  );
}
