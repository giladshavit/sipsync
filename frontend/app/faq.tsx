import { InfoPage, Section } from '@/components/InfoPage';

export default function FaqScreen() {
  return (
    <InfoPage
      metaTitle="FAQ — Quickle Party Drinking Game"
      metaDescription="Answers to the questions people ask before game night: how rooms work, phones and browsers, player counts, fair play, smart shuffle, playing without alcohol, safety, and privacy."
      canonicalPath="/faq"
      heading="Questions"
      intro="Everything people ask before their first Quickle night, in one place. If yours isn't here, the address at the bottom reaches a real person."
    >
      <Section title="What is Quickle?">
        A party game that runs in the browser of every phone in the room. One person opens a
        room, everyone else joins it, and the group plays a run of fast mini-games together:
        reflex taps, bluffs, auctions, dilemmas, counting games. Each round ends with a loser,
        and the loser drinks. There are no cards to buy, no board, and no shared screen to
        crowd around; each player looks at their own phone and the server keeps everyone in
        sync.
      </Section>

      <Section title="Do I need to install an app or create an account?">
        No. Quickle runs in a normal mobile browser: open the link, pick a name and an avatar,
        and you are in. There is no sign-up, no email and no password. Your phone remembers you
        between nights with an anonymous identifier, so you keep your name and avatar without
        ever creating an account.
      </Section>

      <Section title="How do friends join my room?">
        Every room has a four-letter code and a share link. The host reads the code out loud or
        sends the link, and each friend opens it on their own phone. New players can join while
        the room is still in the lobby, and the host sees them appear in real time.
      </Section>

      <Section title="How many people can play?">
        Two players are enough to start, and the games get better as the room grows. A few
        games need a bigger crowd to make sense, such as three players for the voting games or
        five for the auction, and the room simply skips those when it is too small. Every rules
        page states its minimum.
      </Section>

      <Section title="Which phones and browsers work?">
        Any recent iPhone or Android phone with its built-in browser: Safari, Chrome, Samsung
        Internet and the like. A tablet or laptop works too, though the games are designed for a
        phone in one hand. Everyone needs an internet connection; the room does not need the
        players to be on the same Wi-Fi.
      </Section>

      <Section title="Who decides who lost?">
        The server does, not the phones. Every tap in a reflex game is timestamped on the
        server and corrected for each player's clock and connection delay, so a faster network
        never wins and a slower one never loses. Bluffing and voting games resolve on the server
        as well, so nobody can peek at a result before it is revealed to everyone.
      </Section>

      <Section title="How are the games picked each round?">
        A smart shuffle. The room draws from the games the host has enabled, and a game will not
        come around again until every other enabled game has had its turn. The host can turn
        games on or off from the lobby before the night starts, and every game teaches itself
        with a short animated tutorial the first time it appears.
      </Section>

      <Section title="What is a chaser?">
        The unit the games count in. When a rules page says the loser drinks one chaser, it
        means one measure of whatever the table agreed on: a sip, a shot glass of something
        mild, a gulp of water. Quickle never defines the size or the contents of a chaser; the
        people at the table do.
      </Section>

      <Section title="Can we play without alcohol?">
        Yes, and many tables do. Water, soft drinks and mocktails play exactly the same, and the
        points already keep score. Every rules page has a short section on how that game holds
        up without alcohol, with forfeits and dares that work as well as a drink. A mixed table,
        where some people drink and some drive, is common and works fine.
      </Section>

      <Section title="Is this safe?">
        Quickle is for adults of legal drinking age, and the first screen asks you to confirm
        that. Beyond that the rules are the ones any good host already knows: nobody is ever
        obliged to drink, anyone can swap their cup for water at any point, look after the
        people around you, and never drive after drinking. A game is a reason to laugh with
        friends, not a reason to push anyone past their limit.
      </Section>

      <Section title="Can I try a game on my own first?">
        Yes. Every rules page has a practice button that starts a private round against bots,
        so you can learn a game before you bring it to the table. Practice rounds are free and
        leave no trace in anyone's scoreboard.
      </Section>

      <Section title="What data does Quickle keep?">
        Very little. There are no accounts, so there is no email or phone number to keep. Your
        phone stores an anonymous identifier plus the name and avatar you chose. Room state
        lives on the server only while the room is active and is discarded afterwards. The
        website shows ads through Google AdSense and uses basic analytics; the Privacy Policy
        explains both in plain language.
      </Section>

      <Section title="Something is not working, or I have an idea for a game">
        Write to giladshavit1@gmail.com. Quickle is built and run by one person, and messages
        get read.
      </Section>
    </InfoPage>
  );
}
