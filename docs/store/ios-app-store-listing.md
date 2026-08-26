# Quickle — App Store listing (iOS)

Everything that gets pasted into App Store Connect for v1.0, in one place.
Character limits are Apple's; the counts next to each field are of the text
below it. Hebrew is the second locale (spec §3.2).

App Store Connect app: https://appstoreconnect.apple.com/apps/6805344669
Bundle ID `com.quicklegame.app` · SKU `quickle` · ASC App ID `6805344669`

---

## App Information

| Field | Value |
|---|---|
| Name | **Quickle Party Game** — "Quickle" alone was taken |
| Subtitle (30) | `Fast, light mini-games` (22) — must not repeat "Party Game" from the name |
| Primary category | Games |
| Secondary category | Entertainment |
| Game subcategories | Casual, Board — Apple has no "Party" subcategory; "Family" would contradict the 18+ rating |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | see below |

### Age Rating questionnaire

Answer honestly — an inaccurate rating is grounds for removal (spec §3.1).

| Question | Answer | Why |
|---|---|---|
| Alcohol, Tobacco, or Drug Use or References | **Frequent/Intense** | The whole game is about who drinks a chaser |
| Contests | None | No real-world prizes |
| Gambling (simulated) | **Infrequent/Mild** | Russian Roulette / Auction / Liar's Coin use bet-like framing with no stakes and no currency |
| Mature/Suggestive Themes | None | |
| Profanity or Crude Humor | None | |
| Violence (any) | None | "Russian Roulette" is a card-flip game; no depiction of violence |
| Horror/Fear Themes | None | |
| Medical/Treatment Information | None | |
| Unrestricted Web Access | No | The app has no browser |
| Gambling with real money | No | |
| Loot boxes | No | |
| Parental controls / kids category | No | |
| Guns or other weapons | None | Russian Roulette is card flips; no weapon is depicted |
| Health or wellness topics | No | |
| Messaging and chat | No | No chat feature |
| User-generated content | No | Custom questions and nicknames exist only inside a private room among people who know each other — not public UGC (guideline 1.2) |
| Age assurance | No | Apple means real verification (ID/card); our "I'm 18+" tap is self-declaration, described in the review notes |
| Social media | No | |
| Advertising | No | True for v1.0 — **flip to Yes in the release that adds ads** |

