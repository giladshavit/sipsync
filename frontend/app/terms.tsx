import { InfoPage, Section } from '@/components/InfoPage';

export default function TermsScreen() {
  return (
    <InfoPage
      metaTitle="Terms of Use — Quickle"
      metaDescription="The plain-language terms for playing Quickle: age requirements, playing at your own risk, guest accounts, and acceptable use."
      canonicalPath="/terms"
      heading="Terms of Use"
      lastUpdated="August 19, 2026"
      intro="These are the plain-language terms for using Quickle at quicklegame.com. By playing, you agree to them."
    >
      <Section title="Who may play">
        Quickle involves drinking themes and is intended for adults of legal
        drinking age in their jurisdiction. If alcohol is part of your game, you
        are responsible for complying with local law.
      </Section>

      <Section title="Play at your own risk">
        Participation is voluntary. Quickle never requires anyone to consume
        alcohol — every prompt works equally with any drink or none. You are
        solely responsible for what and how much you drink, and we accept no
        liability for harm arising from alcohol consumption during play.
      </Section>

      <Section title="Guest accounts">
        There are no accounts. A random identifier stored on your device stands
        in for you inside a room, alongside the display name you choose. Clear
        your browser storage and it's gone.
      </Section>

      <Section title="Acceptable use">
        Keep it a game: don't harass other players, disrupt rooms you weren't
        invited to, or attempt to break, overload, or reverse the service.
      </Section>

      <Section title="Advertising">
        The web version shows ads served by Google AdSense; the Privacy Policy
        explains the cookies and choices involved.
      </Section>

      <Section title="The service">
        Quickle is provided as-is, free of charge. Rooms are transient: state
        exists only while a room is live. Features may change or the service may
        pause at any time without notice.
      </Section>

      <Section title="Changes">
        We may update these terms; the date above reflects the latest revision.
        Continuing to play after a change means you accept it.
      </Section>

      <Section title="Contact">
        Questions about these terms: giladshavit1@gmail.com
      </Section>
    </InfoPage>
  );
}
