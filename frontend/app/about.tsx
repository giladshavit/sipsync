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

      <Section title="Fifteen games, three flavours">
        Speed games are pure reflexes and reward the steadiest thumb in the room. Luck games hand
        the outcome to a card, a coin or a number and are the great equaliser between the
        seasoned gamer and the friend who has never played anything. Strategy games are about
        reading people: bluffing, cooperating, betraying, and guessing what the crowd will do.
        Most nights mix all three, and the catalog page explains which games open a room, which
        need a big crowd, and which slow the pace down.
      </Section>

      <Section title="Design principles">
        Every game must be learnable in the few seconds its tutorial takes, because nobody at a
        party reads a manual. Every round must end with a clear result, so the table always
        knows who lost and why. Nothing requires a shared screen, an account, or a download,
        because the phones people already hold are enough. And the server, not the phone, is
        the judge of anything timed, so the game is fair on bad hotel Wi-Fi and good home
        fibre alike.
      </Section>

      <Section title="Drink responsibly">
        Quickle is for adults of legal drinking age. What goes in your cup is
        entirely up to you — water and soft drinks play exactly as well. Know
        your limit, look after your friends, and never drive after drinking.
      </Section>

      <Section title="Who makes Quickle">
        Quickle is built and run by Gilad Shavit, a software developer who wanted a party game
        that lived on the phones people already had in their pockets instead of on a deck of
        cards that somebody always forgets to bring. He writes the games, the rules and the
        pages you are reading, and runs the whole thing independently, with no studio or
        publisher behind it. It started as a way to make game night louder and turned into
        the site you're reading now.
      </Section>

      <Section title="Contact">
        Questions, feedback, or a game idea: giladshavit1@gmail.com
      </Section>
    </InfoPage>
  );
}