Expected result: **18+** (Apple's tier above 17+ since the 2025 questionnaire).
Do not try to argue it down — the first-launch 18+ consent screen already commits
the app to that audience.

---

## Pricing and Availability

Free · all territories · no pre-order.

---

## App Privacy

The app has no accounts and no analytics SDK on native. What leaves the device:

- a random UUID generated on first launch (identifies the player within a room)
- the nickname the player types in
- transient game state (taps, votes, scores) while a room is live

All of it lives in the backend's Redis only for the life of a room and is
deleted when the room ends (Room Garbage Collection). Nothing is linked to a
real identity, nothing is used for advertising or tracking.

| Data type | Collected? | Purpose | Linked to user | Tracking |
|---|---|---|---|---|
| Identifiers → User ID | Yes | App Functionality | No | No |
| User Content → Other User Content (nickname) | Yes | App Functionality | No | No |
| Everything else (contacts, location, health, purchases, browsing, diagnostics…) | No | | | |

Then: **"Do you or your third-party partners use data for tracking?" → No.**

Privacy policy URL: `https://www.quicklegame.com/privacy`

> Double-check before submitting: the privacy page must describe exactly the
> two rows above. If it mentions analytics, that applies to the website only —
> say so explicitly on the page.

---

## Version 1.0 — English (U.S.)

### Promotional text (170)

```
15 fast mini-games for a night with friends. Everyone plays on their own phone - no board, no cards, nothing to set up. Works with any drink.
```
(141)

### Description (4000)

```
Quickle is a party game for a group of friends, with a phone in every hand.

One player opens a room and shares the code. Everyone else joins from their own phone - no account, no sign-up. Each round is one mini-game, and whoever loses drinks a chaser. Any drink counts: beer, wine, soda or water.

15 MINI-GAMES, MORE ON THE WAY

Fast and light, and every one plays differently - some are pure speed, some are luck, some are strategy with a little game theory mixed in.

Green Light, Tap Race, Human Timer, Russian Roulette, Liar's Coin, Closest Average, The Sacrifice, Prisoner's Dilemma, Go with the Flow, Against the Flow, Strong Point, Flying Bomb, 21, Auction, Black Box.

You choose which games make tonight's lineup, and those are the ones you play.

FOR ADULTS

Quickle is intended for players of legal drinking age. If you drink, drink responsibly and never drink and drive. It plays exactly the same with a glass of water.

Guests can also join from any browser at quicklegame.com - only the host needs the app.
```
(1,022)

### Keywords (100)

```
party game,drinking game,friends,group,multiplayer,mini games,bar,pregame,night out,social,reflex
```
(97)

| Field | Value |
|---|---|
| Support URL | `https://www.quicklegame.com` |
| Marketing URL | `https://www.quicklegame.com` |
| Copyright | `2026 Gilad Shavit` |
| Version | `1.0.0` |

### App Review Information

| Field | Value |
|---|---|
| Sign-in required | **No** — there are no accounts |
| Contact first name / last name | Gilad / Shavit |
| Phone | *(fill in)* |
| Email | giladshavit1@gmail.com |

### Notes for the reviewer

This is the part that decides the review. Plain, specific, no marketing.

```
Quickle is a multiplayer party game played by a group of people in the same room, each on their own phone. The losing player of each round drinks a "chaser" - any beverage. The app does not sell, serve, or promote alcohol, does not encourage drinking quantities, and states on first launch that it plays the same with any drink. It is rated 18+ and shows an age-confirmation screen before anything else.

HOW TO TEST WITH ONE DEVICE

1. Launch the app, confirm you are 18+, enter any nickname.
2. Tap "Games" and open any game (for example "Green Light").
3. Tap the robot icon at the top of the rules page. This starts a practice round against computer players, so the whole flow - tutorial, round, drinking window, podium - can be seen with a single device.

HOW TO TEST A REAL ROOM WITH A SECOND PLAYER

1. On the device, tap "Create Room". A six-letter code appears.
2. In any web browser (desktop is fine), open https://www.quicklegame.com/room/<CODE> and enter a nickname. The browser joins the same room as a second player.
3. On the device, tap "Start Game".

There are no accounts, no purchases, no ads, and no user-generated content visible to strangers - rooms are private to whoever has the code and are deleted from the server when they end.

If anything is unclear, please contact giladshavit1@gmail.com and I will respond the same day.
```

---

## Version 1.0 — Hebrew

Name stays **Quickle Party Game** (Latin) in both locales.

| Field | Value |
|---|---|
| Subtitle (30) | `מיני-משחקים מהירים וקלילים` (26) |
| Keywords (100) | `משחק שתייה,משחק מסיבה,חברים,קבוצה,ערב,בר,צייסר,משחקים,מיני משחקים,רב משתתפים` (76) |

### Promotional text (170)

```
15 מיני-משחקים מהירים לערב עם חברים. כל אחד משחק מהטלפון שלו - בלי לוח, בלי קלפים, בלי לסדר כלום. עובד עם כל משקה.
```
(114)

### Description (4000)

```
Quickle הוא משחק מסיבה לחבורת חברים, עם טלפון בכל יד.

שחקן אחד פותח חדר ומשתף את הקוד. כל השאר מצטרפים מהטלפון שלהם - בלי חשבון, בלי הרשמה. כל סבב הוא מיני-משחק אחד, ומי שמפסיד שותה צ'ייסר. כל משקה נחשב: בירה, יין, סודה או מים.

15 מיני-משחקים, ועוד בדרך

מהירים וקלילים, וכל אחד מהם משחק אחרת - יש כאלה של מהירות טהורה, יש של מזל, ויש של אסטרטגיה עם קצת תורת המשחקים.

אור ירוק, מרוץ לחיצות, טיימר אנושי, רולטה רוסית, מטבע השקרן, הכי קרוב לממוצע, הקורבן, דילמת האסיר, לזרום עם הרוב, נגד הזרם, נקודה חזקה, פצצה מעופפת, 21, מכירה פומבית, קופסה שחורה.

אתם בוחרים אילו משחקים נכנסים להרכב של הערב, ובהם משחקים.

למבוגרים

Quickle מיועד לשחקנים בגיל שתייה חוקי. אם שותים - שותים באחריות, ולעולם לא שותים ונוהגים. המשחק עובד בדיוק אותו דבר עם כוס מים.

אורחים יכולים להצטרף גם מכל דפדפן ב-quicklegame.com - רק המארח צריך את האפליקציה.
```
(831)

---

## Screenshots — still to produce (spec §3.2)

- 6.9″ class, 1320×2868, up to 10; target 5–6. One size set is enough.
- Designed frames (device + short caption), not raw captures. Content must
  match the 18+ rating — glasses fine, no excess.
- Suggested sequence: (1) lobby with a room code and four avatars, (2) a
  reflex game mid-round, (3) the six-second drinking window, (4) the podium,
  (5) the games catalog, (6) a tutorial frame.
- Optional 15–30s App Preview, cut from the beta demo video (spec §2.3).
