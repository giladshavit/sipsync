import { InfoPage, Section } from '@/components/InfoPage';

export default function AboutScreen() {
  return (
    <InfoPage
      metaTitle="About Quickle — The Party Drinking Game"
      metaDescription="What Quickle is, how a round works, why the server judges every game, and our stance on drinking responsibly."
      canonicalPath="/about"
      heading="About Quickle"
      intro="Quickle is a bring-your-own-device party game: one person makes a room, everyone else joins from their own phone's browser, and the group battles through fast mini-games where the loser drinks. No downloads, no accounts, no setup — the game runs wherever a browser runs."
    >
      <Section title="How a round works">
        The host creates a room and shares its 4-letter code or link. Each round,
        the game picks a mini-game — reflex taps, bluffing, auctions, dilemmas —
        teaches it in a few seconds, and everyone plays simultaneously on their
        own screen. Losers get a short drinking window, scores accumulate, and a
        podium crowns the night's champion. A smart shuffle ensures no game
        repeats until every game has played.
      </Section>

      <Section title="Fair play, judged by the server">
        Every reflex game is timed on the server with per-player clock
        correction, not on your phone — so a faster connection never beats a
        faster hand. Nobody can win by sitting closer to the router.
      </Section>

      <Section title="Drink responsibly">
        Quickle is for adults of legal drinking age. What goes in your cup is
        entirely up to you — water and soft drinks play exactly as well. Know
        your limit, look after your friends, and never drive after drinking.
      </Section>

      <Section title="Who makes Quickle">
        Quickle is built and run independently. It started as a way to make
        game night louder and turned into the site you're reading now.
      </Section>

      <Section title="Contact">
        Questions, feedback, or a game idea: giladshavit1@gmail.com
      </Section>
    </InfoPage>
  );
}
