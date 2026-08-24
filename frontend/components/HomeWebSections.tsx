import { Pressable, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { ChevronRight, Martini, Smartphone, Swords } from 'lucide-react-native';
import { colors, typography } from '@/constants/design';
import { ACTIVE_GAME_CATALOG } from '@/constants/games';

const STEPS = [
  {
    Icon: Smartphone,
    title: 'Create a room',
    body: 'One tap makes a room with a 4-letter code. Share the code or the link — friends join from their own phone. No app store, no sign-up.',
  },
  {
    Icon: Swords,
    title: 'Battle in fast mini-games',
    body: 'Reflex taps, bluffs, auctions, dilemmas — 15 quick games picked with smart shuffle so nothing repeats until everything has played.',
  },
  {
    Icon: Martini,
    title: 'Loser drinks',
    body: 'The server is the judge, so nobody wins by having faster Wi-Fi. Losers get a drinking window; what fills your cup is up to you.',
  },
];

const TEASER_COUNT = 6;

// Web-only: the app's home doubles as quicklegame.com's landing page, so
// below the CTAs it carries real, crawlable copy — how the game works, links
// into the rules pages, and a footer. Native home stays just the app UI.
export default function HomeWebSections() {
  return (
    <View style={{ marginTop: 72 }}>
      <Text style={{ ...typography.label, color: colors.amber, fontSize: 12, letterSpacing: 2, marginBottom: 20 }}>
        How it works
      </Text>
      <View style={{ gap: 20, marginBottom: 56 }}>
        {STEPS.map(({ Icon, title, body }) => (
          <View key={title} style={{ flexDirection: 'row', gap: 14 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderWidth: 2,
                borderColor: colors.ink,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon size={20} color={colors.ink} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>{title}</Text>
              <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, opacity: 0.85 }}>{body}</Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={{ ...typography.label, color: colors.amber, fontSize: 12, letterSpacing: 2, marginBottom: 20 }}>
        The games
      </Text>
      <View style={{ gap: 12, marginBottom: 16 }}>
        {ACTIVE_GAME_CATALOG.slice(0, TEASER_COUNT).map((game) => (
          <Link key={game.id} href={{ pathname: '/games/[id]', params: { id: game.id } }} asChild>
            {/* asChild needs a pressable child — a plain View won't navigate */}
            <Pressable
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              className="active:opacity-60"
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  backgroundColor: game.accentColor,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <game.Icon size={18} color={colors.cream} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{game.title}</Text>
                <Text style={{ color: colors.dune, fontSize: 13 }}>{game.tagline}</Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
      <Link href="/games" asChild>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 56 }} className="active:opacity-60">
          <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>
            See all {ACTIVE_GAME_CATALOG.length} games
          </Text>
          <ChevronRight size={16} color={colors.ink} strokeWidth={2} />
        </Pressable>
      </Link>

      <View style={{ borderTopWidth: 2, borderTopColor: colors.ink, paddingTop: 24 }}>
        <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, marginBottom: 16 }}>
          Quickle is a free browser-based party drinking game — no downloads, no
          accounts. One phone per player, one shared moment of victory or
          regret. For adults of legal drinking age; please drink responsibly.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 8, marginBottom: 16 }}>
          <Link href="/games"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Games</Text></Link>
          <Link href="/about"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>About</Text></Link>
          <Link href="/terms"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Terms</Text></Link>
          <Link href="/privacy"><Text style={{ ...typography.label, color: colors.ink, fontSize: 11 }}>Privacy</Text></Link>
        </View>
        <Text style={{ color: colors.dune, fontSize: 12 }}>© 2026 Quickle</Text>
      </View>
    </View>
  );
}
